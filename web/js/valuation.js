/** Optional price basis, estimate flags, and FX stamps. Missing fields stay blank. */

import { h } from './dom.js';
import { formatRate } from './format.js';

export const ESTIMATE_NOTE = '有淨值或匯率超過 2 天';

const BASES = new Set(['close', 'intraday', 'nav', 'manual_pending']);

export function isEstimate(value) {
  return value === true || value === 'true' || value === 'TRUE';
}

export function quoteMarks(row) {
  const data = row && typeof row === 'object' ? row : {};
  const basis = BASES.has(data.price_basis) ? data.price_basis : '';
  const estimate = isEstimate(data.estimate);
  const badges = [];
  if (basis === 'intraday') badges.push({ id: 'intraday', label: '盤中' });
  if (estimate) badges.push({ id: 'estimate', label: '估' });
  if (basis === 'manual_pending') badges.push({ id: 'manual', label: '待手動' });
  return {
    basis,
    date: typeof data.price_date === 'string' ? data.price_date : '',
    estimate,
    pending: basis === 'manual_pending',
    badges,
  };
}

export function collectQuotes(quotes) {
  if (!quotes) return [];
  if (Array.isArray(quotes)) return quotes.filter(Boolean);
  if (typeof quotes === 'object') return Object.values(quotes).filter((row) => row && typeof row === 'object');
  return [];
}

export function priceDateRange(rows) {
  const dates = [];
  for (const row of rows || []) {
    const date = row && typeof row.price_date === 'string' ? row.price_date : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.push(date);
  }
  dates.sort();
  if (!dates.length) return '';
  return dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}–${dates[dates.length - 1]}`;
}

export function taipeiStamp(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  if (!parts.year || !parts.hour) return iso;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function finiteRate(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function fxView(books, quotes) {
  let rate = null;
  let asOf = '';
  let source = '';
  for (const book of books || []) {
    if (!book || typeof book !== 'object') continue;
    if (rate == null) rate = finiteRate(book.fx_rate);
    if (!asOf && typeof book.fx_as_of === 'string') asOf = book.fx_as_of;
    if (!source && typeof book.fx_source === 'string') source = book.fx_source;
  }
  if (rate == null) {
    const fx = collectQuotes(quotes).find((row) => row.kind === 'fx' && finiteRate(row.value ?? row.last) != null);
    if (fx) rate = finiteRate(fx.value ?? fx.last);
  }
  return { rate, asOf, source, time: taipeiStamp(asOf) };
}

export function valuationFacts({ quotes, holdings, books } = {}) {
  const rows = [...collectQuotes(quotes), ...(Array.isArray(holdings) ? holdings : [])];
  return {
    dates: priceDateRange(rows),
    fx: fxView(books, quotes),
    estimate: rows.some((row) => isEstimate(row && row.estimate)),
  };
}

export function valuationNote(facts, className = 'valuation') {
  if (!facts) return null;
  const fx = facts.fx || {};
  const fxBits = [];
  if (fx.rate != null) fxBits.push(`匯率 ${formatRate(fx.rate)}`);
  if (fx.time) fxBits.push(fx.time);
  if (fx.source) fxBits.push(fx.source);
  if (!facts.dates && !fxBits.length && !facts.estimate) return null;
  return h('div', { class: className },
    facts.dates ? h('p', { class: 'valuation-line' }, `價格 ${facts.dates}`) : null,
    fxBits.length ? h('p', { class: 'valuation-line' }, fxBits.join(' · ')) : null,
    facts.estimate ? h('p', { class: 'estimate valuation-line' }, `估 ${ESTIMATE_NOTE}`) : null);
}
