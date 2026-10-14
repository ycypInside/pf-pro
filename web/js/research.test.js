import assert from 'node:assert/strict';
import test from 'node:test';
import { cardViews } from './p1.js';
import {
  cardCloseBasis,
  closeBasisLabel,
  directlyHeld,
  fundViews,
  httpUrl,
  paperStale,
  rotationView,
  rotationWeeks,
  weightText,
  weightWidth,
} from './research.js';

test('fund composition keeps order, tags overlap, and hides empty bars', () => {
  const view = fundViews({
    ok: true,
    file_date: '2026-10-01',
    source_note: '公開月報',
    funds: [
      {
        fund_id: 'f1',
        name: '台灣50',
        fund_type: 'etf',
        held_value_twd: 250000,
        data_date: '2026-09-30',
        sectors_date: '2026-09-30',
        top10: [
          { rank: 1, name: '台積電', symbol: '2330', weight_pct: 40.5 },
          { rank: 2, name: '聯發科', symbol: '2454', weight_pct: 5 },
        ],
        sectors: [{ name: '半導體', weight_pct: 60 }],
        regions: [],
        overlap: [{ holding_name: '台積電', fund_weight_pct: 40.5 }],
        source: 'https://example.com/fund-note',
      },
      {
        fund_id: 'f2',
        name: '全球債券',
        fund_type: 'fund',
        held_value_twd: null,
        regions: [{ name: '美國', weight_pct: 80 }],
        regions_date: '2026-08-31',
        source: 'javascript:alert(1)',
      },
    ],
    lookthrough: [{
      name: '台積電',
      direct_value_twd: 100000,
      via_funds_twd: 80000,
      total_twd: 180000,
      funds: [{ fund_name: '台灣50', fund_weight_pct: 40.5, via_fund_twd: 80000 }],
    }],
    cross_fund: [{
      name: '台積電',
      funds: [
        { fund_name: '台灣50', weight_pct: 40.5 },
        { fund_name: '全球債券', weight_pct: 1 },
      ],
    }],
  });
  assert.deepEqual(view.funds.map((fund) => fund.name), ['台灣50', '全球債券']);
  assert.equal(view.fileDate, '2026-10-01');
  assert.equal(view.sourceNote, '公開月報');
  assert.equal(view.funds[0].typeLabel, 'ETF');
  assert.equal(view.funds[1].typeLabel, '基金');
  assert.equal(view.funds[0].held, 250000);
  assert.equal(view.funds[1].held, null);
  assert.equal(view.funds[0].top10[0].held, true);
  assert.equal(view.funds[0].top10[1].held, false);
  assert.equal(directlyHeld({ name: ' 台積電 ' }, [{ holding_name: '台積電' }]), true);
  assert.equal(view.funds[0].sectors.length, 1);
  assert.equal(view.funds[0].regions.length, 0);
  assert.equal(view.funds[1].regions[0].name, '美國');
  assert.equal(view.funds[0].href, 'https://example.com/fund-note');
  assert.equal(view.funds[1].href, '');
  assert.equal(httpUrl(`${'fi'}${'le'}:/tmp/x`), '');
  assert.equal(view.lookthrough[0].direct, 100000);
  assert.equal(view.lookthrough[0].via, 80000);
  assert.equal(view.lookthrough[0].total, 180000);
  assert.equal(view.lookthrough[0].funds[0].via, 80000);
  assert.equal(view.crossFund[0].funds.length, 2);
  assert.equal(weightText(40.5), '40.50%');
  assert.equal(weightWidth(140), 100);
  assert.equal(weightWidth(-3), 0);
});

test('rotation highlights the current row, otherwise the next week', () => {
  const current = rotationWeeks([
    { week_start: '2026-10-06', week_end: '2026-10-12', market: 'TW', symbol: '2330', name: '台積電', has_report: true, report_date: '2026-10-10', is_current: false },
    { week_start: '2026-10-13', week_end: '2026-10-19', market: 'US', symbol: 'AAPL', name: '蘋果', has_report: false, is_current: true, note: '本週' },
    { week_start: '2026-10-13', week_end: '2026-10-19', market: 'TW', symbol: '2454', name: '聯發科', has_report: false, is_current: false },
  ], '2026-10-14');
  assert.equal(current.length, 2);
  assert.equal(current[0].rows[0].highlight, false);
  assert.equal(current[1].rows[0].highlight, true);
  assert.equal(current[1].rows[1].highlight, false);
  assert.equal(current[1].rows[0].hasReport, false);
  assert.equal(current[0].rows[0].market, 'TW');
  assert.equal(current[1].rows[0].market, 'US');

  const upcoming = rotationWeeks([
    { week_start: '2026-10-06', week_end: '2026-10-12', market: 'TW', symbol: '2330', is_current: false },
    { week_start: '2026-10-20', week_end: '2026-10-26', market: 'US', symbol: 'MSFT', is_current: false },
  ], '2026-10-14');
  assert.equal(upcoming[0].rows[0].highlight, false);
  assert.equal(upcoming[1].rows[0].highlight, true);

  const last = rotationWeeks([
    { week_start: '2026-10-06', week_end: '2026-10-12', market: 'TW', symbol: '2330', is_current: false },
  ], '2026-10-20');
  assert.equal(last[0].rows[0].highlight, true);

  const view = rotationView({ cadence: '每週一檔', rotation: [], reports: [{ symbol: '2330', title: '週報', report_date: '2026-10-10', in_rotation: true }] }, '2026-10-14');
  assert.equal(view.cadence, '每週一檔');
  assert.equal(view.reports[0].title, '週報');
});

test('close basis needs a close date', () => {
  assert.equal(closeBasisLabel({ trigger_basis: 'close', close_date: '2026-10-13', close_price: 180 }), '以 2026-10-13 收盤判定');
  assert.equal(closeBasisLabel({ trigger_basis: 'close' }), '');
  assert.equal(cardCloseBasis(
    { trigger_basis: 'close', rules: [{ trigger_basis: 'close' }] },
    [{ card_key: 'tw', trigger_basis: 'close', close_date: '2026-10-13' }],
  ), '以 2026-10-13 收盤判定');
  const [card] = cardViews(
    [{ card_key: 'tw', name: '台灣50卡', asset_ids: ['0050'], trigger_basis: 'close', status: 'active', rules: [] }],
    {},
    [{ card_key: 'tw', trigger_basis: 'close', close_date: '2026-10-13', close_price: 180 }],
  );
  assert.equal(card.closeBasis, '以 2026-10-13 收盤判定');
  assert.equal(paperStale({ is_stale: true, stale: '紙上倉報價已過期' }).note, '紙上倉報價已過期');
  assert.equal(paperStale({}).stale, false);
});
