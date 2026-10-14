import assert from 'node:assert/strict';
import test from 'node:test';
import { daysBetween } from './money.js';
import {
  alertLevel,
  canMarkDebited,
  cardViews,
  cardsForAsset,
  collectDecisions,
  dayChange,
  dcaStatusLine,
  debitDayLabel,
  monthStateLabel,
  paperSleeves,
  pathProgress,
  planPoints,
  plannedValue,
  rulePriceLines,
  trackLabel,
  wanLabel,
  yiTrack,
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

test('path D progress uses the baseline and the year-1 target', () => {
  const tracks = [
    {
      track: 'D',
      label: '路徑 D',
      baseline_twd: 14020000,
      actual_twd: 15000000,
      milestones: [{ year: 1, target_twd: 16540000 }],
    },
    { track: '挑戰上億', label: '挑戰上億', gap_twd: -100, gap_pct: -0.01 },
  ];
  const path = pathProgress(tracks, 1);
  assert.equal(wanLabel(path.start), '1,402萬');
  assert.equal(wanLabel(path.target), '1,654萬');
  assert.equal(path.ratio, (15000000 - 14020000) / (16540000 - 14020000));
  assert.equal(yiTrack(tracks).track, '挑戰上億');
  assert.equal(pathProgress([{ track: 'main', label: '主計畫', baseline_twd: 1, milestones: [] }], 1), null);
});

test('day change prefers an explicit figure and otherwise uses the latest trading step', () => {
  assert.deepEqual(dayChange({ day_change_twd: -100, day_change_pct: -0.01 }), { twd: -100, pct: -0.01 });
  const stepped = dayChange({ net_worth_twd: 110 }, {
    series: [
      { date: '2026-10-12', index: 1 },
      { date: '2026-10-13', index: 1.1 },
    ],
  });
  assert.ok(Math.abs(stepped.twd - 10) < 1e-6);
  assert.equal(dayChange({ net_worth_twd: 110 }, {
    series: [
      { date: '2026-01-02', index: 1 },
      { date: '2026-10-13', index: 1.1 },
    ],
  }), null);
});

test('decisions come from the dedicated payload, otherwise from alerts, pauses, and stale quotes', () => {
  assert.deepEqual(collectDecisions({
    decisions: { ok: true, items: [{ title: '後端決定', detail: '一筆' }] },
    alerts: [{ level: 'red', type: 'close_below', name: '忽略' }],
  }).items.map((item) => item.title), ['後端決定']);
  const derived = collectDecisions({
    alerts: [
      { level: 'red', type: 'close_below', name: '元大台灣50', action: '檢視部位', detail: '連續 1/3 日' },
      { level: 'watch', type: 'close_below', name: '還沒確認', detail: '連續 1/3 日' },
      { level: 'amber', type: 'trade_ticket', name: '賣出單', action: '確認' },
    ],
    dcaItems: [{ name: '元大S&P500', month_state: 'paused_by_brake' }],
    quotes: { 4938: { name: '和碩', is_stale: true, price_date: '2026-08-01' } },
  });
  assert.deepEqual(derived.items.map((item) => item.kind), ['exit', 'ticket', 'dca', 'stale']);
  assert.equal(collectDecisions({ alerts: [] }).items.length, 0);
  assert.equal(collectDecisions({ alerts: [] }).known, true);
  assert.equal(dcaStatusLine([
    { month_state: 'debited' },
    { month_state: 'pending' },
    { month_state: 'paused_by_brake' },
  ]), '本月定額：已扣款 1、待扣款 1、煞車暫停 1');
});

test('holding cards show the exit distance, day count, and thesis date', () => {
  const [card] = cardViews(
    [{
      card_key: 'tw',
      name: '台灣50卡',
      asset_ids: ['0050'],
      status: 'active',
      rules: [
        { type: 'close_below', level: 175, confirm_days: 3, action: '出場', status: 'active' },
        { type: 'date_reached', date: '2026-11-15', action: '論點檢討', status: 'active' },
      ],
    }],
    { '0050': { last: 180.25, currency: 'TWD', is_stale: false } },
    [{ card_key: 'tw', detail: '連續 1/3 日' }],
  );
  assert.equal(card.price, 180.25);
  assert.equal(card.exit, 175);
  assert.ok(Math.abs(card.distance - (180.25 / 175 - 1)) < 1e-9);
  assert.deepEqual(card.day, { current: 1, total: 3 });
  assert.equal(card.thesis, '2026-11-15');
});

test('paper sleeves stay A/B/C against 0050 and 00631L even before the payload arrives', () => {
  assert.deepEqual(paperSleeves(null).map((row) => row.id), ['A', 'B', 'C']);
  assert.deepEqual(paperSleeves(null)[0].benchmarks, ['0050', '00631L']);
  const filled = paperSleeves({
    sleeves: [{ id: 'B', benchmark: '00631L', positions: [{ symbol: '紙上0050', quantity: 1 }] }],
  });
  assert.equal(filled[1].positions[0].symbol, '紙上0050');
  assert.deepEqual(filled[0].positions, []);
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
