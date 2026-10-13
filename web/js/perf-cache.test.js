import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const context = {};
createContext(context);
runInContext(readFileSync(path.join(root, 'apps-script/PerfMath.js'), 'utf8'), context);
runInContext(readFileSync(path.join(root, 'apps-script/PerfCache.js'), 'utf8'), context);

const {
  pfAddDays_, pfMonthKey_, pfPriceIndex, pfFxAt_, pfMarkAt_, pfDayPoint_, pfDateSpan_,
  pfFactsStamp_, pfFactLine_, pfPlanPerf_, pfCoversYear_, pfBenchmarkStep_, pfNextBenchmark_,
} = context;

const symbols = ['0050.TW', '^TWII', 'SPY'];

test('a quote on the same day keeps the later fetch', () => {
  const index = pfPriceIndex([
    { symbol: 'USDTWD', kind: 'fx', date: '2026-10-01', value: 32 },
    { symbol: 'USDTWD', kind: 'fx', date: '2026-10-10', value: 33 },
    { symbol: 'SPY', kind: 'price', date: '2026-10-01', value: 100, currency: 'USD', fetched_at: '2026-10-01T01:00:00+08:00' },
    { symbol: 'SPY', kind: 'price', date: '2026-10-01', value: 101, currency: 'USD', fetched_at: '2026-10-02T01:00:00+08:00' },
    { symbol: 'SPY', kind: 'price', date: '2026-10-09', value: 110, currency: 'USD', fetched_at: '2026-10-09T01:00:00+08:00' },
  ]);
  assert.equal(pfFxAt_(index, 'USD', '2026-10-05'), 32);
  assert.equal(pfFxAt_(index, 'USD', '2026-10-10'), 33);
  assert.equal(pfFxAt_(index, 'TWD', '2026-10-10'), 1);
  const mark = pfMarkAt_({ asset_id: 'SPY', symbol: 'SPY', currency: 'USD', asset_class: 'etf' }, '2026-10-05', index);
  assert.equal(mark.price, 101);
  assert.equal(mark.fx, 32);
  assert.equal(mark.date, '2026-10-01');
});

test('a daily point uses the snapshot nav and still prices the holding', () => {
  const index = pfPriceIndex([
    { symbol: 'USDTWD', kind: 'fx', date: '2026-01-01', value: 30 },
    { symbol: 'SPY', kind: 'price', date: '2026-01-01', value: 10, currency: 'USD' },
  ]);
  const accounts = [{
    account_id: 'broker', name: 'Broker', type: 'brokerage', currency: 'USD',
    opening_balance: 0, opening_date: '2026-01-01', is_investment: true, status: 'active',
  }];
  const books = {
    'broker|SPY': { account_id: 'broker', asset_id: 'SPY', qty: 2, cost: 16, costTwd: 480 },
  };
  const assets = { SPY: { asset_id: 'SPY', symbol: 'SPY', currency: 'USD', asset_class: 'etf' } };
  const point = pfDayPoint_('2026-01-02', books, { broker: 5 }, accounts, assets, index, 999);
  assert.equal(point.source, 'snapshot');
  assert.equal(point.nav, 999);
  assert.equal(point.holdings['broker|SPY'], 600);
  assert.equal(point.accounts.broker, 750);
  const computed = pfDayPoint_('2026-01-02', books, { broker: 5 }, accounts, assets, index, null);
  assert.equal(computed.source, 'computed');
  assert.equal(computed.nav, 750);
});

test('performance cache continues a partial rebuild and appends new days', () => {
  const facts = {
    stamp: 'new',
    origin: '2026-01-01',
    accountDigest: 'digest',
    changes: [{ date: '2026-08-02', touched: '2026-10-12T00:00:00+08:00' }],
  };
  assert.equal(pfPlanPerf_(null, facts, '2026-10-13').action, 'rebuild');
  assert.equal(pfPlanPerf_(null, facts, '2026-10-13').from, '2026-01-01');
  const pending = pfPlanPerf_({
    pending_stamp: 'new', through: '2026-08-10', stamp: '', built_at: '', account_digest: 'digest',
  }, facts, '2026-10-13');
  assert.equal(pending.action, 'continue');
  assert.equal(pending.from, '2026-08-11');
  const changed = pfPlanPerf_({
    stamp: 'old', through: '2026-10-13', built_at: '2026-10-01T00:00:00+08:00', account_digest: 'digest',
  }, facts, '2026-10-13');
  assert.equal(changed.action, 'rebuild');
  assert.equal(changed.from, '2026-08-02');
  const fresh = pfPlanPerf_({
    stamp: 'new', through: '2026-10-13', built_at: '2026-10-13T00:00:00+08:00', account_digest: 'digest',
  }, facts, '2026-10-13');
  assert.equal(fresh.action, 'fresh');
  const append = pfPlanPerf_({
    stamp: 'new', through: '2026-10-12', built_at: '2026-10-12T00:00:00+08:00', account_digest: 'digest',
  }, facts, '2026-10-13');
  assert.equal(append.action, 'append');
  assert.equal(append.from, '2026-10-13');
  assert.equal(pfFactsStamp_([pfFactLine_('T', ['a', 1]), pfFactLine_('T', ['b', 2])]), pfFactsStamp_([
    pfFactLine_('T', ['b', 2]), pfFactLine_('T', ['a', 1]),
  ]));
  assert.equal(pfDateSpan_('2026-10-11', '2026-10-13').join(','), '2026-10-11,2026-10-12,2026-10-13');
});

test('benchmark backfill walks a year of TWSE months before the next symbol', () => {
  assert.equal(pfMonthKey_('2026-10-13', 0), '202610');
  assert.equal(pfMonthKey_('2026-10-13', 12), '202510');
  assert.equal(pfCoversYear_([{ date: '2025-10-01' }], '2026-10-13'), true);
  assert.equal(pfCoversYear_([{ date: '2026-06-01' }], '2026-10-13'), false);
  assert.equal(pfAddDays_('2026-10-13', -365) >= '2025-10-13', true);

  let cursor = { i: 0, op: 'yahoo', month: 12 };
  const months = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const step = pfBenchmarkStep_(symbols, cursor, '2026-10-13');
    if (step.symbol !== '0050.TW') break;
    if (step.op === 'twse') months.push(step.monthKey);
    cursor = pfNextBenchmark_(step, false);
  }
  assert.equal(months[0], '202510');
  assert.equal(months[months.length - 1], '202610');
  assert.equal(months.length, 13);
  assert.equal(pfAddDays_(`${months[0].slice(0, 4)}-${months[0].slice(4)}-01`, 0) <= pfAddDays_('2026-10-13', -365), true);

  const covered = pfBenchmarkStep_(symbols, { i: 0, op: 'yahoo', month: 12 }, '2026-10-13');
  const skip = pfNextBenchmark_(covered, true);
  assert.equal(skip.i, 1);
  assert.equal(skip.op, 'yahoo');
  const twii = pfBenchmarkStep_(symbols, skip, '2026-10-13');
  assert.equal(twii.symbol, '^TWII');
  assert.equal(twii.twseKind, 'index');
  const spy = pfBenchmarkStep_(symbols, { i: 2, op: 'yahoo', month: 12 }, '2026-10-13');
  assert.equal(spy.symbol, 'SPY');
  assert.equal(spy.hasTwse, false);
  const done = pfNextBenchmark_(spy, true);
  assert.equal(done.done, true);
  assert.equal(done.op, 'done');
  const maintain = pfBenchmarkStep_(symbols, done, '2026-10-13');
  assert.equal(maintain.maintenance, true);
  assert.equal(maintain.done, true);
});
