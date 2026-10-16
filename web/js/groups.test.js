import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGroups,
  defaultGroupState,
  displayAmount,
  groupHoldings,
  isGroupOpen,
  isVisibleAccount,
  joinHoldings,
  adviceTone,
  policyLines,
  readGroupState,
  sortHoldings,
  toggleOpen,
  visibleAdvice,
  withMode,
  writeGroupState,
} from './groups.js';

function memory() {
  const bag = new Map();
  return {
    getItem(key) { return bag.has(key) ? bag.get(key) : null; },
    setItem(key, value) { bag.set(key, String(value)); },
  };
}

const rows = [
  { account_id: 'g', name: '玉山集團', is_group: true, total_twd: 0, rollup_twd: 250, status: 'active' },
  { account_id: 'a', name: '活存', institution: '玉山', type: 'bank_cash', total_twd: 100, balance_twd: 100, holdings_twd: 0, status: 'active' },
  { account_id: 'b', name: '證券', institution: '玉山', type: 'brokerage', total_twd: 200, balance_twd: 20, holdings_twd: 180, status: 'active', is_investment: true },
  { account_id: 'c', name: '信貸', institution: '玉山', type: 'loan', total_twd: -50, balance_twd: -50, holdings_twd: 0, status: 'active' },
];

test('group accounts hide a parent that would otherwise show zero', () => {
  assert.equal(isVisibleAccount(rows[0]), false);
  assert.equal(displayAmount(rows[0]), 250);
  assert.equal(displayAmount(rows[1]), 100);
  const institutions = [{
    institution: '玉山',
    cash: 120,
    holdings: 180,
    liabilities: 50,
    total: 250,
    accounts: ['g', 'a', 'b', 'c'],
  }];
  const groups = buildGroups('bank', rows, institutions);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].accounts.map((row) => row.account_id), ['a', 'b', 'c']);
  assert.equal(groups[0].total, 250);
  assert.equal(groups[0].cash, 120);
  assert.equal(groups[0].holdings, 180);
  assert.equal(groups[0].liabilities, 50);
  const byType = buildGroups('type', rows, institutions);
  assert.deepEqual(byType.map((group) => group.id), ['type:cash', 'type:investments', 'type:loans']);
  assert.deepEqual(byType[0].accounts.map((row) => row.account_id), ['a']);
  assert.deepEqual(byType[1].accounts.map((row) => row.account_id), ['b']);
  assert.deepEqual(byType[2].accounts.map((row) => row.account_id), ['c']);
});

test('account groups stay collapsed until this browser opens them', () => {
  const storage = memory();
  const fresh = readGroupState(storage);
  assert.deepEqual(fresh, defaultGroupState());
  assert.equal(isGroupOpen(fresh, 'bank:玉山'), false);
  writeGroupState(storage, toggleOpen(fresh, 'bank:玉山'));
  assert.equal(isGroupOpen(readGroupState(storage), 'bank:玉山'), true);
  const typed = withMode(readGroupState(storage), 'type');
  writeGroupState(storage, typed);
  const again = readGroupState(storage);
  assert.equal(again.mode, 'type');
  assert.equal(again.open['bank:玉山'], true);
  writeGroupState(storage, toggleOpen(again, 'bank:玉山'));
  assert.equal(isGroupOpen(readGroupState(storage), 'bank:玉山'), false);
  storage.setItem('pfpro.accountGroups', '{');
  assert.deepEqual(readGroupState(storage), defaultGroupState());
});

test('holdings join quotes, sort, and group without an employer flag', () => {
  const joined = joinHoldings([
    {
      asset_id: '4938', symbol: '4938', name: '和碩', account_id: 'b', asset_class: 'stock',
      market_value_twd: 100, cost_basis_twd: 80, unrealized_pl_twd: 20, last_price: 90, currency: 'TWD',
    },
    {
      asset_id: '0050', symbol: '0050', name: '台灣50', account_id: 'a', asset_class: 'etf',
      market_value_twd: 300, cost_basis_twd: 250, unrealized_pl_twd: 50, currency: 'TWD',
    },
  ], {
    4938: { last: 101, change_pct: 0.01, spark: [1, 2, 3], source: 'yahoo' },
    '0050': { last: 180, change_pct: -0.02, spark: [3, 2], source: 'stored' },
  });
  const pegatron = joined.find((row) => row.symbol === '4938');
  assert.equal(pegatron.price, 101);
  assert.equal(pegatron.change_pct, 0.01);
  assert.equal(pegatron.weight, 0.25);
  assert.equal(pegatron.pl_pct, 0.25);
  assert.equal(pegatron.spark.length, 3);
  assert.equal('employer' in pegatron, false);
  assert.equal(sortHoldings(joined, 'value')[0].symbol, '0050');
  assert.equal(sortHoldings(joined, 'change')[0].symbol, '4938');
  const byClass = groupHoldings(sortHoldings(joined, 'name'), 'class', {});
  assert.equal(byClass.find((group) => group.id === 'stock').label, '股票');
  assert.equal(byClass.find((group) => group.id === 'stock').rows[0].symbol, '4938');
  const byAccount = groupHoldings(joined, 'account', { a: '活存', b: '證券' });
  assert.equal(byAccount.find((group) => group.id === 'b').label, '證券');
});

test('advice and policy omit the removed employer limit', () => {
  const items = visibleAdvice([
    { tag: 'employer', title: '雇主持股集中', level: 'warn' },
    { tag: 'cash', title: '現金緩衝', level: 'info' },
  ]);
  assert.deepEqual(items.map((item) => item.tag), ['cash']);
  const lines = policyLines({
    equity_max: 0.9,
    equity_min: 0.8,
    cash_min: 0.05,
    employer_max: 0.05,
    other: 'hold',
    sentiment_mode: 'defensive_when_hot',
    single_name_max: 0.1,
  });
  assert.equal(lines.some((line) => line.key === 'employer_max'), false);
  assert.equal(lines.find((line) => line.key === 'equity_max').text, '90%');
  assert.equal(lines.find((line) => line.key === 'single_name_max').text, '10%');
  assert.equal(lines.find((line) => line.key === 'other').text, '維持現況');
  assert.equal(lines.find((line) => line.key === 'sentiment_mode').text, '過熱時降低股票');
  assert.equal(lines.find((line) => line.key === 'dca_exempt_enabled').text, '關閉');
  assert.equal(lines.find((line) => line.key === 'dca_core_assets').text, '尚未指定');
  assert.equal(lines.find((line) => line.key === 'dca_pause').text, '關閉');
  assert.equal(lines.find((line) => line.key === 'stale_days_overrides').text, '尚未設定');
  assert.equal(adviceTone({ tag: 'stale', level: 'info' }), 'warn');
  assert.equal(adviceTone({ tag: 'dca_pause', level: 'info' }), 'warn');
  assert.equal(adviceTone({ tag: 'cash', level: 'info' }), 'info');
});

test('stale quotes keep the price date and limit', () => {
  const [fresh, stale] = joinHoldings([
    { asset_id: 'a', symbol: '0050', name: '元大台灣50', account_id: 'x', market_value_twd: 10, cost_basis_twd: 8, unrealized_pl_twd: 2 },
    { asset_id: 'b', symbol: 'SI-145', name: '基金', account_id: 'x', market_value_twd: 10, cost_basis_twd: 8, unrealized_pl_twd: 2 },
  ], {
    a: { last: 10, is_stale: false, change_pct: 0 },
    b: { last: 9, is_stale: true, price_date: '2026-08-01', price_basis: 'nav', estimate: true, stale_limit_days: 14, change_pct: -0.01 },
  });
  assert.equal(fresh.is_stale, false);
  assert.equal(fresh.price_basis, '');
  assert.equal(fresh.estimate, false);
  assert.equal(stale.is_stale, true);
  assert.equal(stale.price_date, '2026-08-01');
  assert.equal(stale.price_basis, 'nav');
  assert.equal(stale.estimate, true);
  assert.equal(stale.stale_limit_days, 14);
  const lines = policyLines({
    sentiment_mode: 'off',
    dca_exempt_enabled: true,
    dca_core_assets: ['0050', 'VOO'],
    dca_pause: { enabled: true, cash_pct_total: 0.08, net_cash_pct_nw: 0.02 },
  }, { stale_days_overrides: '{"SI-145":14,"nav:USD":21}' });
  assert.equal(lines.find((line) => line.key === 'sentiment_mode').text, '不隨情緒調整');
  assert.equal(lines.find((line) => line.key === 'dca_exempt_enabled').text, '開啟');
  assert.equal(lines.find((line) => line.key === 'dca_core_assets').text, '0050、VOO');
  assert.equal(lines.find((line) => line.key === 'dca_pause').text, '開啟，現金低於總資產 8% 或淨現金低於淨值 2% 時暫停');
  assert.equal(lines.find((line) => line.key === 'stale_days_overrides').text, 'SI-145：14 天、nav:USD：21 天');
});
