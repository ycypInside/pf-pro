import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMoney, formatPct, formatQty, formatRate, formatTwd } from './format.js';

test('formats TWD with a true minus and grouped digits', () => {
  assert.equal(formatTwd(1234.5), 'NT$1,234.50');
  assert.equal(formatTwd(-150), '−NT$150.00');
  assert.equal(formatTwd(null), '—');
});

test('formats original currency and quantities without trailing zeros', () => {
  assert.equal(formatMoney(-1186.5, 'USD'), '−1,186.50 USD');
  assert.equal(formatQty(10), '10');
  assert.equal(formatQty(1.25), '1.25');
  assert.equal(formatQty(0), '0');
  assert.equal(formatRate(32.15), '32.15');
  assert.equal(formatPct(0.1), '+10.00%');
  assert.equal(formatPct(-0.25), '−25.00%');
  assert.equal(formatPct(null), '—');
});
