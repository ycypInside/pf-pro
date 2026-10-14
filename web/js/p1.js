/** Plan, DCA, alerts, and holding-card helpers. Pure; no DOM. */

import { daysBetween } from './money.js';

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
