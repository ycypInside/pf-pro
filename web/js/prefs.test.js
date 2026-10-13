import assert from 'node:assert/strict';
import test from 'node:test';
import {
  entryQuery,
  mergeEntryPreset,
  parseLastCash,
  rememberTemplate,
  serializeLastCash,
  usableLastCash,
} from './prefs.js';

function memory() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

test('last account and category round-trip, and a closed account is ignored', () => {
  const storage = memory();
  const raw = serializeLastCash({
    account_id: 'CASH',
    category: '餐飲',
    income: false,
    income_type: 'income',
    flow_class: 'external',
  });
  storage.setItem('pfpro.lastCash', raw);
  const saved = parseLastCash(storage.getItem('pfpro.lastCash'));
  assert.equal(saved.account_id, 'CASH');
  assert.equal(saved.category, '餐飲');
  assert.equal(saved.income, false);
  assert.equal(usableLastCash(saved, ['CASH', 'BANK']), saved);
  assert.equal(usableLastCash(saved, ['BANK']), null);
  assert.equal(parseLastCash('not-json'), null);
  assert.equal(parseLastCash(''), null);
});

test('recent templates keep the newest six and refresh a repeat', () => {
  let list = [];
  for (let i = 1; i <= 7; i += 1) {
    list = rememberTemplate(list, {
      kind: 'expense',
      account_id: 'CASH',
      category: `分類${i}`,
      label: `支出 · 分類${i}`,
    });
  }
  assert.equal(list.length, 6);
  assert.equal(list[0].category, '分類7');
  assert.equal(list.some((item) => item.category === '分類1'), false);
  list = rememberTemplate(list, {
    kind: 'expense',
    account_id: 'CASH',
    category: '分類3',
    label: '支出 · 分類3',
  });
  assert.equal(list.length, 6);
  assert.equal(list[0].category, '分類3');
  assert.equal(list.filter((item) => item.category === '分類3').length, 1);
  assert.deepEqual(rememberTemplate(list, { kind: 'expense', category: '餐飲' }), list);
});

test('a template opens cash entry without posting, and income mode drops an expense category', () => {
  const item = { kind: 'dividend', account_id: 'BROKER', category: '股息', label: '股息 · 股息' };
  assert.deepEqual(entryQuery(item), {
    tab: 'cash',
    mode: 'income',
    kind: 'dividend',
    account: 'BROKER',
    category: '股息',
  });
  const merged = mergeEntryPreset(
    { account_id: 'CASH', category: '餐飲', income: false, income_type: 'income', flow_class: 'external' },
    { mode: 'income' },
    { income: ['薪資'], expense: ['餐飲'] },
  );
  assert.equal(merged.income, true);
  assert.equal(merged.account_id, 'CASH');
  assert.equal(merged.category, undefined);
  const kept = mergeEntryPreset(
    { account_id: 'CASH', category: '餐飲', income: false },
    { mode: 'expense', account: 'CARD' },
    { income: ['薪資'], expense: ['餐飲'] },
  );
  assert.equal(kept.income, false);
  assert.equal(kept.account_id, 'CARD');
  assert.equal(kept.category, '餐飲');
});
