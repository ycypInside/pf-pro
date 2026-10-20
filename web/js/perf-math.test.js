import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const context = {};
createContext(context);
runInContext(readFileSync(path.join(root, 'apps-script/PerfMath.js'), 'utf8'), context);

const {
  pfReplay, pfUnrealized, pfPeriodPnl, pfModifiedDietz, pfLinkedTwr, pfXirr, pfXirrSchedule,
  pfAllocation, pfNormalizeTarget, pfBucket, pfPortfolioFlows, pfAccountFlows, pfClassifyCashflow,
  pfCashflowScope, pfBuildCashflows, pfPeriodRange, pfBenchmarkReturn, pfIncome,
} = context;

function close(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not within ${eps} of ${expected}`);
}

function same(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

test('moving average, then price and FX effects that add up in TWD', () => {
  // Buy 10 at 100 USD, fx 30. Book: 1,000 USD and 30,000 TWD.
  // Mark at 110 with fx 32.
  // Price effect = (110-100) * 10 * 32 = 3,200 TWD.
  // FX effect = 100 * 10 * (32-30) = 2,000 TWD.
  // Market value 35,200 − cost 30,000 = 5,200.
  const book = pfReplay([{
    id: 'T1', date: '2026-01-02', account_id: 'A', asset_id: 'X', side: 'buy',
    quantity: 10, gross: 1000, fee: 0, tax: 0, fx: 30,
  }]).books['A|X'];
  assert.equal(book.qty, 10);
  assert.equal(book.cost, 1000);
  assert.equal(book.costTwd, 30000);
  const open = pfUnrealized(book, 110, 32);
  assert.equal(open.price_effect, 3200);
  assert.equal(open.fx_effect, 2000);
  assert.equal(open.total, 5200);
  assert.equal(open.market_value_twd, 35200);
  assert.equal(open.price_effect + open.fx_effect, open.total);
});

test('a partial sale relieves average cost and splits the realized result', () => {
  // After the buy above, sell 4 at 110, fx 32.
  // Proceeds 440 * 32 = 14,080. Cost relieved 400 USD = 12,000 TWD.
  // Price = (110-100) * 4 * 32 = 1,280. FX = 400 * 2 = 800. Total 2,080.
  // Six shares remain: cost 600 USD / 18,000 TWD, unrealized 3,120 = 1,920 + 1,200.
  const replay = pfReplay([
    { id: 'T1', date: '2026-01-02', account_id: 'A', asset_id: 'X', side: 'buy', quantity: 10, gross: 1000, fee: 0, tax: 0, fx: 30 },
    { id: 'T2', date: '2026-02-02', account_id: 'A', asset_id: 'X', side: 'sell', quantity: 4, gross: 440, fee: 0, tax: 0, fx: 32 },
  ]);
  const book = replay.books['A|X'];
  assert.equal(book.qty, 6);
  assert.equal(book.cost, 600);
  assert.equal(book.costTwd, 18000);
  assert.equal(book.realizedPrice, 1280);
  assert.equal(book.realizedFx, 800);
  assert.equal(book.realizedTotal, 2080);
  const left = pfUnrealized(book, 110, 32);
  assert.equal(left.price_effect, 1920);
  assert.equal(left.fx_effect, 1200);
  assert.equal(left.total, 3120);

  const trades = [
    { id: 'T1', date: '2026-01-02', account_id: 'A', asset_id: 'X', side: 'buy', quantity: 10, gross: 1000, fee: 0, tax: 0, fx: 30 },
    { id: 'T2', date: '2026-02-02', account_id: 'A', asset_id: 'X', side: 'sell', quantity: 4, gross: 440, fee: 0, tax: 0, fx: 32 },
  ];
  const period = pfPeriodPnl(trades, {
    'A|X': { startPrice: 100, startFx: 30, endPrice: 110, endFx: 32 },
  }, '2026-02-01', '2026-02-28');
  assert.equal(period.realized_total, 2080);
  assert.equal(period.realized_price, 1280);
  assert.equal(period.realized_fx, 800);
  assert.equal(period.unrealized_total, 3120);
  assert.equal(period.unrealized_price, 1920);
  assert.equal(period.unrealized_fx, 1200);
});

test('two buys use a single moving-average cost', () => {
  const book = pfReplay([
    { id: 'T1', date: '2026-01-02', account_id: 'A', asset_id: 'X', side: 'buy', quantity: 10, gross: 1000, fee: 0, tax: 0, fx: 30 },
    { id: 'T2', date: '2026-01-03', account_id: 'A', asset_id: 'X', side: 'buy', quantity: 10, gross: 1300, fee: 0, tax: 0, fx: 32 },
  ]).books['A|X'];
  assert.equal(book.qty, 20);
  assert.equal(book.cost, 2300);
  assert.equal(pfUnrealized(book, 115, 32).avg_cost, 115);
  assert.equal(book.costTwd, 71600);
});

test('Modified Dietz weights a mid-window flow by the days left', () => {
  // 1 Jan to 31 Jan is 30 days. 200 arrives on 11 Jan, so 20 days remain.
  // Weight = 20/30. Gain = 1,300 − 1,000 − 200 = 100.
  // Denominator = 1,000 + 200 * 20/30. Return = 100 / (3,400/3) = 3/34.
  const dietz = pfModifiedDietz(1000, 1300, [{ date: '2026-01-11', amount: 200 }], '2026-01-01', '2026-01-31');
  close(dietz.r, 3 / 34);
  close(dietz.denominator, 1000 + 200 * 20 / 30);
});

test('daily links chain with Dietz on the gap, and a withdrawal is not a loss', () => {
  // 1 Jan → 2 Jan: 1,000 to 1,100, no flow, +10%.
  // 2 Jan → 5 Jan (3 days): 200 arrives on 4 Jan, weight 1/3.
  // (1,400 − 1,100 − 200) / (1,100 + 200/3) = 3/35.
  // Linked = 1.10 * 38/35 − 1 = 34/175.
  const linked = pfLinkedTwr([
    { date: '2026-01-01', nav: 1000 },
    { date: '2026-01-02', nav: 1100 },
    { date: '2026-01-05', nav: 1400 },
  ], [{ date: '2026-01-04', amount: 200 }]);
  assert.equal(linked.series[1].link, 'daily');
  assert.equal(linked.series[2].link, 'dietz');
  close(linked.series[1].sub_return, 0.1);
  close(linked.series[2].sub_return, 3 / 35);
  close(linked.twr, 34 / 175);

  const flat = pfLinkedTwr([
    { date: '2026-01-01', nav: 1000 },
    { date: '2026-01-02', nav: 900 },
  ], [{ date: '2026-01-02', amount: -100 }]);
  close(flat.twr, 0);
});

test('max drawdown is the worst peak-to-trough on the growth index', () => {
  // 100, 120, 90, 110. Peak index 1.2, trough 0.9, drawdown −25%.
  const linked = pfLinkedTwr([
    { date: '2026-01-01', nav: 100 },
    { date: '2026-01-02', nav: 120 },
    { date: '2026-01-03', nav: 90 },
    { date: '2026-01-04', nav: 110 },
  ], []);
  close(linked.max_drawdown.value, -0.25);
  assert.equal(linked.max_drawdown.peak_date, '2026-01-02');
  assert.equal(linked.max_drawdown.trough_date, '2026-01-03');
  close(linked.series[3].index, 1.1);
});

test('XIRR is 10% over a 365-day year and matches the published irregular example', () => {
  const simple = pfXirr(pfXirrSchedule([], 1000, '2023-01-01', 1100, '2024-01-01'));
  close(simple, 0.1, 1e-9);

  // Excel's documented sample. Outflows negative, inflows positive.
  const sample = pfXirr([
    { date: '2008-01-01', amount: -10000 },
    { date: '2008-03-01', amount: 2750 },
    { date: '2008-10-30', amount: 4250 },
    { date: '2009-02-15', amount: 3250 },
    { date: '2009-04-01', amount: 2750 },
  ]);
  close(sample, 0.373362535, 1e-6);
});

test('external principal is kept out of income, and internal transfers stay inside the portfolio', () => {
  const txns = [
    { date: '2026-01-05', account_id: 'BRK', amount: 1000, amount_twd: 1000, flow_class: 'external', txn_type: 'transfer_in', status: 'active' },
    { date: '2026-01-06', account_id: 'BRK', amount: -200, amount_twd: -200, flow_class: 'external', txn_type: 'transfer_out', status: 'active' },
    { date: '2026-01-07', account_id: 'BRK', amount: 50, amount_twd: 50, flow_class: 'investment_income', txn_type: 'dividend', status: 'active' },
    { date: '2026-01-08', account_id: 'BRK', amount: -10, amount_twd: -10, flow_class: 'investment_cost', txn_type: 'fee', status: 'active' },
    { date: '2026-01-09', account_id: 'BRK', amount: -300, amount_twd: -300, flow_class: 'internal', txn_type: 'transfer_out', status: 'active' },
    { date: '2026-01-09', account_id: 'BRK2', amount: 300, amount_twd: 300, flow_class: 'internal', txn_type: 'transfer_in', status: 'active' },
    { date: '2026-01-04', account_id: 'BRK', amount: -1186.5, amount_twd: -38146, flow_class: 'internal', txn_type: 'adjustment', trade_id: 'TR1', status: 'active' },
  ];
  const external = pfPortfolioFlows(txns, ['BRK', 'BRK2'], '2026-01-01', '2026-01-31');
  same(external.map((row) => row.amount), [1000, -200]);
  const account = pfAccountFlows(txns, 'BRK', '2026-01-01', '2026-01-31');
  same(account.map((row) => row.amount), [1000, -200, -300]);
  const income = pfIncome(txns, '2026-01-01', '2026-01-31', ['BRK']);
  assert.equal(income.dividends, 50);
  assert.equal(income.fees, 10);
  assert.equal(pfClassifyCashflow(txns[0], true), 'external_contribution');
  assert.equal(pfClassifyCashflow(txns[1], true), 'external_withdrawal');
  assert.equal(pfClassifyCashflow(txns[2], true), 'income_dividend');
  assert.equal(pfClassifyCashflow(txns[4], true), 'internal_transfer');
  assert.equal(pfClassifyCashflow(txns[6], true), '');
  assert.equal(pfClassifyCashflow({ txn_type: 'expense', flow_class: 'external', amount: -80, status: 'active' }, false), '');
});

test('cashflow rebuild scopes stay inside portfolio or account', () => {
  const allowed = new Set(['portfolio', 'account']);
  assert.equal(pfCashflowScope('', true), '');
  assert.equal(pfCashflowScope('internal_transfer', true), 'account');
  assert.equal(pfCashflowScope('internal_transfer', false), 'account');
  assert.equal(pfCashflowScope('external_contribution', true), 'portfolio');
  assert.equal(pfCashflowScope('external_withdrawal', true), 'portfolio');
  assert.equal(pfCashflowScope('income_interest', false), 'account');
  assert.equal(pfCashflowScope('fee', true), 'portfolio');

  const investment = (txn) => txn.account_id !== 'CASH';
  const rows = pfBuildCashflows([
    { txn_id: 'TX-20261020-out', date: '2026-10-20', account_id: 'BRK', amount: -50000, amount_twd: -50000, currency: 'TWD', fx_rate: 1, flow_class: 'internal', txn_type: 'transfer_out', status: 'active', transfer_group_id: 'TG-20261020-77a3a5' },
    { txn_id: 'TX-20261020-in', date: '2026-10-20', account_id: 'BRK2', amount: 50000, amount_twd: 50000, currency: 'TWD', fx_rate: 1, flow_class: 'internal', txn_type: 'transfer_in', status: 'active', transfer_group_id: 'TG-20261020-77a3a5' },
    { txn_id: 'TX-fee', date: '2026-10-20', account_id: 'BRK', amount: -15, amount_twd: -15, currency: 'TWD', fx_rate: 1, flow_class: 'investment_cost', txn_type: 'fee', status: 'active' },
    { txn_id: 'TX-ext', date: '2026-10-01', account_id: 'BRK', amount: 1000, amount_twd: 1000, currency: 'TWD', fx_rate: 1, flow_class: 'external', txn_type: 'transfer_in', status: 'active' },
    { txn_id: 'TX-bank', date: '2026-10-02', account_id: 'CASH', amount: 20, amount_twd: 20, currency: 'TWD', fx_rate: 1, flow_class: 'external', txn_type: 'interest', status: 'active' },
    { txn_id: 'TX-move', date: '2026-10-03', account_id: 'CASH', amount: -100, amount_twd: -100, currency: 'TWD', fx_rate: 1, flow_class: 'internal', txn_type: 'transfer_out', status: 'active' },
    { txn_id: 'TX-void', date: '2026-10-04', account_id: 'BRK', amount: 10, amount_twd: 10, currency: 'TWD', fx_rate: 1, flow_class: 'external', txn_type: 'transfer_in', status: 'void' },
    { txn_id: 'TX-trade', date: '2026-10-05', account_id: 'BRK', amount: -100, amount_twd: -100, currency: 'TWD', fx_rate: 1, flow_class: 'internal', txn_type: 'adjustment', trade_id: 'TR1', status: 'active' },
    null,
    {},
  ], investment);

  same(rows.map((row) => [row.source_txn_id, row.scope, row.cf_class, row.direction]), [
    ['TX-20261020-out', 'account', 'internal_transfer', 'out'],
    ['TX-20261020-in', 'account', 'internal_transfer', 'in'],
    ['TX-fee', 'portfolio', 'fee', 'out'],
    ['TX-ext', 'portfolio', 'external_contribution', 'in'],
    ['TX-bank', 'account', 'income_interest', 'in'],
  ]);
  assert.equal(rows[0].cf_id, 'CF-20261020-out');
  for (const row of rows) assert.equal(allowed.has(row.scope), true);
  assert.equal(rows.some((row) => row.scope === 'investment' || row.scope === 'household'), false);
});

test('allocation flags a drift outside the band and maps funds onto stock', () => {
  assert.equal(pfBucket('etf', { stock: 0.6 }), 'stock');
  assert.equal(pfBucket('fund', { stock: 0.6, bond: 0.2, cash: 0.2 }), 'stock');
  assert.equal(pfBucket('fund', { fund: 0.1 }), 'fund');
  const result = pfAllocation(
    { stock: 700, bond: 200, cash: 100 },
    pfNormalizeTarget({ stock: 60, bond: 20, cash: 20 }),
    5,
  );
  assert.equal(result.total_twd, 1000);
  const stock = result.rows.find((row) => row.bucket === 'stock');
  const bond = result.rows.find((row) => row.bucket === 'bond');
  const cash = result.rows.find((row) => row.bucket === 'cash');
  assert.equal(stock.alert, true);
  assert.equal(stock.trade_twd, -100);
  assert.equal(bond.alert, false);
  assert.equal(bond.trade_twd, 0);
  assert.equal(cash.alert, true);
  assert.equal(cash.trade_twd, 100);
  close(stock.actual_weight, 0.7);
});

test('period bounds and a TWD-adjusted benchmark', () => {
  same(pfPeriodRange('MTD', '2026-10-13'), { from: '2026-10-01', to: '2026-10-13', period: 'MTD' });
  same(pfPeriodRange('YTD', '2026-10-13'), { from: '2026-01-01', to: '2026-10-13', period: 'YTD' });
  same(pfPeriodRange('1Y', '2026-10-13'), { from: '2025-10-13', to: '2026-10-13', period: '1Y' });
  assert.equal(pfPeriodRange('ALL', '2026-10-13').from, null);

  const levels = [{ date: '2026-01-02', value: 100 }, { date: '2026-02-02', value: 110 }];
  const fx = [{ date: '2026-01-02', value: 30 }, { date: '2026-02-02', value: 32 }];
  const result = pfBenchmarkReturn(levels, '2026-01-01', '2026-02-28', fx);
  close(result.local, 0.1);
  // (110 * 32) / (100 * 30) − 1 = 0.173333...
  close(result.twd, 110 * 32 / (100 * 30) - 1);
  const localOnly = pfBenchmarkReturn(levels, '2026-01-01', '2026-02-28', null);
  close(localOnly.twd, 0.1);
});
