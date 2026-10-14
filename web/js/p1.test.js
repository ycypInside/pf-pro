import assert from 'node:assert/strict';
import test from 'node:test';
import { daysBetween } from './money.js';
import {
  alertLevel,
  benchmarkSymbol,
  canMarkDebited,
  cardViews,
  cardsForAsset,
  dayChange,
  dcaStatusLine,
  debitDayLabel,
  decisionView,
  monthStateLabel,
  paperView,
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

test('path D progress reads path_d as a ratio', () => {
  const tracks = [{ track: '挑戰上億', label: '挑戰上億', gap_twd: -100, gap_pct: -0.01 }];
  const ratio = (15000000 - 14020000) / (16540000 - 14020000);
  const path = pathProgress({
    tracks,
    path_d: {
      start_twd: 14020000,
      start_date: '2026-09-16',
      year1_target_twd: 16540000,
      year1_date: '2027-09-16',
      actual_twd: 15000000,
      progress_pct: ratio,
      remaining_twd: 1540000,
    },
  });
  assert.equal(wanLabel(path.start), '1,402萬');
  assert.equal(wanLabel(path.target), '1,654萬');
  assert.equal(path.startDate, '2026-09-16');
  assert.equal(path.year1Date, '2027-09-16');
  assert.equal(path.ratio, ratio);
  assert.equal(path.remaining, 1540000);
  assert.equal(yiTrack(tracks).track, '挑戰上億');
  assert.equal(pathProgress({ tracks }), null);
});

test('day change reads nw_day_change and keeps a null percent', () => {
  assert.deepEqual(dayChange({
    nw_day_change: { change_twd: -100, change_pct: -0.01, date: '2026-10-14', prev_date: '2026-10-13' },
  }), { twd: -100, pct: -0.01, date: '2026-10-14', prevDate: '2026-10-13' });
  assert.deepEqual(dayChange({
    change_twd: null,
    change_pct: null,
    date: '2026-10-14',
    prev_date: null,
  }), { twd: null, pct: null, date: '2026-10-14', prevDate: '' });
  assert.equal(dayChange({ net_worth_twd: 110, series: [{ date: '2026-10-13', index: 1.1 }] }), null);
});

test('decisions come from q=decisions and an empty count stays quiet', () => {
  const filled = decisionView({
    count: 1,
    items: [{ kind: 'exit_line', level: 'red', title: '元大台灣50：檢視部位', detail: '線下', ref: 'r1' }],
    disclaimer: '待決事項僅為提醒，不是操作單。',
  });
  assert.equal(filled.known, true);
  assert.equal(filled.count, 1);
  assert.equal(filled.items[0].kind, 'exit_line');
  assert.match(filled.disclaimer, /不是操作單/);
  const quiet = decisionView({ count: 0, items: [] });
  assert.equal(quiet.known, true);
  assert.equal(quiet.count, 0);
  assert.equal(quiet.items.length, 0);
  assert.match(quiet.disclaimer, /不是操作單/);
  assert.equal(decisionView(null).known, false);
  assert.match(decisionView({ ok: false }).disclaimer, /不是操作單/);
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

test('paper maps benchmark 50 to 0050 and always lists sleeves A/B/C', () => {
  assert.equal(benchmarkSymbol('50'), '0050');
  assert.equal(benchmarkSymbol('00631L'), '00631L');
  const empty = paperView(null);
  assert.deepEqual(empty.sleeves.map((row) => row.sleeve), ['A', 'B', 'C']);
  assert.match(empty.note, /不計入淨值/);
  const view = paperView({
    sleeves: [{
      sleeve: 'A',
      equity_twd: 1050000,
      return_pct: 5,
      vs_0050_pp: 1.2,
      vs_00631L_pp: -0.4,
      gate: {
        target: 21.71,
        min_trading_days: 20,
        go_live_allowed: false,
        checks: [{ label: '交易日', current: '12/20', ok: false }],
      },
      positions: [{ code: '2330', name: '台積電', qty: 10, pnl_pct: 5.56 }],
      series: [{ date: '2026-10-13', return_pct: 5 }],
    }],
    benchmarks: {
      50: { symbol: '50', return_pct: 3.5, series: [{ date: '2026-10-13', return_pct: 3.5 }] },
      '00631L': { symbol: '00631L', return_pct: 5.4, series: [] },
    },
  });
  assert.equal(view.benchmarks['0050'].symbol, '0050');
  assert.equal(view.benchmarks['0050'].returnPct, 3.5);
  assert.equal(view.benchmarks['50'], undefined);
  assert.equal(view.sleeves[0].positions[0].name, '台積電');
  assert.equal(view.sleeves[0].gate.checks[0].ok, false);
  assert.equal(view.sleeves[0].gate.goLive, false);
  assert.equal(view.sleeves[1].present, false);
  assert.equal(view.sleeves[2].sleeve, 'C');
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
