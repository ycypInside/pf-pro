/** Plan, DCA, alerts, and holding-card helpers. Pure; no DOM. */

import { daysBetween, isYes } from './money.js';

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

function isPathD(track) {
  const text = `${track.track || ''} ${track.label || ''}`;
  return /路徑\s*D|(^|\s)D($|\s)|path[-_\s]?d/i.test(text);
}

export function pathProgress(tracks, netWorth) {
  const track = (tracks || []).find((item) => isPathD(item));
  if (!track) return null;
  const start = Number(track.baseline_twd);
  const year1 = (track.milestones || []).find((item) => Number(item.year) === 1) || (track.milestones || [])[0] || null;
  const target = year1 ? Number(year1.target_twd) : NaN;
  const actual = Number.isFinite(Number(track.actual_twd)) ? Number(track.actual_twd) : Number(netWorth);
  let ratio = null;
  if (Number.isFinite(start) && Number.isFinite(target) && target !== start && Number.isFinite(actual)) {
    ratio = (actual - start) / (target - start);
  }
  return {
    label: trackLabel(track),
    start,
    target,
    actual,
    ratio,
    year: year1 ? year1.year : null,
  };
}

export function yiTrack(tracks) {
  return (tracks || []).find((item) => /上億/.test(`${item.track || ''}${item.label || ''}`)) || null;
}

export function dayChange(plan, performance) {
  if (!plan) return null;
  if (Number.isFinite(Number(plan.day_change_twd))) {
    const pct = Number(plan.day_change_pct);
    return { twd: Number(plan.day_change_twd), pct: Number.isFinite(pct) ? pct : null };
  }
  if (Number.isFinite(Number(plan.prev_net_worth_twd)) && Number.isFinite(Number(plan.net_worth_twd))) {
    const prev = Number(plan.prev_net_worth_twd);
    const now = Number(plan.net_worth_twd);
    return { twd: now - prev, pct: prev ? (now - prev) / prev : null };
  }
  const series = (performance && performance.series) || [];
  if (series.length < 2 || !Number.isFinite(Number(plan.net_worth_twd))) return null;
  const prev = series[series.length - 2];
  const last = series[series.length - 1];
  const gap = daysBetween(prev.date, last.date);
  if (gap < 1 || gap > 5) return null;
  const a = Number(prev.index);
  const b = Number(last.index);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) return null;
  const now = Number(plan.net_worth_twd);
  const before = now * (a / b);
  return { twd: now - before, pct: before ? (now - before) / before : null };
}

export function dcaStatusLine(items) {
  const counts = { debited: 0, pending: 0, paused_by_brake: 0 };
  for (const item of items || []) {
    if (Object.prototype.hasOwnProperty.call(counts, item.month_state)) counts[item.month_state] += 1;
  }
  return `本月定額：已扣款 ${counts.debited}、待扣款 ${counts.pending}、煞車暫停 ${counts.paused_by_brake}`;
}

function decisionDetail(alert) {
  return [alert.action, alert.reason, alert.detail].filter(Boolean).join(' · ');
}

function isExitAlert(alert) {
  const type = String(alert.type || '');
  const text = `${alert.action || ''}${alert.reason || ''}`;
  const exit = type === 'close_below' || type === 'close_above' || /出場/.test(text);
  return exit && (alert.level === 'red' || alert.level === 'amber');
}

function isTicketAlert(alert) {
  const type = String(alert.type || alert.kind || '');
  return type === 'trade_ticket' || type === 'ticket' || type === 'pending_ticket';
}

export function quoteMap(quotes) {
  if (!quotes) return {};
  if (Array.isArray(quotes)) {
    return Object.fromEntries(quotes.map((quote) => [quote.asset_id || quote.symbol, quote]));
  }
  return quotes;
}

function hasDecisionList(data) {
  return Array.isArray(data.items) || Array.isArray(data.decisions);
}

export function collectDecisions({ decisions, alerts, dcaItems, quotes } = {}) {
  if (decisions && decisions.ok !== false && hasDecisionList(decisions)) {
    const rows = decisions.items || decisions.decisions;
    return {
      known: true,
      items: rows.map((item) => ({
        kind: item.kind || item.type || 'info',
        title: item.title || item.name || item.action || '待決定',
        detail: item.detail || item.reason || '',
      })).filter((item) => item.title),
    };
  }
  const items = [];
  const seen = new Set();
  const add = (item) => {
    const key = `${item.kind}:${item.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  let known = false;
  if (Array.isArray(alerts)) {
    known = true;
    for (const alert of alerts) {
      if (isExitAlert(alert)) add({ kind: 'exit', title: `${alert.name || '持股'} 出場線已觸發`, detail: decisionDetail(alert) });
      else if (alert.type === 'stale_quote') add({ kind: 'stale', title: `${alert.name || '報價'} 報價過期`, detail: decisionDetail(alert) });
      else if (isTicketAlert(alert)) add({ kind: 'ticket', title: alert.name ? `${alert.name} 待處理交易單` : '待處理交易單', detail: decisionDetail(alert) });
    }
  }
  if (Array.isArray(dcaItems)) {
    for (const item of dcaItems) {
      if (item.month_state === 'paused_by_brake') {
        add({ kind: 'dca', title: `${item.name || item.symbol || '定額'} 定額暫停`, detail: '現金煞車，這個月先不扣。' });
      }
    }
  }
  if (quotes && typeof quotes === 'object') {
    for (const [id, quote] of Object.entries(quoteMap(quotes))) {
      if (!quote || !isYes(quote.is_stale)) continue;
      const name = quote.name || quote.symbol || id;
      add({ kind: 'stale', title: `${name} 報價過期`, detail: quote.price_date ? `價格日 ${quote.price_date}` : '' });
    }
  }
  return { known, items };
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
    };
  });
}

const PAPER_BENCHMARKS = ['0050', '00631L'];

export function paperSleeves(payload) {
  const source = (payload && (payload.sleeves || payload.rows || payload.books)) || [];
  const byId = new Map();
  for (const row of source) {
    const raw = String(row.sleeve || row.id || row.name || '').replace(/^紙上倉\s*/, '');
    if (raw) byId.set(raw, row);
  }
  return ['A', 'B', 'C'].map((id) => {
    const row = byId.get(id) || {};
    const bench = row.benchmark || row.vs || row.benchmarks;
    const benchmarks = Array.isArray(bench)
      ? bench.filter(Boolean)
      : bench ? String(bench).split(/[、,\s]+/).filter(Boolean) : PAPER_BENCHMARKS;
    return {
      id,
      benchmarks: benchmarks.length ? benchmarks : PAPER_BENCHMARKS,
      positions: row.positions || row.holdings || [],
    };
  });
}
