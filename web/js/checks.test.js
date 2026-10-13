import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const context = {};
createContext(context);
runInContext(readFileSync(path.join(root, 'apps-script/Checks.js'), 'utf8'), context);

const {
  ckExpectTwd_, ckAmountTwdOk_, ckTwdFxOk_, ckSameCurrencyOk_, ckOppositeSignsOk_,
  ckDateOnOrAfter_, ckInvestmentInflowOk_, ckVoidReasonOk_, ckRound2_, ckRound4_,
} = context;

test('TWD product 1186.5 × 32.15 rounds half-up to 38145.98', () => {
  assert.equal(ckExpectTwd_(1186.5, 32.15), 38145.98);
  assert.equal(ckAmountTwdOk_(1186.5, 32.15, 38145.98), true);
  assert.equal(ckAmountTwdOk_(1186.5, 32.15, 38145.97), false);
  assert.equal(ckAmountTwdOk_(-80, 1, -80), true);
});

test('a TWD leg must use fx 1', () => {
  assert.equal(ckTwdFxOk_('TWD', 1), true);
  assert.equal(ckTwdFxOk_('TWD', 32.15), false);
  assert.equal(ckTwdFxOk_('USD', 32.15), true);
});

test('same-currency transfers cancel at 4 decimals, not cents', () => {
  assert.equal(ckSameCurrencyOk_('USD', 10.1234, 'USD', -10.1234), true);
  assert.equal(ckSameCurrencyOk_('USD', 10.1234, 'USD', -10.1235), false);
  assert.equal(ckRound2_(10.1234 + -10.1235), 0);
  assert.notEqual(ckRound4_(10.1234 + -10.1235), 0);
  assert.equal(ckSameCurrencyOk_('TWD', -100, 'TWD', 100), true);
  assert.equal(ckSameCurrencyOk_('USD', -100, 'JPY', 15000), true);
});

test('transfer legs need opposite non-zero signs', () => {
  assert.equal(ckOppositeSignsOk_(-20, 20), true);
  assert.equal(ckOppositeSignsOk_(20, 20), false);
  assert.equal(ckOppositeSignsOk_(0, 20), false);
  assert.equal(ckOppositeSignsOk_(-1, 0), false);
});

test('a transaction cannot predate the account opening date', () => {
  assert.equal(ckDateOnOrAfter_('2026-01-02', '2026-01-01'), true);
  assert.equal(ckDateOnOrAfter_('2026-01-01', '2026-01-01'), true);
  assert.equal(ckDateOnOrAfter_('2025-12-31', '2026-01-01'), false);
});

test('investment inflows must be external or internal', () => {
  assert.equal(ckInvestmentInflowOk_(true, 100, 'transfer_in', 'external'), true);
  assert.equal(ckInvestmentInflowOk_('TRUE', 100, 'income', 'internal'), true);
  assert.equal(ckInvestmentInflowOk_('TRUE', 100, 'income', 'investment_income'), false);
  assert.equal(ckInvestmentInflowOk_(true, 50, 'fx_in', 'external'), true);
  assert.equal(ckInvestmentInflowOk_(true, -50, 'expense', 'external'), true);
  assert.equal(ckInvestmentInflowOk_(false, 100, 'income', 'investment_income'), true);
  assert.equal(ckInvestmentInflowOk_(true, 100, 'dividend', 'investment_income'), true);
});

test('voiding needs a reason', () => {
  assert.equal(ckVoidReasonOk_('更正分類'), true);
  assert.equal(ckVoidReasonOk_('  '), false);
  assert.equal(ckVoidReasonOk_(''), false);
  assert.equal(ckVoidReasonOk_(null), false);
});
