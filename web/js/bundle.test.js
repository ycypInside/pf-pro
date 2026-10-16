import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleOverview,
  chartQuery,
  fetchBundle,
  fetchOverview,
  overviewQuery,
  partNeedsFallback,
} from './bundle.js';
import { taipeiMonth } from './money.js';
import {
  STALE_MS,
  afterWrite,
  cacheKey,
  readCache,
  staleView,
  writeCache,
} from './swr.js';

function memoryStorage(limit = Infinity) {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      if (!map.has(key) && map.size >= limit) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      map.set(key, String(value));
    },
    removeItem(key) { map.delete(key); },
  };
}

function part(body) {
  return { ok: true, ...body };
}

test('current month overview omits from and to', () => {
  const now = new Date('2026-10-14T04:00:00Z');
  const month = taipeiMonth(now);
  assert.deepEqual(overviewQuery(month, now), {});
  assert.deepEqual(overviewQuery({ from: '2026-09-01', to: '2026-09-30' }, now), {
    from: '2026-09-01',
    to: '2026-09-30',
  });
});

test('chart accepts 0050 on asset, symbol, asset_id, or id', () => {
  const query = chartQuery({ symbol: '0050' });
  assert.equal(query.asset, '0050');
  assert.equal(query.symbol, '0050');
  assert.equal(query.asset_id, '0050');
  assert.equal(query.id, '0050');
  const named = chartQuery({ asset_id: 'TW-0050', symbol: '0050', id: 'row-1' });
  assert.equal(named.asset, 'TW-0050');
  assert.equal(named.symbol, '0050');
  assert.equal(named.asset_id, 'TW-0050');
  assert.equal(named.id, 'row-1');
});

test('overview parts map onto the old tryGet shapes', () => {
  const view = assembleOverview({
    summary: { ok: true, data: part({
      accounts: [{ account_id: 'cash' }],
      report: { by_category: [] },
      quotes: [{ symbol: '0050' }],
      warnings: ['檢查'],
      net_worth: { net_worth_twd: 5 },
      fx_as_of: '2026-10-14T01:30:00Z',
      fx_source: 'BOT',
      fx_rate: 30,
      holdings: [{ asset_id: 'h' }],
      last_valuations: [],
      stale: [],
    }) },
    balances: { ok: true, data: part({ balances: [{ account_id: 'cash' }], net_worth: { net_worth_twd: 9 }, fx_rate: 32.15 }) },
    quotes: { ok: true, data: part({ quotes: { '0050': { last: 1 } } }) },
    advice: { ok: false, error: Object.assign(new Error('nope'), { payload: { ok: false, error: 'nope' } }) },
    holdings: { ok: true, data: part({ holdings: [] }) },
    alerts: { ok: true, data: part({ alerts: [] }) },
    plan: { ok: true, data: part({ path_d: { start_twd: 1 } }) },
    decisions: { ok: true, data: part({ count: 0, items: [] }) },
  });
  assert.equal(view.accountsR.data.accounts[0].account_id, 'cash');
  assert.equal(view.balancesR.data.net_worth.net_worth_twd, 9);
  assert.equal(view.balancesR.data.fx_rate, 32.15);
  assert.equal(view.balancesR.data.fx_as_of, '2026-10-14T01:30:00Z');
  assert.equal(view.balancesR.data.fx_source, 'BOT');
  assert.deepEqual(view.incomeR.data.report.by_category, []);
  assert.equal(view.checksR.data.warnings[0], '檢查');
  assert.equal(view.pricesR.data.quotes[0].symbol, '0050');
  assert.equal(view.quotesR.data.quotes['0050'].last, 1);
  assert.equal(view.adviceR.ok, false);
  assert.equal(view.planR.data.path_d.start_twd, 1);
  assert.equal(view.decisionsR.data.count, 0);
  assert.equal(view.holdingsR.data.holdings.length, 0);
});

test('a failed bundle part falls back alone and a dead bundle falls back in parallel', async () => {
  const calls = [];
  const get = async (q) => {
    calls.push(q);
    if (q === 'bundle') {
      return {
        ok: true,
        data: {
          ok: true,
          errors: ['dca'],
          parts: {
            plan: { ok: true, tracks: [{ track: 'main' }] },
            dca: { ok: false, error: 'boom' },
          },
        },
      };
    }
    assert.equal(q, 'dca');
    return { ok: true, data: { ok: true, items: [{ dca_id: 'a' }] } };
  };
  const storage = memoryStorage();
  const month = { from: '2026-10-01', to: '2026-10-31' };
  const loaded = await fetchBundle(get, ['plan', 'dca'], {}, { storage, month, savedAt: 10 });
  assert.deepEqual(calls, ['bundle', 'dca']);
  assert.equal(loaded.parts.plan.data.tracks[0].track, 'main');
  assert.equal(loaded.parts.dca.data.items[0].dca_id, 'a');
  assert.equal(partNeedsFallback(loaded.envelope, 'dca'), true);
  assert.equal(partNeedsFallback(loaded.envelope, 'plan'), false);
  const stored = readCache(cacheKey('bundle', ['plan', 'dca'], month), storage);
  assert.equal(stored.body.parts.plan.tracks[0].track, 'main');

  let active = 0;
  let max = 0;
  const fallback = async (q) => {
    if (q === 'bundle') return { ok: false, error: new Error('unknown q') };
    active += 1;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return { ok: true, data: { ok: true, name: q } };
  };
  const again = await fetchBundle(fallback, ['plan', 'dca'], {}, { storage: memoryStorage(), month });
  assert.equal(max, 2);
  assert.equal(again.envelope, null);
  assert.equal(again.parts.plan.data.name, 'plan');
  assert.equal(again.parts.dca.data.name, 'dca');
});

test('overview uses one call and refetches only a failed part', async () => {
  const now = new Date('2026-10-14T04:00:00Z');
  const month = taipeiMonth(now);
  const calls = [];
  const storage = memoryStorage();
  const summary = {
    ok: true,
    accounts: [{ account_id: 'cash' }],
    report: { by_category: [{ category: '餐', total: -1 }] },
    quotes: [],
    warnings: [],
    net_worth: { net_worth_twd: 3 },
    holdings: [],
  };
  const get = async (q, params) => {
    calls.push([q, params]);
    if (q === 'overview') {
      assert.deepEqual(params, {});
      return {
        ok: true,
        data: {
          ok: true,
          errors: ['quotes'],
          parts: {
            summary,
            balances: { ok: true, balances: [], net_worth: { net_worth_twd: 3 } },
            quotes: { ok: false, error: 'late' },
            advice: { ok: true, advice: [] },
            holdings: { ok: true, holdings: [] },
            alerts: { ok: true, alerts: [] },
            plan: { ok: true, tracks: [] },
            decisions: { ok: true, count: 0, items: [] },
          },
        },
      };
    }
    assert.equal(q, 'quotes');
    return { ok: true, data: { ok: true, quotes: { '0050': { last: 180 } } } };
  };
  const view = await fetchOverview(month, get, { now, storage, token: 'not-in-body' });
  assert.deepEqual(calls.map(([q]) => q), ['overview', 'quotes']);
  assert.equal(view.accountsR.data.accounts[0].account_id, 'cash');
  assert.equal(view.quotesR.data.quotes['0050'].last, 180);
  assert.equal(view.incomeR.data.report.by_category[0].category, '餐');
  assert.ok(readCache(cacheKey('overview', [], month), storage));

  const older = [];
  await fetchOverview({ from: '2026-09-01', to: '2026-09-30' }, async (q, params) => {
    older.push([q, params]);
    return { ok: false, error: new Error('down') };
  }, { now, storage: memoryStorage() });
  assert.deepEqual(older[0], ['overview', { from: '2026-09-01', to: '2026-09-30' }]);
  assert.deepEqual(older.find(([q]) => q === 'summary')[1], { from: '2026-09-01', to: '2026-09-30' });
});

test('a missing overview falls back, including the old summary shape', async () => {
  const calls = [];
  const get = async (q) => {
    calls.push(q);
    if (q === 'overview') return { ok: false, error: new Error('unknown q') };
    if (q === 'summary') return { ok: false, error: new Error('unknown q') };
    if (q === 'accounts') return { ok: true, data: { accounts: [{ account_id: 'z' }] } };
    return { ok: true, data: { ok: true } };
  };
  const month = { from: '2026-10-01', to: '2026-10-31' };
  const view = await fetchOverview(month, get, {
    now: new Date('2026-10-14T04:00:00Z'),
    storage: memoryStorage(),
  });
  assert.equal(calls[0], 'overview');
  assert.ok(calls.includes('summary'));
  assert.ok(calls.includes('accounts'));
  assert.ok(calls.includes('income_expense'));
  assert.equal(view.accountsR.data.accounts[0].account_id, 'z');
  assert.equal(calls.filter((q) => q === 'plan').length, 1);
});

test('cached bundles stay under ten minutes, then show 估 updated HH:mm', () => {
  const saved = Date.parse('2026-10-14T02:30:00Z');
  assert.equal(staleView(saved, saved + STALE_MS).stale, false);
  const old = staleView(saved, saved + STALE_MS + 1);
  assert.equal(old.stale, true);
  assert.equal(old.label, '估 updated 10:30');
});

test('storage drops the oldest entry, skips the token, and clears after a write', () => {
  const storage = memoryStorage(3);
  const month = { from: '2026-10-01', to: '2026-10-31' };
  const first = cacheKey('bundle', ['plan'], month);
  const second = cacheKey('bundle', ['dca'], month);
  const third = cacheKey('overview', [], month);
  const token = 'ledger-token-value';
  storage.setItem('pfpro.token', token);
  assert.equal(writeCache(first, { ok: true, n: 1 }, storage, '', 1), true);
  assert.equal(writeCache(second, { ok: true, n: 2 }, storage, '', 2), true);
  assert.equal(writeCache(third, { ok: true, n: 3 }, storage, '', 3), true);
  assert.equal(readCache(first, storage), null);
  assert.equal(readCache(third, storage).body.n, 3);
  assert.equal(first.includes(token), false);
  assert.equal(writeCache(second, { ok: true, note: token }, storage, token, 4), false);
  assert.notEqual(readCache(second, storage).body.note, token);
  afterWrite({ ok: true }, storage);
  assert.equal(readCache(third, storage), null);
  assert.equal(storage.getItem('pfpro.token'), token);
  afterWrite({ ok: false }, storage);
  writeCache(first, { ok: true }, storage, '', 5);
  assert.ok(readCache(first, storage));
});
