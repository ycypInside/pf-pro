/** Plan, DCA, alerts, and holding-card helpers. Pure; no DOM. */

import { daysBetween, isYes } from './money.js';
import { cardCloseBasis, paperStale, rowStale } from './research.js';

const MONTHS = 30.4375;

export const ALERT_LABELS = {
  red: '重大',
  amber: '注意',
  watch: '觀察',
  upcoming: '即將到期',
  info: '提示',
};

const STATE_LABELS = {
  debited: '已扣款',
  pending: '待扣款',
  paused_by_brake: '煞車暫停',
  paused: '已暫停',
  retired: '已結束',
};

const RULE_TYPES = {
  close_below: '收盤低於價位',
  close_above: '收盤高於價位',
  dd_from_peak: '自高點回檔',
  pct_nw_above: '佔淨值比例',
  date_reached: '日期條件',
  stale_quote: '報價過期',
};

export function monthsElapsed(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  return Math.max(0, daysBetween(fromDate, toDate) / MONTHS);
}

/** Same monthly-compound path the plan sheet uses: baseline, monthly contribution, CAGR. */
export function plannedValue(track, date) {
  const months = monthsElapsed(track && track.baseline_date, date);
  const baseline = Number(track && track.baseline_twd) || 0;
  const monthly = Number(track && track.monthly_twd) || 0;
  const cagr = Number(track && track.cagr) || 0;
  const r = (1 + cagr) ** (1 / 12) - 1;
  const growth = baseline * (1 + r) ** months;
  const contrib = r ? (monthly * ((1 + r) ** months - 1)) / r : monthly * months;
  return growth + contrib;
}

export function planPoints(track, asOf) {
  const dates = [];
  const add = (date) => {
    if (date && !dates.includes(date)) dates.push(date);
  };
  add(track && track.baseline_date);
  add(asOf);
  for (const milestone of (track && track.milestones) || []) add(milestone.target_date);
  dates.sort();
  return dates.map((date) => ({ date, y: plannedValue(track, date) }));
}

export function trackLabel(track) {
  if (!track) return '計畫';
  if (track.label) return track.label;
  if (track.track === 'main') return '主計畫';
  return track.track || '計畫';
}

export function debitDayLabel(day) {
  if (day === null || day === undefined || day === '') return '待補';
  const n = Number(day);
  if (!Number.isFinite(n) || n <= 0) return '待補';
  return `每月 ${n} 日`;
}

export function monthStateLabel(state) {
  return STATE_LABELS[state] || state || '—';
}

export function canMarkDebited(item) {
  return !!item && !!item.dca_id && (item.month_state === 'pending' || item.month_state === 'paused_by_brake');
}

export function dcaRows(items) {
  return [...(items || [])].sort((a, b) => Number(!!b.core) - Number(!!a.core));
}

export function alertLevel(level) {
  return Object.prototype.hasOwnProperty.call(ALERT_LABELS, level) ? level : 'info';
}

export function cardsForAsset(cards, assetId) {
  const id = String(assetId || '');
  return (cards || []).filter((card) => {
    if (card.status === 'retired') return false;
    return (card.asset_ids || []).map(String).includes(id);
  });
}

export function rulePriceLines(cards) {
  const lines = [];
  for (const card of cards || []) {
    for (const rule of card.rules || []) {
      if (rule.status && rule.status !== 'active') continue;
      const price = Number(rule.level);
      if (!Number.isFinite(price) || price <= 0) continue;
      lines.push({ price, label: rule.action || rule.rule_key || '' });
    }
  }
  return lines;
}

export function ruleTypeLabel(type) {
  return RULE_TYPES[type] || type || '';
}

export function wanLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const wan = Math.abs(n) / 10000;
  const text = wan >= 100 ? Math.round(wan).toLocaleString('en-US') : wan.toFixed(2);
  return `${n < 0 ? '−' : ''}${text}萬`;
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function pathProgress(plan) {
  const path = plan && plan.path_d;
  if (!path) return null;
  return {
    start: finiteOrNull(path.start_twd),
    startDate: path.start_date || '',
    target: finiteOrNull(path.year1_target_twd),
    year1Date: path.year1_date || '',
    actual: finiteOrNull(path.actual_twd),
    ratio: finiteOrNull(path.progress_pct),
    remaining: finiteOrNull(path.remaining_twd),
  };
}

export function yiTrack(tracks) {
  return (tracks || []).find((item) => /上億/.test(`${item.track || ''}${item.label || ''}`)) || null;
}

export function dayChange(source) {
  if (!source) return null;
  const change = source.nw_day_change
    || (Object.prototype.hasOwnProperty.call(source, 'change_twd') ? source : null);
  if (!change) return null;
  return {
    twd: finiteOrNull(change.change_twd),
    pct: finiteOrNull(change.change_pct),
    date: change.date || '',
    prevDate: change.prev_date || '',
  };
}

export function dcaStatusLine(items) {
  const counts = { debited: 0, pending: 0, paused_by_brake: 0 };
  for (const item of items || []) {
    if (Object.prototype.hasOwnProperty.call(counts, item.month_state)) counts[item.month_state] += 1;
  }
  return `本月定額：已扣款 ${counts.debited}、待扣款 ${counts.pending}、煞車暫停 ${counts.paused_by_brake}`;
}

const DECISION_DISCLAIMER = '待決事項僅為提醒，不是操作單。';

export function decisionView(data) {
  const disclaimer = (data && data.disclaimer) || DECISION_DISCLAIMER;
  if (!data || data.ok === false) return { known: false, count: 0, items: [], disclaimer };
  const items = (data.items || []).map((item) => ({
    kind: item.kind || '',
    level: item.level || '',
    title: item.title || '',
    detail: item.detail || '',
    ref: item.ref || '',
  }));
  const count = data.count == null ? items.length : Number(data.count);
  return { known: true, count: Number.isFinite(count) ? count : items.length, items, disclaimer };
}

export function quoteMap(quotes) {
  if (!quotes) return {};
  if (Array.isArray(quotes)) {
    return Object.fromEntries(quotes.map((quote) => [quote.asset_id || quote.symbol, quote]));
  }
  return quotes;
}

function dayCount(alerts, rule) {
  const fallback = rule && Number(rule.confirm_days) > 0 ? Number(rule.confirm_days) : null;
  for (const alert of alerts) {
    const matched = /(\d+)\s*\/\s*(\d+)/.exec(String(alert.detail || ''));
    if (matched) return { current: Number(matched[1]), total: Number(matched[2]) };
    if (Number.isFinite(Number(alert.confirm_count)) && Number.isFinite(Number(alert.confirm_days))) {
      return { current: Number(alert.confirm_count), total: Number(alert.confirm_days) };
    }
  }
  return fallback ? { current: 0, total: fallback } : null;
}

function thesisDate(rules) {
  const list = rules || [];
  const named = list.find((rule) => rule.date && /論點|檢討/.test(`${rule.action || ''}${rule.reason || ''}`));
  if (named) return named.date;
  const dated = list.find((rule) => rule.type === 'date_reached' && rule.date);
  return dated ? dated.date : '';
}

export function cardViews(cards, quotes, alerts) {
  const map = quoteMap(quotes);
  return (cards || []).filter((card) => card.status !== 'retired').map((card) => {
    const ids = (card.asset_ids || []).map(String);
    const id = ids.find((key) => map[key]) || ids[0] || '';
    const quote = map[id] || {};
    const price = Number(quote.last);
    const rules = (card.rules || []).filter((rule) => !rule.status || rule.status === 'active');
    const exitRule = rules.find((rule) => rule.type === 'close_below' && Number(rule.level) > 0)
      || rules.find((rule) => /出場/.test(`${rule.action || ''}${rule.reason || ''}`) && Number(rule.level) > 0);
    const exit = exitRule ? Number(exitRule.level) : null;
    const related = (alerts || []).filter((alert) => alert.card_key === card.card_key
      || ids.includes(String(alert.asset_id || ''))
      || (alert.asset_ids || []).map(String).some((key) => ids.includes(key))
      || alert.name === card.name);
    return {
      name: card.name || card.card_key || id,
      symbol: quote.symbol || id,
      price: Number.isFinite(price) ? price : null,
      currency: quote.currency || 'TWD',
      stale: isYes(quote.is_stale),
      exit,
      distance: Number.isFinite(price) && exit ? price / exit - 1 : null,
      day: dayCount(related, exitRule),
      thesis: thesisDate(rules),
      closeBasis: cardCloseBasis(card, related),
    };
  });
}

export function benchmarkSymbol(symbol) {
  return String(symbol || '') === '50' ? '0050' : String(symbol || '');
}

export function paperView(payload) {
  const data = payload && payload.ok !== false ? payload : {};
  const book = paperStale(data);
  const rows = data.sleeves || [];
  const sleeves = ['A', 'B', 'C'].map((id) => {
    const row = rows.find((item) => String(item.sleeve) === id) || { sleeve: id };
    const gate = row.gate || {};
    return {
      sleeve: id,
      label: row.label || `紙上倉 ${id}`,
      status: row.status || '',
      asOf: row.as_of || '',
      capital: finiteOrNull(row.capital_twd),
      equity: finiteOrNull(row.equity_twd),
      cash: finiteOrNull(row.cash_twd),
      cashPct: finiteOrNull(row.cash_pct),
      returnPct: finiteOrNull(row.return_pct),
      drawdownPct: finiteOrNull(row.drawdown_pct),
      maxDdPct: finiteOrNull(row.max_dd_pct),
      tradingDays: row.trading_days_label || '',
      annualizedPct: finiteOrNull(row.annualized_pct),
      annualizedTarget: finiteOrNull(row.annualized_target_pct),
      annualizedOk: row.annualized_ok === true,
      vs0050: finiteOrNull(row.vs_0050_pp),
      vs631: finiteOrNull(row.vs_00631L_pp),
      flags: row.flags || [],
      gate: {
        target: finiteOrNull(gate.target != null ? gate.target : gate.gate_target_pct),
        minTradingDays: finiteOrNull(gate.min_trading_days),
        goLive: gate.go_live_allowed === true,
        checks: (gate.checks || []).map((check) => ({
          label: check.label || '',
          current: check.current == null ? '' : String(check.current),
          ok: check.ok === true,
        })),
      },
      positions: row.positions || [],
      series: row.series || [],
      present: rows.some((item) => String(item.sleeve) === id),
      stale: rowStale(row, book),
    };
  });
  const benchmarks = {};
  for (const [key, value] of Object.entries(data.benchmarks || {})) {
    const symbol = benchmarkSymbol((value && value.symbol) || key);
    if (!symbol) continue;
    benchmarks[symbol] = {
      symbol,
      asOf: (value && value.as_of) || '',
      returnPct: finiteOrNull(value && value.return_pct),
      maxDdPct: finiteOrNull(value && value.max_dd_pct),
      series: (value && value.series) || [],
      stale: rowStale(value, book),
    };
  }
  return {
    mode: data.mode || 'paper',
    note: data.note || '模擬倉，與實際持倉完全分開，不計入淨值與配置。',
    stale: book.stale,
    staleNote: book.note,
    sleeves,
    benchmarks,
  };
}
