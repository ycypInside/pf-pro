/**
 * Today's action verdict and limit lights.
 * single_name_max is the no-add line (over_limit → 暫停加碼).
 * single_name_trim is the trim line (over_trim → 建議分批減碼).
 * Both numbers are shown only when the payload sends them.
 */

import { parsePolicy } from './groups.js';
import { explainError, isYes } from './money.js';
import { taipeiToday } from './research.js';
import { taipeiStamp } from './valuation.js';

export const CASH_NEAR_GAP = 0.01;

const ADD_KEYS = ['single_name_add_max', 'no_add_above', 'add_max'];
const TRIM_KEYS = ['single_name_trim', 'trim_above', 'single_name_trim_above'];
const EQUITY = new Set(['stock', 'fund', 'etf', 'equity']);
const BOND = new Set(['bond']);
const CASH = new Set(['cash']);

const LIGHT_FIELDS = {
  single: ['single_stocks[].symbol', 'single_stocks[].name', 'single_stocks[].weight', 'single_stocks[].over_limit', 'single_stocks[].over_trim', 'single_stocks[].mode', 'single_name_max', 'single_name_trim', 'settings.target_policy.single_name_trim'],
  band: ['allocation.rows[].bucket', 'allocation.rows[].actual_weight', 'allocation.rows[].target_weight', 'allocation.rows[].drift', 'allocation.band_pct', 'allocation.target', 'allocation.estimated'],
  cash: ['cash_brake.enabled', 'cash_brake.triggered', 'cash_brake.cash_pct_total', 'cash_brake.net_cash_pct_nw', 'cash_brake.thresholds.cash_pct_total', 'cash_brake.thresholds.net_cash_pct_nw', 'cash_brake.reason', 'settings.target_policy.dca_pause', 'advice[].tag=dca_pause'],
  quotes: ['stale[].symbol', 'stale[].asset_id', 'stale[].name', 'stale[].price_date', 'stale[].limit', 'stale[].mode', 'allocation.estimated'],
  window: ['pegatron_pre_earnings', 'single_stocks[] where symbol or asset_id is 4938', 'advice[].tag=compliance'],
};

export function buildToday(summary, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const fetchFailed = options.fetchFailed === true;
  const base = {
    pending: false,
    displayOnly: true,
    ok: false,
    verdictId: 'unavailable',
    headline: '讀不到今日判斷',
    tone: 'muted',
    reasons: [],
    lights: [],
    paper: [],
    banner: null,
    thresholds: emptyThresholds(),
    asOfLabel: '',
  };
  if (!summary || summary.ok === false) {
    return {
      ...base,
      lights: unknownLights(),
      banner: {
        kind: 'error',
        title: '讀不到今日行動',
        text: `讀不到今日行動。${errorMessage(options.error)}查詢時間 ${stamp(now)}（Asia/Taipei）。`,
      },
    };
  }

  const policy = readPolicy(summary, options.settings);
  const thresholds = readThresholds(summary, policy);
  const stocks = stockRows(summary);
  const real = stocks.filter((row) => !row.paper);
  const paperNames = paperLabels(summary, stocks);
  const stale = (Array.isArray(summary.stale) ? summary.stale : []).map(staleRow).filter(Boolean);
  const staleReal = stale.filter((row) => !row.paper);
  const groups = allocationGroups(summary);
  const windowFlag = flag(summary.pegatron_pre_earnings);
  const brake = cashView(summary, policy, thresholds);
  const asOfLabel = asOfText(summary, now);

  const trimRows = real.filter((row) => overTrim(row, thresholds));
  const tradableTrim = trimRows.filter((row) => !blockedByWindow(row, windowFlag) && !matchesStale(row, staleReal));
  const staleBlocks = trimRows.filter((row) => !blockedByWindow(row, windowFlag) && matchesStale(row, staleReal));
  const pauseAdds = real.filter((row) => overLimit(row, thresholds) && !overTrim(row, thresholds) && !blockedByWindow(row, windowFlag));
  const bandOutside = groups.known && groups.buckets.some((bucket) => bucket.outside);
  const estimates = Array.isArray(summary.allocation && summary.allocation.estimated)
    ? summary.allocation.estimated.filter(Boolean)
    : [];

  let verdictId = 'idle';
  let headline = '不用動';
  let tone = 'calm';
  if (brake.pause) {
    verdictId = 'pause';
    headline = '暫停定額';
    tone = 'stop';
  } else if (tradableTrim.length) {
    verdictId = 'trim';
    headline = '建議減碼檢視';
    tone = 'look';
  } else if (staleBlocks.length || (bandOutside && estimates.length)) {
    verdictId = 'quotes';
    headline = '先核對報價';
    tone = 'look';
  } else if (bandOutside) {
    verdictId = 'band';
    headline = '建議配置檢視';
    tone = 'look';
  } else if (brake.enabled || hasDcaPlan(summary)) {
    verdictId = 'dca';
    headline = '照定額';
    tone = 'calm';
  }

  const lights = [
    singleLight(real, stocks, thresholds, windowFlag),
    bandLight(groups, estimates),
    cashLight(brake),
    quoteLight(staleReal, real, thresholds, estimates),
    windowLight(windowFlag, real, summary),
  ];

  const reasons = takeReasons([
    cashReason(brake),
    windowFlag === true ? { text: '4938 財報前不交易', section: 'sec-pegatron' } : null,
    tradableTrim.length ? { text: trimText(tradableTrim, thresholds), section: 'sec-holdings' } : null,
    !tradableTrim.length && pauseAdds.length ? { text: pauseAddText(pauseAdds, thresholds), section: 'sec-holdings' } : null,
    staleReal.length ? { text: staleText(staleReal), section: 'sec-quotes' } : null,
    bandOutside ? { text: bandText(groups), section: 'sec-allocation' } : null,
  ]);
  if (!reasons.length) {
    reasons.push({ text: '目前沒有需要動手的訊號', section: 'sec-allocation' });
  }

  return {
    pending: false,
    displayOnly: true,
    ok: true,
    verdictId,
    headline,
    tone,
    reasons: reasons.slice(0, 3),
    lights,
    paper: paperNames,
    banner: bannerFor({
      now,
      summary,
      asOfLabel,
      fetchFailed,
      fromCache: options.fromCache === true,
      cacheStale: options.cacheStale === true,
      quoteStale: staleReal.length > 0,
      error: options.error,
    }),
    thresholds,
    asOfLabel,
  };
}

function emptyThresholds() {
  return {
    singleCap: null,
    addMax: null,
    trimAbove: null,
    bandPct: null,
    cashPctTotal: null,
    netCashPctNw: null,
  };
}

function unknownLights() {
  return [
    ['single', '個股', 'sec-holdings'],
    ['band', '配置', 'sec-allocation'],
    ['cash', '現金', 'sec-cash'],
    ['quotes', '報價', 'sec-quotes'],
    ['window', '4938', 'sec-pegatron'],
  ].map(([id, label, section]) => ({
    id,
    label,
    section,
    tone: 'unknown',
    lines: ['讀不到這項。'],
    fields: LIGHT_FIELDS[id],
  }));
}

function readPolicy(summary, settings) {
  const saved = settings && (settings.target_policy || settings.policy);
  return parsePolicy(saved)
    || parsePolicy(summary && summary.policy)
    || parsePolicy(summary && summary.allocation && summary.allocation.policy)
    || {};
}

function readThresholds(summary, policy) {
  const pause = (policy && policy.dca_pause && typeof policy.dca_pause === 'object') ? policy.dca_pause : {};
  const brake = summary && summary.cash_brake && typeof summary.cash_brake === 'object' ? summary.cash_brake : {};
  const brakeLines = brake.thresholds && typeof brake.thresholds === 'object' ? brake.thresholds : {};
  const cap = firstNum([summary, policy], ['single_name_max']);
  const add = firstNum([summary, policy], ADD_KEYS);
  const trim = firstNum([summary, policy], TRIM_KEYS);
  return {
    singleCap: cap,
    addMax: add,
    trimAbove: trim,
    bandPct: num(summary && summary.allocation && summary.allocation.band_pct),
    cashPctTotal: firstNum([brakeLines, pause], ['cash_pct_total']),
    netCashPctNw: firstNum([brakeLines, pause], ['net_cash_pct_nw']),
  };
}

function firstNum(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const value = num(source[key]);
      if (value != null) return value;
    }
  }
  return null;
}

function stockRows(summary) {
  const rows = Array.isArray(summary && summary.single_stocks) ? summary.single_stocks : [];
  return rows.map((row) => ({
    symbol: String((row && (row.symbol || row.asset_id)) || ''),
    name: String((row && (row.name || row.symbol || row.asset_id)) || '未命名'),
    weight: num(row && row.weight),
    overLimit: isYes(row && row.over_limit),
    overTrim: isYes(row && row.over_trim),
    paper: isPaper(row),
    raw: row || {},
  }));
}

function staleRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    symbol: String(row.symbol || row.asset_id || ''),
    name: String(row.name || row.symbol || row.asset_id || '未命名'),
    date: String(row.price_date || row.date || ''),
    limit: row.limit == null || row.limit === '' ? null : row.limit,
    paper: isPaper(row),
  };
}

export function isPaper(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.paper === true) return true;
  const mode = String(item.mode || '').toLowerCase();
  if (mode === 'paper') return true;
  return String(item.status || '').toLowerCase() === 'paper';
}

function paperLabels(summary, stocks) {
  const names = [];
  for (const row of stocks) {
    if (row.paper) names.push(row.name);
  }
  for (const item of Array.isArray(summary.advice) ? summary.advice : []) {
    if (isPaper(item) && item.title) names.push(String(item.title));
  }
  for (const item of Array.isArray(summary.stale) ? summary.stale : []) {
    if (isPaper(item)) names.push(String(item.name || item.symbol || '報價'));
  }
  return [...new Set(names)];
}

function isPegatron(row) {
  const values = [row && row.symbol, row && row.raw && row.raw.asset_id, row && row.raw && row.raw.symbol];
  return values.some((value) => {
    const text = String(value || '').toUpperCase();
    return text === '4938' || text.endsWith('-4938');
  });
}

function blockedByWindow(row, windowFlag) {
  return windowFlag === true && isPegatron(row);
}

function overLimit(row, thresholds) {
  if (row.overLimit) return true;
  return above(row.weight, thresholds.singleCap);
}

function overTrim(row, thresholds) {
  if (row.overTrim) return true;
  if (thresholds.trimAbove == null) return false;
  return above(row.weight, thresholds.trimAbove);
}

function above(weight, line) {
  return weight != null && line != null && weight > line + 1e-9;
}

function matchesStale(row, stale) {
  const keys = new Set([norm(row.symbol), norm(row.raw && row.raw.asset_id), norm(row.name)].filter(Boolean));
  return stale.some((item) => keys.has(norm(item.symbol)) || keys.has(norm(item.name)));
}

function norm(value) {
  return String(value || '').trim().toUpperCase();
}

function allocationGroups(summary) {
  const allocation = summary && summary.allocation && typeof summary.allocation === 'object' ? summary.allocation : {};
  const rows = (Array.isArray(allocation.rows) ? allocation.rows : []).filter((row) => !isPaper(row));
  const band = num(allocation.band_pct);
  const buckets = [
    ['equity', '股票／基金', EQUITY],
    ['bond', '債券', BOND],
    ['cash', '現金', CASH],
  ].map(([id, label, names]) => {
    const picked = rows.filter((row) => names.has(String(row.bucket || '').toLowerCase()));
    const actual = picked.reduce((sum, row) => sum + (num(row.actual_weight) || 0), 0);
    const target = picked.reduce((sum, row) => sum + (num(row.target_weight) || 0), 0);
    const drift = actual - target;
    const outside = band != null && picked.length > 0 && Math.abs(drift) > band / 100 + 1e-9;
    return { id, label, actual, target, drift, outside, count: picked.length };
  });
  return { known: band != null && rows.length > 0, band, buckets };
}

function cashView(summary, policy, thresholds) {
  const brake = summary && summary.cash_brake && typeof summary.cash_brake === 'object' ? summary.cash_brake : null;
  const advicePause = (Array.isArray(summary && summary.advice) ? summary.advice : [])
    .some((item) => item && !isPaper(item) && item.tag === 'dca_pause' && (item.level === 'warn' || item.level === 'amber'));
  const enabled = brake ? isYes(brake.enabled) : isYes(policy && policy.dca_pause && policy.dca_pause.enabled);
  const cashPct = brake ? num(brake.cash_pct_total) : null;
  const netPct = brake ? num(brake.net_cash_pct_nw) : null;
  const cashLine = thresholds.cashPctTotal;
  const netLine = thresholds.netCashPctNw;
  const numberBreach = (cashPct != null && cashLine != null && cashPct < cashLine) || (netPct != null && netLine != null && netPct < netLine);
  const flagged = brake ? isYes(brake.triggered) || numberBreach : advicePause;
  const near = !flagged && enabled && (
    (cashPct != null && cashLine != null && cashPct >= cashLine && cashPct < cashLine + CASH_NEAR_GAP)
    || (netPct != null && netLine != null && netPct >= netLine && netPct < netLine + CASH_NEAR_GAP)
  );
  return {
    present: !!brake || advicePause,
    enabled,
    flagged,
    pause: enabled && flagged,
    near,
    cashPct,
    netPct,
    cashLine,
    netLine,
    reason: brake && brake.reason ? String(brake.reason) : '',
  };
}

function hasDcaPlan(summary) {
  const dca = summary && summary.dca;
  if (!dca || typeof dca !== 'object') return false;
  if (isYes(dca.exempt_enabled)) return true;
  return Array.isArray(dca.core_assets) && dca.core_assets.length > 0;
}

function singleLight(real, all, thresholds, windowFlag) {
  const red = real.some((row) => overTrim(row, thresholds) && !blockedByWindow(row, windowFlag));
  const yellow = !red && real.some((row) => overLimit(row, thresholds) || overTrim(row, thresholds));
  const tone = red ? 'red' : yellow ? 'yellow' : 'green';
  const lines = [];
  lines.push(thresholds.singleCap == null ? '不加碼線未見於回傳。' : `不加碼線 ${pct(thresholds.singleCap)}`);
  if (thresholds.trimAbove != null) lines.push(`減碼線 ${pct(thresholds.trimAbove)}`);
  if (!real.length) lines.push('沒有實際個股。');
  for (const row of real) {
    lines.push(`${row.name} ${pct(row.weight)} · ${stockMark(row, thresholds, windowFlag)}`);
  }
  for (const row of all.filter((item) => item.paper)) {
    lines.push(`紙上倉 ${row.name} ${pct(row.weight)} · 不計入`);
  }
  return light('single', '個股', 'sec-holdings', tone, lines);
}

function bandLight(groups, estimates) {
  if (!groups.known) {
    return light('band', '配置', 'sec-allocation', 'yellow', ['還沒有配置或再平衡帶。']);
  }
  const outside = groups.buckets.some((bucket) => bucket.outside);
  const tone = outside ? 'red' : estimates.length ? 'yellow' : 'green';
  const lines = [`再平衡帶 ±${strip(groups.band)} 個百分點`];
  if (estimates.length) lines.push(`缺少市價，先用成本：${estimates.join('、')}`);
  for (const bucket of groups.buckets) {
    if (!bucket.count) {
      lines.push(`${bucket.label} 沒有這一類`);
      continue;
    }
    lines.push(`${bucket.label} ${pct(bucket.actual)}，目標 ${pct(bucket.target)} · ${bucket.outside ? '超出' : '帶內'}`);
  }
  return light('band', '配置', 'sec-allocation', tone, lines);
}

function cashLight(brake) {
  let tone = 'green';
  if (!brake.present && brake.cashLine == null) tone = 'yellow';
  else if (brake.pause) tone = 'red';
  else if ((brake.flagged && !brake.enabled) || brake.near) tone = 'yellow';
  const lines = [];
  lines.push(brake.enabled ? '現金煞車已開啟' : '現金煞車未開啟');
  lines.push(`現金佔總資產 ${pct(brake.cashPct)}，門檻 ${pct(brake.cashLine)}`);
  lines.push(`淨現金佔淨值 ${pct(brake.netPct)}，門檻 ${pct(brake.netLine)}`);
  if (brake.pause) lines.push('目前應暫停定額');
  else if (brake.flagged) lines.push('數字已低於門檻，但規則未開啟');
  else if (brake.near) lines.push('接近暫停門檻');
  else lines.push('未觸發暫停');
  return light('cash', '現金', 'sec-cash', tone, lines);
}

function quoteLight(stale, real, thresholds, estimates) {
  if (!stale.length) return light('quotes', '報價', 'sec-quotes', 'green', ['沒有超過門檻的報價。']);
  const estimateKeys = new Set(estimates.map((item) => norm(item)));
  const hurts = stale.some((item) => {
    const key = norm(item.symbol);
    if (estimateKeys.has(key)) return true;
    return real.some((row) => overTrim(row, thresholds) && matchesStale(row, [item]));
  });
  const lines = stale.map((item) => {
    const limit = item.limit == null ? '' : `，上限 ${item.limit} 天`;
    return `${item.name} 報價日 ${item.date || '—'}${limit}`;
  });
  return light('quotes', '報價', 'sec-quotes', hurts ? 'red' : 'yellow', lines);
}

function windowLight(windowFlag, real, summary) {
  const held = real.filter(isPegatron);
  const lines = [];
  if (windowFlag === true) lines.push('目前在財報前，不交易 4938');
  else if (windowFlag === false) lines.push('目前不在財報前的不交易窗口');
  else lines.push('還沒讀到財報前窗口');
  if (held.length) lines.push(`實際持有 ${held.map((row) => `${row.name} ${pct(row.weight)}`).join('、')}`);
  else lines.push('沒有實際的 4938 持倉');
  const compliance = (Array.isArray(summary.advice) ? summary.advice : [])
    .filter((item) => item && !isPaper(item) && item.tag === 'compliance' && item.title);
  for (const item of compliance) lines.push(String(item.title));
  const tone = windowFlag === true ? 'red' : windowFlag === false ? 'green' : 'yellow';
  return light('window', '4938', 'sec-pegatron', tone, lines);
}

function light(id, label, section, tone, lines) {
  return { id, label, section, tone, lines, fields: LIGHT_FIELDS[id] };
}

function cashReason(brake) {
  if (brake.pause) {
    return {
      text: `現金 ${pct(brake.cashPct)}／淨現金 ${pct(brake.netPct)}，暫停定額`,
      section: 'sec-cash',
    };
  }
  if (brake.flagged && !brake.enabled) {
    return { text: '現金已低於門檻，但煞車未開啟', section: 'sec-cash' };
  }
  if (brake.enabled) return { text: '現金未觸發煞車，定額照計畫', section: 'sec-cash' };
  return null;
}

function stockMark(row, thresholds, windowFlag) {
  if (blockedByWindow(row, windowFlag) && (overTrim(row, thresholds) || overLimit(row, thresholds))) return '財報前不交易';
  if (overTrim(row, thresholds)) return '建議分批減碼';
  if (overLimit(row, thresholds)) return '暫停加碼';
  return '帶內';
}

function trimText(rows, thresholds) {
  const names = rows.slice(0, 2).map((row) => `${row.name} ${pct(row.weight)}`).join('、');
  const line = thresholds.trimAbove != null ? `，超過減碼線 ${pct(thresholds.trimAbove)}` : '';
  return `${names} 建議分批減碼${line}`;
}

function pauseAddText(rows, thresholds) {
  const names = rows.slice(0, 2).map((row) => `${row.name} ${pct(row.weight)}`).join('、');
  const line = thresholds.singleCap != null ? `，超過不加碼線 ${pct(thresholds.singleCap)}` : '';
  return `${names} 暫停加碼${line}`;
}

function staleText(rows) {
  const first = rows[0];
  const extra = rows.length > 1 ? ` 等 ${rows.length} 檔` : '';
  return `${first.name}報價停在 ${first.date || '—'}${extra}`;
}

function bandText(groups) {
  const hit = groups.buckets.find((bucket) => bucket.outside) || groups.buckets[0];
  return `${hit.label} ${pct(hit.actual)}，超出 ±${strip(groups.band)} 個百分點`;
}

function takeReasons(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || !item.text || seen.has(item.section)) continue;
    seen.add(item.section);
    out.push(item);
    if (out.length === 3) break;
  }
  return out;
}

function bannerFor({ now, summary, asOfLabel, fetchFailed, fromCache, cacheStale, quoteStale, error }) {
  const when = asOfLabel || stamp(now);
  if (fetchFailed && fromCache) {
    return {
      kind: 'stale',
      title: '資料不是最新',
      text: `重新讀取失敗，先顯示暫存。資料時間 ${when}（Asia/Taipei）。`,
    };
  }
  const today = taipeiToday(now);
  const asOf = dateOnly(summary);
  if (asOf && asOf < today) {
    return {
      kind: 'stale',
      title: '資料不是最新',
      text: `資料不是今天。資料時間 ${when}（Asia/Taipei）。`,
    };
  }
  if (quoteStale) {
    return {
      kind: 'stale',
      title: '資料不是最新',
      text: `有過期報價。資料時間 ${when}（Asia/Taipei）。`,
    };
  }
  if (cacheStale) {
    return {
      kind: 'stale',
      title: '資料不是最新',
      text: `暫存尚未更新。資料時間 ${when}（Asia/Taipei）。`,
    };
  }
  if (fetchFailed) {
    return {
      kind: 'error',
      title: '讀不到今日行動',
      text: `讀不到今日行動。${errorMessage(error)}查詢時間 ${stamp(now)}（Asia/Taipei）。`,
    };
  }
  return null;
}

function asOfText(summary, now) {
  if (summary && typeof summary.at === 'string' && taipeiStamp(summary.at)) return taipeiStamp(summary.at);
  const day = dateOnly(summary);
  if (day) return day;
  return stamp(now);
}

function dateOnly(summary) {
  const asOf = summary && typeof summary.as_of === 'string' ? summary.as_of.slice(0, 10) : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return asOf;
  if (summary && typeof summary.at === 'string' && !Number.isNaN(Date.parse(summary.at))) return taipeiToday(new Date(summary.at));
  return '';
}

function stamp(now) {
  return taipeiStamp(now.toISOString()) || taipeiToday(now);
}

function errorMessage(error) {
  if (!error) return '請稍後再試。';
  return `${explainError(error.message, error.payload && error.payload.reason)}`;
}

function flag(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string' && value.toUpperCase() === 'TRUE') return true;
  if (typeof value === 'string' && value.toUpperCase() === 'FALSE') return false;
  return null;
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function strip(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
