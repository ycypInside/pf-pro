import { h } from './dom.js';
import { taipeiMonth } from './money.js';
import { cacheKey, staleView, writeCache } from './swr.js';

export const OVERVIEW_PARTS = ['summary', 'balances', 'quotes', 'advice', 'holdings', 'alerts', 'plan', 'decisions'];

export function overviewQuery(month, now = new Date()) {
  if (!month || !month.from || !month.to) return {};
  const current = taipeiMonth(now);
  if (month.from === current.from && month.to === current.to) return {};
  return { from: month.from, to: month.to };
}

export function chartQuery(row) {
  const source = row || {};
  const asset = source.asset_id || source.id || source.symbol || '';
  const symbol = source.symbol || asset;
  if (!asset && !symbol) return {};
  const id = asset || symbol;
  return {
    asset: id,
    symbol: symbol || id,
    asset_id: source.asset_id || id,
    id: source.id || id,
  };
}

export function asTryGet(part) {
  if (part && part.ok !== false) return { ok: true, data: part };
  const message = (part && part.error) || '讀取失敗';
  const error = new Error(message);
  error.payload = part && typeof part === 'object' ? part : { ok: false, error: message };
  return { ok: false, error };
}

export function partsFromEnvelope(envelope, names) {
  const parts = {};
  for (const name of names) {
    parts[name] = asTryGet(envelope && envelope.parts && envelope.parts[name]);
  }
  return parts;
}

export function partNeedsFallback(envelope, name) {
  if (!envelope || envelope.ok === false) return true;
  if ((envelope.errors || []).includes(name)) return true;
  const part = envelope.parts && envelope.parts[name];
  return !part || part.ok === false;
}

export async function fillFailed(get, names, envelope, extras = {}) {
  const missing = names.filter((name) => partNeedsFallback(envelope, name));
  const fetched = {};
  await Promise.all(missing.map(async (name) => {
    fetched[name] = await get(name, extras[name]);
  }));
  const parts = {};
  for (const name of names) parts[name] = fetched[name] || asTryGet(envelope.parts[name]);
  return parts;
}

function carryFx(target, source) {
  const next = { ...(target || {}) };
  if (!source || typeof source !== 'object') return next;
  for (const key of ['fx_rate', 'fx_as_of', 'fx_source']) {
    if ((next[key] == null || next[key] === '') && source[key] != null && source[key] !== '') next[key] = source[key];
  }
  return next;
}

export function assembleOverview(parts) {
  const summary = parts.summary;
  const balances = parts.balances;
  const quotes = parts.quotes;
  const advice = parts.advice;
  const holdings = parts.holdings;
  const alerts = parts.alerts;
  const plan = parts.plan;
  const decisions = parts.decisions;
  if (summary && summary.ok) {
    const data = summary.data;
    const balanceData = balances && balances.ok
      ? { institutions: [], ...balances.data, net_worth: balances.data.net_worth || data.net_worth }
      : { balances: data.balances || [], net_worth: data.net_worth, institutions: [] };
    return {
      accountsR: { ok: true, data: { accounts: data.accounts || [] } },
      balancesR: { ok: true, data: carryFx(balanceData, data) },
      incomeR: { ok: true, data: { report: data.report } },
      checksR: { ok: true, data: { warnings: data.warnings || [] } },
      pricesR: { ok: true, data: { quotes: data.quotes || [], last_valuations: data.last_valuations || [], stale: data.stale || [] } },
      holdingsR: holdings && holdings.ok ? holdings : { ok: true, data: { holdings: data.holdings || [] } },
      quotesR: quotes,
      adviceR: advice,
      alertsR: alerts,
      planR: plan,
      decisionsR: decisions,
    };
  }
  return {
    accountsR: summary,
    balancesR: summary,
    incomeR: summary,
    checksR: summary,
    pricesR: summary,
    holdingsR: summary,
    quotesR: quotes,
    adviceR: advice,
    alertsR: alerts,
    planR: plan,
    decisionsR: decisions,
  };
}

export function viewFromOverview(envelope) {
  return assembleOverview(partsFromEnvelope(envelope, OVERVIEW_PARTS));
}

export function freshnessNote(meta) {
  if (!meta || !meta.stale || !meta.label) return null;
  return h('p', { class: 'estimate swr', role: 'status' }, meta.label);
}

export async function fetchBundle(get, names, extras = {}, opts = {}) {
  const list = (names || []).slice();
  if (!list.length) return { parts: {}, envelope: null };
  const bundleR = await get('bundle', { parts: list.join(',') });
  const usable = bundleR.ok && bundleR.data && bundleR.data.ok !== false;
  if (!usable) {
    const parts = {};
    await Promise.all(list.map(async (name) => {
      parts[name] = await get(name, extras[name]);
    }));
    return { parts, envelope: null };
  }
  const parts = await fillFailed(get, list, bundleR.data, extras);
  writeCache(cacheKey('bundle', list, opts.month), bundleR.data, opts.storage, opts.token, opts.savedAt);
  return { parts, envelope: bundleR.data };
}

export async function fetchOverview(month, get, opts = {}) {
  const now = opts.now || new Date();
  const summaryParams = month ? { from: month.from, to: month.to } : undefined;
  const overviewR = await get('overview', overviewQuery(month, now));
  if (overviewR.ok && overviewR.data && overviewR.data.ok !== false) {
    const parts = await fillFailed(get, OVERVIEW_PARTS, overviewR.data, { summary: summaryParams });
    writeCache(cacheKey('overview', [], month), overviewR.data, opts.storage, opts.token, opts.savedAt);
    return assembleOverview(parts);
  }
  const parts = {};
  await Promise.all(OVERVIEW_PARTS.map(async (name) => {
    parts[name] = await get(name, name === 'summary' ? summaryParams : undefined);
  }));
  const summary = parts.summary;
  if (summary && !summary.ok && summary.error && summary.error.message === 'unknown q') {
    const [accountsR, balancesR, incomeR, checksR, pricesR, holdingsR] = await Promise.all([
      get('accounts'),
      get('balances'),
      get('income_expense', summaryParams),
      get('checks'),
      get('prices'),
      get('holdings'),
    ]);
    return {
      accountsR,
      balancesR,
      incomeR,
      checksR,
      pricesR,
      holdingsR,
      quotesR: parts.quotes,
      adviceR: parts.advice,
      alertsR: parts.alerts,
      planR: parts.plan,
      decisionsR: parts.decisions,
    };
  }
  return assembleOverview(parts);
}

export { cacheKey, readCache, staleView } from './swr.js';
