import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToday, isPaper } from './today.js';

const now = new Date('2026-11-10T02:00:00Z');

function book(overrides = {}) {
  return {
    ok: true,
    as_of: '2026-11-10',
    at: '2026-11-10T01:00:00Z',
    single_name_max: 0.1,
    single_stocks: [
      { symbol: '0050', name: '元大台灣50', weight: 0.08, over_limit: false },
    ],
    allocation: {
      band_pct: 5,
      target: { stock: 0.9, bond: 0.05, cash: 0.05 },
      rows: [
        { bucket: 'stock', label: '股票', actual_weight: 0.9, target_weight: 0.9, drift: 0 },
        { bucket: 'bond', label: '債券', actual_weight: 0.05, target_weight: 0.05, drift: 0 },
        { bucket: 'cash', label: '現金', actual_weight: 0.05, target_weight: 0.05, drift: 0 },
      ],
      estimated: [],
    },
    cash_brake: {
      enabled: true,
      triggered: false,
      cash_pct_total: 0.12,
      net_cash_pct_nw: 0.05,
      thresholds: { cash_pct_total: 0.08, net_cash_pct_nw: 0.02 },
      reason: '',
    },
    pegatron_pre_earnings: false,
    stale: [],
    advice: [],
    dca: { exempt_enabled: false, core_assets: ['0050'] },
    ...overrides,
  };
}

function light(model, id) {
  return model.lights.find((item) => item.id === id);
}

test('a calm book with the brake armed answers 照定額', () => {
  const model = buildToday(book(), { now });
  assert.equal(model.headline, '照定額');
  assert.equal(model.displayOnly, true);
  assert.equal(model.reasons.length <= 3, true);
  assert.equal(model.reasons[0].section, 'sec-cash');
  assert.equal(light(model, 'single').tone, 'green');
  assert.equal(light(model, 'band').tone, 'green');
  assert.equal(light(model, 'cash').tone, 'green');
  assert.equal(light(model, 'quotes').tone, 'green');
  assert.equal(light(model, 'window').tone, 'green');
  assert.equal(model.banner, null);
  assert.match(light(model, 'cash').lines.join('\n'), /門檻 8\.0%/);
  assert.match(light(model, 'cash').lines.join('\n'), /門檻 2\.0%/);
});

test('no scheduled DCA and a clear book answers 不用動', () => {
  const model = buildToday(book({
    cash_brake: {
      enabled: false,
      triggered: false,
      cash_pct_total: 0.2,
      net_cash_pct_nw: 0.1,
      thresholds: { cash_pct_total: 0.08, net_cash_pct_nw: 0.02 },
    },
    dca: { exempt_enabled: false, core_assets: [] },
  }), { now });
  assert.equal(model.headline, '不用動');
  assert.equal(light(model, 'cash').tone, 'green');
  assert.equal(model.reasons[0].text, '目前沒有需要動手的訊號');
});

test('a triggered cash brake pauses DCA ahead of a cap breach', () => {
  const model = buildToday(book({
    cash_brake: {
      enabled: true,
      triggered: true,
      cash_pct_total: 0.06,
      net_cash_pct_nw: 0.01,
      thresholds: { cash_pct_total: 0.08, net_cash_pct_nw: 0.02 },
      reason: '現金佔總資產 6.0%，低於 8%',
    },
    single_name_trim: 0.2,
    single_stocks: [
      { symbol: '2330', name: '台積電', weight: 0.22, over_limit: true, over_trim: true },
    ],
  }), { now });
  assert.equal(model.headline, '暫停定額');
  assert.equal(model.verdictId, 'pause');
  assert.equal(light(model, 'cash').tone, 'red');
  assert.equal(light(model, 'single').tone, 'red');
  assert.equal(model.reasons[0].section, 'sec-cash');
  assert.match(model.reasons.map((item) => item.text).join(' '), /台積電/);
  assert.equal(model.reasons.length <= 3, true);
});

test('over_limit without a trim line pauses adds and does not invent 15% or 20%', () => {
  const model = buildToday(book({
    single_name_max: 0.1,
    single_stocks: [{ symbol: '2330', name: '台積電', weight: 0.12, over_limit: true }],
  }), { now });
  assert.notEqual(model.headline, '建議減碼檢視');
  assert.equal(model.thresholds.singleCap, 0.1);
  assert.equal(model.thresholds.trimAbove, null);
  assert.equal(light(model, 'single').tone, 'yellow');
  const text = light(model, 'single').lines.join('\n');
  assert.match(text, /不加碼線 10\.0%/);
  assert.match(text, /台積電 12\.0% · 暫停加碼/);
  assert.doesNotMatch(text, /減碼線|15\.0%|20\.0%|建議分批減碼/);
  assert.equal(JSON.stringify(model.reasons).includes('建議減碼檢視'), false);
});

test('15% pauses adds and 20% is the only trim', () => {
  const held = buildToday(book({
    single_name_max: 0.15,
    single_name_trim: 0.2,
    single_stocks: [{ symbol: '2330', name: '台積電', weight: 0.12, over_limit: false, over_trim: false }],
  }), { now });
  assert.equal(light(held, 'single').tone, 'green');
  assert.equal(held.headline, '照定額');

  const pause = buildToday(book({
    single_name_max: 0.15,
    single_name_trim: 0.2,
    single_stocks: [{ symbol: '2330', name: '台積電', weight: 0.16, over_limit: true, over_trim: false }],
  }), { now });
  assert.equal(light(pause, 'single').tone, 'yellow');
  assert.equal(pause.headline, '照定額');
  assert.match(light(pause, 'single').lines.join('\n'), /不加碼線 15\.0%/);
  assert.match(light(pause, 'single').lines.join('\n'), /減碼線 20\.0%/);
  assert.match(light(pause, 'single').lines.join('\n'), /暫停加碼/);
  assert.doesNotMatch(pause.reasons.map((item) => item.text).join(' '), /建議分批減碼/);

  const trim = buildToday(book({
    single_name_max: 0.15,
    single_name_trim: 0.2,
    single_stocks: [{ symbol: '2330', name: '台積電', weight: 0.22, over_limit: true, over_trim: true }],
  }), { now });
  assert.equal(light(trim, 'single').tone, 'red');
  assert.equal(trim.headline, '建議減碼檢視');
  assert.match(light(trim, 'single').lines.join('\n'), /建議分批減碼/);
  assert.match(trim.reasons.map((item) => item.text).join(' '), /超過減碼線 20\.0%/);
});

test('a name under the no-add line stays green', () => {
  const model = buildToday(book({
    single_stocks: [{ symbol: '2330', name: '台積電', weight: 0.09, over_limit: false }],
  }), { now });
  assert.equal(light(model, 'single').tone, 'green');
  assert.equal(model.headline, '照定額');
  assert.equal(model.reasons.some((item) => item.text.includes('暫停加碼')), false);
});

test('stocks and funds are one band against bonds and cash', () => {
  const inside = buildToday(book({
    allocation: {
      band_pct: 5,
      rows: [
        { bucket: 'stock', actual_weight: 0.5, target_weight: 0.4 },
        { bucket: 'fund', actual_weight: 0.2, target_weight: 0.3 },
        { bucket: 'bond', actual_weight: 0.05, target_weight: 0.05 },
        { bucket: 'cash', actual_weight: 0.25, target_weight: 0.25 },
      ],
      estimated: [],
    },
  }), { now });
  assert.equal(light(inside, 'band').tone, 'green');
  assert.match(light(inside, 'band').lines.join('\n'), /股票／基金 70\.0%，目標 70\.0% · 帶內/);

  const outside = buildToday(book({
    allocation: {
      band_pct: 5,
      rows: [
        { bucket: 'stock', actual_weight: 0.8, target_weight: 0.6 },
        { bucket: 'bond', actual_weight: 0.05, target_weight: 0.2 },
        { bucket: 'cash', actual_weight: 0.15, target_weight: 0.2 },
      ],
      estimated: [],
    },
  }), { now });
  assert.equal(outside.headline, '建議配置檢視');
  assert.equal(light(outside, 'band').tone, 'red');
  assert.equal(outside.reasons.some((item) => item.section === 'sec-allocation'), true);
});

test('estimated prices turn a band breach into 先核對報價', () => {
  const model = buildToday(book({
    allocation: {
      band_pct: 5,
      rows: [
        { bucket: 'stock', actual_weight: 0.8, target_weight: 0.6 },
        { bucket: 'bond', actual_weight: 0.05, target_weight: 0.05 },
        { bucket: 'cash', actual_weight: 0.15, target_weight: 0.35 },
      ],
      estimated: ['2330'],
    },
  }), { now });
  assert.equal(model.headline, '先核對報價');
  assert.equal(light(model, 'band').tone, 'red');
});

test('cash pause uses the thresholds the API sent', () => {
  const model = buildToday(book({
    cash_brake: {
      enabled: true,
      triggered: true,
      cash_pct_total: 0.04,
      net_cash_pct_nw: 0.03,
      thresholds: { cash_pct_total: 0.05, net_cash_pct_nw: 0.03 },
    },
  }), { now });
  assert.equal(model.headline, '暫停定額');
  const text = light(model, 'cash').lines.join('\n');
  assert.match(text, /門檻 5\.0%/);
  assert.match(text, /門檻 3\.0%/);
  assert.doesNotMatch(text, /門檻 8\.0%/);
});

test('a brake that is off stays yellow when cash is already under the line', () => {
  const model = buildToday(book({
    cash_brake: {
      enabled: false,
      triggered: true,
      cash_pct_total: 0.04,
      net_cash_pct_nw: 0.01,
      thresholds: { cash_pct_total: 0.08, net_cash_pct_nw: 0.02 },
    },
    dca: { core_assets: [] },
  }), { now });
  assert.notEqual(model.headline, '暫停定額');
  assert.equal(light(model, 'cash').tone, 'yellow');
  assert.match(model.reasons.map((item) => item.text).join(' '), /煞車未開啟/);
});

test('cash within one point of an open brake is yellow and still 照定額', () => {
  const model = buildToday(book({
    cash_brake: {
      enabled: true,
      triggered: false,
      cash_pct_total: 0.085,
      net_cash_pct_nw: 0.05,
      thresholds: { cash_pct_total: 0.08, net_cash_pct_nw: 0.02 },
    },
  }), { now });
  assert.equal(light(model, 'cash').tone, 'yellow');
  assert.equal(model.headline, '照定額');
});

test('4938 inside the pre-earnings window is not a trim', () => {
  const model = buildToday(book({
    pegatron_pre_earnings: true,
    single_name_max: 0.15,
    single_name_trim: 0.2,
    single_stocks: [
      { symbol: '4938', name: '和碩', asset_id: '4938', weight: 0.22, over_limit: true, over_trim: true },
    ],
    advice: [{ level: 'info', title: '和碩 4938：接近財報公布前', tag: 'compliance' }],
  }), { now });
  assert.equal(model.headline, '照定額');
  assert.equal(light(model, 'window').tone, 'red');
  assert.notEqual(light(model, 'single').tone, 'red');
  assert.match(light(model, 'single').lines.join('\n'), /財報前不交易/);
  assert.doesNotMatch(light(model, 'single').lines.join('\n'), /建議分批減碼/);
  assert.match(model.reasons.map((item) => item.text).join(' '), /4938 財報前不交易/);
  assert.equal(model.reasons.some((item) => item.text.includes('建議分批減碼')), false);
});

test('4938 outside the window is a trim only when over_trim', () => {
  const pause = buildToday(book({
    pegatron_pre_earnings: false,
    single_name_max: 0.15,
    single_name_trim: 0.2,
    single_stocks: [{ symbol: '4938', name: '和碩', weight: 0.18, over_limit: true, over_trim: false }],
  }), { now });
  assert.equal(pause.headline, '照定額');
  assert.equal(light(pause, 'single').tone, 'yellow');

  const model = buildToday(book({
    pegatron_pre_earnings: false,
    single_name_max: 0.15,
    single_name_trim: 0.2,
    single_stocks: [{ symbol: '4938', name: '和碩', weight: 0.22, over_limit: true, over_trim: true }],
  }), { now });
  assert.equal(model.headline, '建議減碼檢視');
  assert.equal(light(model, 'window').tone, 'green');
  assert.equal(light(model, 'single').tone, 'red');
});

test('a stale quote on an over-trim name asks for a check instead of a trim', () => {
  const model = buildToday(book({
    single_name_trim: 0.2,
    single_stocks: [{ symbol: '2330', name: '台積電', weight: 0.22, over_limit: true, over_trim: true }],
    stale: [{ symbol: '2330', name: '台積電', price_date: '2026-08-01', limit: 7 }],
  }), { now });
  assert.equal(model.headline, '先核對報價');
  assert.notEqual(model.headline, '建議減碼檢視');
  assert.equal(light(model, 'quotes').tone, 'red');
  assert.equal(model.reasons.some((item) => item.section === 'sec-quotes'), true);
  assert.match(model.banner.text, /有過期報價/);
  assert.match(model.banner.text, /Asia\/Taipei/);
});

test('a stale quote that is not overweight is only yellow', () => {
  const model = buildToday(book({
    stale: [{ symbol: 'BOND', name: '公司債', price_date: '2026-09-01', limit: 14 }],
  }), { now });
  assert.equal(light(model, 'quotes').tone, 'yellow');
  assert.equal(model.headline, '照定額');
});

test('paper positions are labeled and never change the real verdict', () => {
  const calm = buildToday(book(), { now });
  const mixed = buildToday(book({
    single_stocks: [
      { symbol: '0050', name: '元大台灣50', weight: 0.08, over_limit: false },
      { symbol: '2330', name: '台積電', weight: 0.4, over_limit: true, mode: 'paper' },
    ],
    advice: [{ level: 'warn', title: '紙上減碼', tag: 'concentration', mode: 'paper' }],
    stale: [{ symbol: '2330', name: '台積電', price_date: '2026-08-01', limit: 7, status: 'paper' }],
  }), { now });
  assert.equal(mixed.headline, calm.headline);
  assert.equal(light(mixed, 'single').tone, 'green');
  assert.equal(light(mixed, 'quotes').tone, 'green');
  assert.match(mixed.paper.join('、'), /台積電/);
  assert.match(mixed.paper.join('、'), /紙上減碼/);
  assert.equal(mixed.reasons.some((item) => item.text.includes('台積電')), false);
  assert.match(light(mixed, 'single').lines.join('\n'), /紙上倉 台積電/);
  assert.equal(isPaper({ mode: 'paper' }), true);
  assert.equal(isPaper({ status: 'paper' }), true);
  assert.equal(isPaper({ mode: 'live' }), false);
});

test('an old as_of shows a Taipei banner and a failed read has no actions', () => {
  const stale = buildToday(book({ as_of: '2026-10-14', at: '2026-10-14T01:30:00Z' }), { now });
  assert.equal(stale.banner.kind, 'stale');
  assert.match(stale.banner.text, /資料不是今天/);
  assert.match(stale.banner.text, /2026-10-14 09:30/);
  assert.match(stale.banner.text, /Asia\/Taipei/);

  const failed = buildToday(null, {
    now,
    fetchFailed: true,
    error: Object.assign(new Error('連線失敗'), { payload: {} }),
  });
  assert.equal(failed.headline, '讀不到今日判斷');
  assert.equal(failed.reasons.length, 0);
  assert.equal(failed.banner.kind, 'error');
  assert.match(failed.banner.text, /Asia\/Taipei/);
  assert.equal(failed.displayOnly, true);
});

test('advice cannot pause DCA when the brake says it is clear', () => {
  const model = buildToday(book({
    advice: [{ level: 'warn', title: '暫停定額（現金煞車）', tag: 'dca_pause', body: '現金偏低。' }],
  }), { now });
  assert.equal(model.headline, '照定額');
  assert.equal(light(model, 'cash').tone, 'green');
});

test('each light records the payload fields it reads', () => {
  const model = buildToday(book(), { now });
  assert.deepEqual(model.lights.map((item) => item.id), ['single', 'band', 'cash', 'quotes', 'window']);
  for (const item of model.lights) assert.ok(item.fields.length);
  assert.ok(light(model, 'single').fields.includes('single_name_max'));
  assert.ok(light(model, 'cash').fields.includes('cash_brake.thresholds.cash_pct_total'));
  assert.ok(light(model, 'window').fields.includes('pegatron_pre_earnings'));
});
