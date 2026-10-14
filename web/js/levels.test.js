import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLevel, levelLadder, roundLevel } from './levels.js';

const chart = {
  symbol: '0050',
  rows: [
    { d: '2026-09-01', o: 170, h: 176, l: 168, c: 172 },
    { d: '2026-09-15', o: 172, h: 178, l: 170, c: 175 },
    { d: '2026-10-13', o: 175, h: 182, l: 174, c: 180.25 },
  ],
  ma20: [null, 173, 175],
  ma60: [null, null, 174],
  levels: {
    resistance: [{ price: 190 }],
    support: [{ price: 160 }],
    pivot: { p: 178, r1: 184, s1: 170 },
    high_52w: 200,
    low_52w: 140,
  },
};

test('levels sort by price and mark the last close', () => {
  const ladder = levelLadder(chart);
  const labels = ladder.rows.map((row) => `${row.label}:${formatLevel(row.price)}`);
  assert.deepEqual(labels, [
    '52 週高:200.00',
    '壓力線:190.00',
    'R2:186.00',
    'R1:184.00',
    '現價:180.25',
    'Pivot:178.00',
    'MA20:175.00',
    'MA60:174.00',
    'S1:170.00',
    'S2:170.00',
    '支撐線:160.00',
    '52 週低:140.00',
  ]);
  const now = ladder.rows.find((row) => row.current);
  const index = ladder.rows.indexOf(now);
  assert.ok(ladder.rows[index - 1].price > now.price);
  assert.ok(ladder.rows[index + 1].price < now.price);
  assert.equal(roundLevel(190 / 180.25 - 1), roundLevel(ladder.rows.find((row) => row.kind === 'resistance').distance));
  assert.equal(ladder.summary, '目前位於支撐 170.00 與壓力 184.00 之間，站上 MA20');
  assert.equal(ladder.disclaimer, '技術指標僅供參考，不構成投資建議');
  assert.equal(ladder.rows.find((row) => row.kind === 'resistance').note, '近期高點，接近時可考慮分批獲利、有效突破則可能轉為支撐');
  assert.equal(ladder.rows.find((row) => row.kind === 'support').note, '近期低點，回測不破可考慮分批布局、跌破則考慮停損');
  assert.equal(ladder.rows.find((row) => row.kind === 'ma20').note, '約一個月均價，短線多空分界');
  assert.equal(ladder.rows.find((row) => row.kind === 'ma60').note, '季線，中期趨勢');
  assert.equal(ladder.rows.find((row) => row.kind === 'pivot').note, '當日／短線參考價');
});

test('4938 keeps the same prices with neutral descriptions', () => {
  const ladder = levelLadder({ ...chart, symbol: '4938', asset_id: '4938' });
  assert.deepEqual(ladder.rows.map((row) => row.price), levelLadder(chart).rows.map((row) => row.price));
  assert.equal(ladder.neutral, true);
  assert.equal(ladder.summary, '目前位於支撐 170.00 與壓力 184.00 之間，價格高於 MA20');
  const text = ladder.rows.map((row) => `${row.note} ${ladder.summary}`).join('\n');
  for (const word of ['獲利', '停損', '布局', '買', '賣', '進場', '出場', '加碼', '減碼']) {
    assert.equal(text.includes(word), false, word);
  }
  assert.match(ladder.rows.find((row) => row.kind === 'resistance').note, /近期高點/);
  assert.match(ladder.rows.find((row) => row.kind === 'ma20').note, /平均價/);
});

test('missing fields are computed from the bars', () => {
  const bars = [
    { h: 11, l: 9, c: 10 },
    { h: 12, l: 10, c: 11 },
    { h: 13, l: 11, c: 12 },
    { h: 16, l: 12, c: 14 },
    { h: 12, l: 7, c: 11 },
    { h: 13, l: 10, c: 12 },
    { h: 14, l: 11, c: 13 },
  ];
  const ladder = levelLadder({ symbol: '2330', rows: bars });
  const byKind = (kind) => ladder.rows.filter((row) => row.kind === kind).map((row) => roundLevel(row.price));
  assert.deepEqual(byKind('resistance'), [16]);
  assert.deepEqual(byKind('support'), [7]);
  const prev = bars[5];
  const pivot = (prev.h + prev.l + prev.c) / 3;
  assert.equal(roundLevel(ladder.rows.find((row) => row.kind === 'pivot').price), roundLevel(pivot));
  assert.equal(roundLevel(ladder.rows.find((row) => row.kind === 'r2').price), roundLevel(pivot + (prev.h - prev.l)));
  assert.equal(roundLevel(ladder.rows.find((row) => row.kind === 's2').price), roundLevel(pivot - (prev.h - prev.l)));
  assert.equal(roundLevel(ladder.rows.find((row) => row.kind === 'high52').price), 16);
  assert.equal(roundLevel(ladder.rows.find((row) => row.kind === 'low52').price), 7);
  assert.equal(ladder.rows.find((row) => row.kind === 'ma20'), undefined);
  assert.equal(ladder.summary, '目前位於支撐 10.33 與壓力 13.33 之間');
});

test('moving averages fall back to the close series', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({ h: 20, l: 10, c: index + 1 }));
  const ladder = levelLadder({ symbol: 'SPY', rows });
  const ma20 = ladder.rows.find((row) => row.kind === 'ma20');
  const ma60 = ladder.rows.find((row) => row.kind === 'ma60');
  assert.equal(roundLevel(ma20.price), roundLevel((41 + 60) * 20 / 2 / 20));
  assert.equal(roundLevel(ma60.price), roundLevel((1 + 60) * 60 / 2 / 60));
  assert.match(ladder.summary, /站上 MA20/);
});
