/** Fund composition, stock rotation, close-basis, and paper-stale helpers. Pure; no DOM. */

import { isYes } from './money.js';

export const RESEARCH_FOOT = '僅供研究參考，非交易建議；和碩僅使用公開資料。';

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sameToken(a, b) {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  return left !== '' && left === right;
}

export function weightText(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Number(value).toFixed(2)}%`;
}

export function weightWidth(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Number(value)));
}

export function httpUrl(value) {
  const text = String(value || '').trim();
  if (/^https?:\/\//i.test(text)) return text;
  return '';
}

export function fundTypeLabel(type) {
  return type === 'etf' ? 'ETF' : '基金';
}

export function directlyHeld(row, overlap) {
  const name = row && row.name;
  const symbol = row && row.symbol;
  return (overlap || []).some((item) => {
    const holding = item && item.holding_name;
    return sameToken(holding, name) || sameToken(holding, symbol);
  });
}

function barRows(rows) {
  return (rows || []).filter((row) => row && (row.name || Number.isFinite(Number(row.weight_pct)))).map((row) => ({
    name: row.name || '',
    weight: finiteOrNull(row.weight_pct),
  }));
}

export function fundViews(payload) {
  const data = payload && payload.ok !== false ? payload : {};
  const funds = (data.funds || []).map((fund) => ({
    fundId: fund.fund_id || '',
    name: fund.name || fund.symbol || '基金',
    symbol: fund.symbol || '',
    type: fund.fund_type === 'etf' ? 'etf' : 'fund',
    typeLabel: fundTypeLabel(fund.fund_type),
    held: finiteOrNull(fund.held_value_twd),
    dataDate: fund.data_date || '',
    sectorsDate: fund.sectors_date || '',
    regionsDate: fund.regions_date || '',
    top10: (fund.top10 || []).map((row) => ({
      rank: row.rank,
      name: row.name || '',
      symbol: row.symbol || '',
      weight: finiteOrNull(row.weight_pct),
      held: directlyHeld(row, fund.overlap),
    })),
    sectors: barRows(fund.sectors),
    regions: barRows(fund.regions),
    href: httpUrl(fund.source),
  }));
  return {
    fileDate: data.file_date || '',
    sourceNote: data.source_note || '',
    funds,
    lookthrough: (data.lookthrough || []).map((row) => ({
      name: row.name || row.symbol || '',
      symbol: row.symbol || '',
      direct: finiteOrNull(row.direct_value_twd),
      via: finiteOrNull(row.via_funds_twd),
      total: finiteOrNull(row.total_twd),
      funds: (row.funds || []).map((fund) => ({
        name: fund.fund_name || fund.fund_id || '',
        weight: finiteOrNull(fund.fund_weight_pct),
        via: finiteOrNull(fund.via_fund_twd),
      })),
    })),
    crossFund: (data.cross_fund || []).map((row) => ({
      name: row.name || '',
      funds: (row.funds || []).map((fund) => ({
        name: fund.fund_name || fund.fund_id || '',
        weight: finiteOrNull(fund.weight_pct),
      })),
    })),
  };
}

export function taipeiToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function rotationWeeks(rows, today) {
  const groups = [];
  const index = new Map();
  for (const row of rows || []) {
    const key = row.week_start || '';
    if (!index.has(key)) {
      const group = { weekStart: key, weekEnd: row.week_end || '', rows: [] };
      index.set(key, group);
      groups.push(group);
    }
    const group = index.get(key);
    if (!group.weekEnd && row.week_end) group.weekEnd = row.week_end;
    group.rows.push({
      market: row.market === 'US' ? 'US' : 'TW',
      symbol: row.symbol || '',
      name: row.name || '',
      note: row.note || '',
      reportDate: row.report_date || row.latest_report_date || '',
      hasReport: row.has_report === true,
      current: row.is_current === true,
    });
  }
  const anyCurrent = groups.some((group) => group.rows.some((row) => row.current));
  let highlightKey = '';
  if (anyCurrent) {
    const current = groups.find((group) => group.rows.some((row) => row.current));
    highlightKey = current ? current.weekStart : '';
  } else {
    const upcoming = groups.find((group) => group.weekStart && group.weekStart >= (today || ''));
    const chosen = upcoming || groups[groups.length - 1];
    highlightKey = chosen ? chosen.weekStart : '';
  }
  for (const group of groups) {
    const weekOn = group.weekStart === highlightKey;
    for (const row of group.rows) row.highlight = anyCurrent ? row.current : weekOn;
  }
  return groups;
}

export function rotationView(payload, today) {
  const data = payload && payload.ok !== false ? payload : {};
  return {
    cadence: data.cadence || '',
    fileDate: data.file_date || '',
    weeks: rotationWeeks(data.rotation, today || taipeiToday()),
    reports: (data.reports || []).map((row) => ({
      symbol: row.symbol || '',
      reportDate: row.report_date || '',
      title: row.title || row.symbol || '報告',
      chars: finiteOrNull(row.chars),
      inRotation: row.in_rotation === true,
    })),
  };
}

export function closeBasisLabel(item) {
  if (!item || !item.close_date) return '';
  if (item.trigger_basis === 'close' || item.close_date) return `以 ${item.close_date} 收盤判定`;
  return '';
}

export function cardCloseBasis(card, alerts) {
  const rules = (card && card.rules) || [];
  const related = alerts || [];
  const date = (card && card.close_date)
    || rules.map((rule) => rule && rule.close_date).find(Boolean)
    || related.map((alert) => alert && alert.close_date).find(Boolean)
    || '';
  if (!date) return '';
  const basis = (card && (card.trigger_basis === 'close' || card.close_date))
    || rules.some((rule) => rule && (rule.trigger_basis === 'close' || rule.close_date))
    || related.some((alert) => alert && (alert.trigger_basis === 'close' || alert.close_date));
  return basis ? `以 ${date} 收盤判定` : '';
}

export function staleParts(value) {
  if (value === true || isYes(value)) return { stale: true, note: '' };
  if (typeof value === 'string') {
    const note = value.trim();
    if (note && note.toUpperCase() !== 'FALSE') return { stale: true, note };
  }
  return { stale: false, note: '' };
}

export function paperStale(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const book = staleParts(data.is_stale);
  const noteField = staleParts(data.stale);
  const stale = book.stale || noteField.stale;
  const note = noteField.note || (stale ? '這份紙上倉數字已過期' : '');
  return { stale, note };
}

export function rowStale(row, book) {
  if (book && book.stale) return true;
  const flag = staleParts(row && row.is_stale);
  const note = staleParts(row && row.stale);
  return flag.stale || note.stale;
}
