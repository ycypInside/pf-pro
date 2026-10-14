import assert from 'node:assert/strict';
import test from 'node:test';
import { daysBetween } from './money.js';
import {
  alertLevel,
  canMarkDebited,
  cardsForAsset,
  debitDayLabel,
  monthStateLabel,
  planPoints,
  plannedValue,
  rulePriceLines,
  trackLabel,
} from './p1.js';

test('empty debit day is 待補 and a real day keeps the calendar date', () => {
  assert.equal(debitDayLabel(null), '待補');
  assert.equal(debitDayLabel(undefined), '待補');
  assert.equal(debitDayLabel(''), '待補');
  assert.equal(debitDayLabel(0), '待補');
  assert.equal(debitDayLabel('0'), '待補');
  assert.equal(debitDayLabel(6), '每月 6 日');
  assert.equal(debitDayLabel('15'), '每月 15 日');
});

test('planned value is the monthly compound of baseline, contribution, and CAGR', () => {
  const track = {
    baseline_date: '2026-01-01',
    baseline_twd: 1000,
    monthly_twd: 100,
    cagr: 0,
  };
  assert.equal(plannedValue(track, '2026-01-01'), 1000);
  const months = daysBetween('2026-01-01', '2026-04-01') / 30.4375;
  assert.equal(plannedValue(track, '2026-04-01'), 1000 + 100 * months);
  const growing = {
    baseline_date: '2026-01-01',
    baseline_twd: 1000,
    monthly_twd: 0,
    cagr: 0.12,
  };
  const r = (1.12) ** (1 / 12) - 1;
  assert.ok(Math.abs(plannedValue(growing, '2026-04-01') - 1000 * (1 + r) ** months) < 1e-6);
});

test('plan points cover baseline, today, and milestones in date order', () => {
  const points = planPoints({
    baseline_date: '2024-01-01',
    baseline_twd: 50,
    monthly_twd: 1,
    cagr: 0,
    milestones: [
      { target_date: '2030-01-01' },
      { target_date: '2028-01-01' },
    ],
  }, '2026-10-14');
  assert.deepEqual(points.map((point) => point.date), ['2024-01-01', '2026-10-14', '2028-01-01', '2030-01-01']);
  assert.equal(points[0].y, 50);
  assert.ok(points[1].y > points[0].y);
  assert.equal(trackLabel({ track: 'main' }), '主計畫');
  assert.equal(trackLabel({ track: '挑戰上億', label: '挑戰上億' }), '挑戰上億');
});

test('DCA state labels and which rows can be marked debited', () => {
  assert.equal(monthStateLabel('debited'), '已扣款');
  assert.equal(monthStateLabel('pending'), '待扣款');
  assert.equal(monthStateLabel('paused_by_brake'), '煞車暫停');
  assert.equal(canMarkDebited({ dca_id: 'a', month_state: 'pending' }), true);
  assert.equal(canMarkDebited({ dca_id: 'a', month_state: 'paused_by_brake' }), true);
  assert.equal(canMarkDebited({ dca_id: 'a', month_state: 'debited' }), false);
  assert.equal(canMarkDebited({ month_state: 'pending' }), false);
});

test('holding card rules match the asset and only priced active rules become lines', () => {
  const cards = [
    {
      card_key: 'tw',
      asset_ids: ['0050', '00646'],
      status: 'active',
      rules: [
        { level: 175, action: '檢視部位', status: 'active' },
        { level: '', action: '無價位', status: 'active' },
        { level: 160, action: '已停用', status: 'paused' },
      ],
    },
    { card_key: 'old', asset_ids: ['0050'], status: 'retired', rules: [{ level: 10, status: 'active' }] },
    { card_key: 'peg', asset_ids: ['4938'], status: 'active', rules: [{ level: 90, action: '只記錄價位', status: 'active' }] },
  ];
  assert.deepEqual(cardsForAsset(cards, '0050').map((card) => card.card_key), ['tw']);
  assert.deepEqual(rulePriceLines(cardsForAsset(cards, '0050')), [{ price: 175, label: '檢視部位' }]);
  assert.equal(alertLevel('red'), 'red');
  assert.equal(alertLevel('nope'), 'info');
});
