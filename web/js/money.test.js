import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCashTxn,
  buildPrice,
  buildTrade,
  buildTransfer,
  daysBetween,
  explainError,
  benchmarkChunkOpen,
  shouldRetryGet,
  shouldRetryPost,
  withQueryToken,
  isStale,
  netWorth,
  nextRequest,
  problemsForCash,
  problemsForPrice,
  problemsForTrade,
  problemsForTransfer,
  round2,
  splitCategories,
  stableString,
  taipeiMonth,
  tradeEconomics,
  withTwd,
} from './money.js';

test('spec buy example matches moving-average cash leg', () => {
  const econ = tradeEconomics({
    side: 'buy',
    quantity: 10,
    price: 118.5,
    fee: 1.5,
    tax: 0,
    fxRate: 32.15,
  });
  assert.equal(econ.gross, 1185);
  assert.equal(econ.net, -1186.5);
  assert.equal(econ.netTwd, -38145.98);
});

test('sell net is gross minus fee and tax', () => {
  const econ = tradeEconomics({ side: 'sell', quantity: 2, price: 50, fee: 1, tax: 0.5, fxRate: 1 });
  assert.equal(econ.gross, 100);
  assert.equal(econ.net, 98.5);
  assert.equal(econ.netTwd, 98.5);
});

test('split only moves fees', () => {
  const econ = tradeEconomics({ side: 'split', quantity: 10, price: 0, fee: 0, tax: 0, fxRate: 1 });
  assert.equal(econ.net, 0);
});

test('expense is an outflow and TWD fx is 1', () => {
  const txn = buildCashTxn({
    date: '2026-10-13',
    accountId: 'ACC-CASH',
    txnType: 'expense',
    category: '餐飲',
    amountAbs: 150,
    currency: 'TWD',
    fxRate: 32,
    fxSource: 'actual',
    flowClass: 'external',
  });
  assert.equal(txn.amount, -150);
  assert.equal(txn.fx_rate, 1);
  assert.deepEqual(problemsForCash(txn), []);
});

test('same-currency transfer sums to zero and opposite signs', () => {
  const data = buildTransfer({
    date: '2026-10-13',
    fromAccount: 'A',
    toAccount: 'B',
    fromAmount: 1000,
    toAmount: 1000,
    fromCurrency: 'TWD',
    toCurrency: 'TWD',
    fromFx: 1,
    toFx: 1,
    fxSourceFrom: 'actual',
    fxSourceTo: 'actual',
    flowClass: 'internal',
  });
  assert.equal(round2(data.from.amount + data.to.amount), 0);
  assert.ok(data.from.amount < 0 && data.to.amount > 0);
  assert.deepEqual(problemsForTransfer(data), []);
});

test('fx transfer keeps both legs and reports no same-currency sum rule', () => {
  const data = buildTransfer({
    date: '2026-10-12',
    fromAccount: 'TWD',
    toAccount: 'USD',
    fromAmount: 32150,
    toAmount: 1000,
    fromCurrency: 'TWD',
    toCurrency: 'USD',
    fromFx: 1,
    toFx: 32.15,
    fxSourceFrom: 'actual',
    fxSourceTo: 'actual',
    flowClass: 'internal',
  });
  assert.equal(data.from.amount, -32150);
  assert.equal(data.to.amount, 1000);
  assert.equal(round2(data.from.amount * data.from.fx_rate + data.to.amount * data.to.fx_rate), 0);
});

test('transfer into an investment account rejects a blank-like flow', () => {
  const data = buildTransfer({
    date: '2026-10-13',
    fromAccount: 'BANK',
    toAccount: 'BROKER',
    fromAmount: 10,
    toAmount: 10,
    fromCurrency: 'TWD',
    toCurrency: 'TWD',
    fromFx: 1,
    toFx: 1,
    fxSourceFrom: 'actual',
    fxSourceTo: 'actual',
    flowClass: 'investment_income',
  });
  const problems = problemsForTransfer(data, { BROKER: { is_investment: true } });
  assert.ok(problems.some((item) => item.includes('投資帳戶')));
});

test('price payload is append-only shaped', () => {
  const data = buildPrice({ symbol: ' USDTWD ', kind: 'fx', date: '2026-10-13', value: '32.15', currency: 'TWD' });
  assert.equal(data.symbol, 'USDTWD');
  assert.equal(data.source, 'manual');
  assert.equal(data.value, 32.15);
  assert.deepEqual(problemsForPrice(data), []);
});

test('trade payload forces TWD fx to 1', () => {
  const data = buildTrade({
    tradeDate: '2026-10-13',
    accountId: 'ACC',
    assetId: 'AST-0050',
    side: 'buy',
    quantity: '2',
    price: '100',
    currency: 'TWD',
    fxRate: 30,
    fxSource: 'actual',
  });
  assert.equal(data.fx_rate, 1);
  assert.equal(data.quantity, 2);
  assert.deepEqual(problemsForTrade(data, { currency: 'TWD' }, { currency: 'TWD' }), []);
});

test('retry reuses request id until the payload changes', () => {
  const ids = ['one', 'two'];
  const first = nextRequest(null, { action: 'add_transaction', data: { amount: -1 } }, () => ids.shift());
  const retry = nextRequest(first, { data: { amount: -1 }, action: 'add_transaction' }, () => ids.shift());
  assert.equal(retry.reused, true);
  assert.equal(retry.id, 'one');
  assert.equal(retry.payload, first.payload);
  const edited = nextRequest(retry, { action: 'add_transaction', data: { amount: -2 } }, () => ids.shift());
  assert.equal(edited.reused, false);
  assert.equal(edited.id, 'two');
});

test('taipei month uses the local calendar, not UTC date', () => {
  const month = taipeiMonth(new Date('2026-10-12T16:30:00Z'));
  assert.equal(month.iso, '2026-10-13');
  assert.equal(month.from, '2026-10-01');
  assert.equal(month.to, '2026-10-31');
  assert.equal(month.label, '2026年10月');
  assert.equal(daysBetween('2026-10-09', '2026-10-13'), 4);
  assert.equal(isStale('price', '2026-10-09', '2026-10-13', { price: 3, fund: 7, bond: 45 }), true);
  assert.equal(isStale('price', '2026-10-10', '2026-10-13', { price: 3, fund: 7, bond: 45 }), false);
  assert.equal(isStale('bond_valuation', '2026-09-01', '2026-10-13', { price: 3, fund: 7, bond: 45 }), false);
});

test('net worth adds holdings and treats loans as liabilities', () => {
  const balances = withTwd([
    { account_id: 'CASH', currency: 'TWD', balance: 1000, type: 'bank_cash', status: 'active' },
    { account_id: 'USD', currency: 'USD', balance: 10, type: 'brokerage', is_investment: true, status: 'active' },
    { account_id: 'CARD', currency: 'TWD', balance: -200, type: 'credit_card', status: 'active' },
    { account_id: 'JPY', currency: 'JPY', balance: 100, type: 'bank_fx', status: 'active' },
  ], [{ symbol: 'USDTWD', kind: 'fx', date: '2026-10-13', value: 32, is_stale: false }]);
  const summary = netWorth({
    balances,
    holdings: [{ market_value_twd: 500 }, { market_value_twd: '' }],
  });
  assert.equal(summary.cash_twd, 1000);
  assert.equal(summary.holdings_twd, 500);
  assert.equal(summary.investments_twd, 820);
  assert.equal(summary.total_liabilities_twd, 200);
  assert.equal(summary.net_worth_twd, 1620);
  assert.deepEqual(summary.missing_fx, ['JPY']);
});

test('categories keep the sign the report stores', () => {
  const split = splitCategories({ 餐飲: -300, 薪資: 1000, 空: 0 });
  assert.deepEqual(split.expense, [{ name: '餐飲', amount: 300 }]);
  assert.deepEqual(split.income, [{ name: '薪資', amount: 1000 }]);
});

test('errors stay in Traditional Chinese without leaking a token', () => {
  assert.match(explainError('unauthorized'), /權杖/);
  assert.match(explainError('auth_unavailable'), /不是密碼錯誤/);
  assert.match(explainError('not_found'), /連不上/);
  assert.match(explainError('busy'), /寫入/);
  assert.match(explainError('unknown action'), /部署/);
  assert.match(explainError('offline'), /沒有網路/);
  assert.match(explainError('連線失敗'), /重試/);
  const transient = Object.assign(new Error('not_found'), { transient: true });
  const offline = Object.assign(new Error('offline'), { offline: true, transient: true });
  const denied = Object.assign(new Error('unauthorized'), { transient: false });
  assert.equal(shouldRetryGet(transient, 0, 3), true);
  assert.equal(shouldRetryGet(transient, 2, 3), false);
  assert.equal(shouldRetryGet(offline, 0, 3), false);
  assert.equal(shouldRetryGet(denied, 0, 3), false);
  assert.equal(stableString({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(shouldRetryPost({ ok: false, error: 'unauthorized', reason: 'missing_token' }, 0), true);
  assert.equal(shouldRetryPost({ ok: false, error: 'bad json', reason: 'parse_error' }, 0), true);
  assert.equal(shouldRetryPost({ ok: false, error: 'unauthorized', reason: 'missing_token' }, 1), false);
  assert.equal(shouldRetryPost({ ok: false, error: 'unauthorized', reason: 'mismatch' }, 0), false);
  assert.equal(shouldRetryPost({ ok: false, error: 'unauthorized' }, 0), true);
  assert.equal(shouldRetryPost({ ok: false, error: 'unknown q' }, 0), true);
  assert.equal(shouldRetryPost({ ok: false, error: 'busy' }, 0), false);
  assert.equal(benchmarkChunkOpen({ ok: true, done: false, result: { done: true } }), true);
  assert.equal(benchmarkChunkOpen({ ok: true, done: true, result: { done: false } }), true);
  assert.equal(benchmarkChunkOpen({ ok: true, result: { done: true } }), false);
  assert.equal(benchmarkChunkOpen({ ok: true, done: true, result: {} }), false);
  const base = 'https://example.com/macros/s/DEPLOY/exec';
  const plain = withQueryToken(base, 'secret-token');
  assert.equal(new URL(plain).searchParams.get('token'), 'secret-token');
  const spaced = withQueryToken(`${base}?q=ignored`, 'a b/c');
  assert.equal(new URL(spaced).searchParams.get('token'), 'a b/c');
  assert.ok(spaced.includes('token='));
  assert.match(explainError('unauthorized', 'missing_token'), /沒有帶到權杖/);
  assert.match(explainError('unauthorized', 'mismatch'), /不一致/);
  assert.match(explainError('bad json', 'parse_error'), /轉址/);
});
