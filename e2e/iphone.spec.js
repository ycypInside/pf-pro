import { expect, test } from '@playwright/test';

const token = ['mock', 'ledger', 'token'].join('-');
const apiUrl = 'https://example.com/exec';
const nav = ['總覽', '績效', '配置', '記帳', '明細', '設定'];

const summary = {
  ok: true,
  accounts: [
    { account_id: 'cash', name: '玉山銀行台幣活存', type: 'cash', currency: 'TWD', status: 'active' },
  ],
  balances: [
    {
      account_id: 'cash',
      name: '玉山銀行台幣活存',
      type: 'cash',
      currency: 'TWD',
      status: 'active',
      balance: 12345678.9,
      balance_twd: 12345678.9,
      fx_missing: false,
    },
  ],
  net_worth: {
    net_worth_twd: 98765432.1,
    total_assets_twd: 99000000,
    total_liabilities_twd: 234567.9,
    cash_twd: 12345678.9,
    investments_twd: 86419753.2,
  },
  report: {
    income_twd: 180000,
    expense_twd: 45678.55,
    by_category: { 薪資: 180000, 餐飲外食: -45678.55 },
  },
  warnings: [],
  quotes: [],
  stale: [],
  last_valuations: [],
  holdings: [
    {
      asset_id: '0050',
      name: '元大台灣50',
      symbol: '0050',
      account_id: 'cash',
      quantity: 120.5,
      market_value_twd: 86419753.2,
      last_price: 180.25,
      currency: 'TWD',
    },
  ],
};

const gets = {
  health: { ok: true, schema_version: 3, at: '2026-10-13T16:30:00+08:00' },
  summary,
  accounts: { ok: true, accounts: summary.accounts },
  assets: { ok: true, assets: [] },
  prices: { ok: true, quotes: [], stale: [], last_valuations: [] },
  settings: { ok: true, settings: { categories_expense: ['餐飲', '交通'], categories_income: ['薪資'] } },
  transactions: {
    ok: true,
    transactions: [
      {
        txn_id: 'TX1',
        date: '2026-10-12',
        account_id: 'cash',
        txn_type: 'expense',
        category: '餐飲',
        amount: -186,
        currency: 'TWD',
        amount_twd: -186,
        description: '午餐便當',
        status: 'active',
        flow_class: 'external',
      },
    ],
  },
  trades: { ok: true, trades: [] },
  performance: {
    ok: true,
    method: 'snapshot',
    portfolio: {
      twr: 0.082,
      xirr: 0.061,
      nav: 98765432.1,
      max_drawdown: { value: -0.04, peak_date: '2026-08-01', trough_date: '2026-09-02' },
      pnl: {},
      external: { contribution: 1000000, withdrawal: 0 },
    },
    benchmark: { id: '0050.TW', available: ['0050.TW'], twd_return: 0.11, currency: 'TWD' },
    series: [
      { date: '2026-01-02', index: 1, benchmark_index: 1, drawdown: 0 },
      { date: '2026-10-13', index: 1.08, benchmark_index: 1.11, drawdown: -0.01 },
    ],
    accounts: [],
    holdings: [],
    warnings: [],
  },
  balances: {
    ok: true,
    net_worth: summary.net_worth,
    institutions: [{
      institution: '玉山銀行',
      cash_twd: 12345678.9,
      holdings_twd: 0,
      liabilities_twd: 0,
      total_twd: 12345678.9,
      accounts: ['group', 'cash'],
    }],
    balances: [
      {
        account_id: 'group',
        name: '玉山集團',
        is_group: true,
        total_twd: 0,
        rollup_twd: 12345678.9,
        status: 'active',
      },
      {
        account_id: 'cash',
        name: '玉山銀行台幣活存',
        type: 'bank_cash',
        currency: 'TWD',
        status: 'active',
        institution: '玉山銀行',
        balance_twd: 12345678.9,
        total_twd: 12345678.9,
        holdings_twd: 0,
        is_group: false,
      },
    ],
  },
  holdings: {
    ok: true,
    holdings: [
      ...summary.holdings,
      {
        asset_id: '4938',
        name: '和碩',
        symbol: '4938',
        account_id: 'cash',
        asset_class: 'stock',
        quantity: 10,
        market_value_twd: 1000,
        cost_basis_twd: 800,
        unrealized_pl_twd: 200,
        currency: 'TWD',
        last_price: 100,
      },
    ],
  },
  quotes: {
    ok: true,
    quotes: {
      '0050': { last: 180.25, change_pct: -0.012, spark: [170, 172, 175, 180.25], source: 'stored' },
      4938: { last: 100, change_pct: 0.01, spark: [90, 95, 100], source: 'yahoo' },
    },
  },
  advice: {
    ok: true,
    items: [
      { level: 'warn', title: '雇主持股集中', body: '不要顯示這則。', tag: 'employer' },
      { level: 'info', title: '現金緩衝', body: '可考慮把新收入留在現金。', tag: 'cash' },
    ],
    disclaimer: '以上內容由規則依你的資料與公開市場數據自動產生，只是參考方向，不構成投資建議，也不是買賣指示。',
  },
  market: {
    ok: true,
    sentiment: { heat: 0.62, label: '偏樂觀', inputs: 3 },
    indicators: {
      vix: { value: 16.2, date: '2026-10-13' },
      twii: { value: 22000, ma60: 21000, above_ma60: true, gap_ma60: 0.0476 },
    },
    policy: {
      equity_max: 0.9,
      equity_min: 0.8,
      bond_max: 0.05,
      bond_target: 0.05,
      cash_min: 0.05,
      cash_max: 0.15,
      other: 'hold',
      sentiment_mode: 'defensive_when_hot',
      single_name_max: 0.1,
      employer_max: 0.05,
    },
  },
  chart: {
    ok: true,
    asset_id: '0050',
    symbol: '0050',
    name: '元大台灣50',
    source: 'stored',
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
  },
  allocation: {
    ok: true,
    total_twd: 98765432.1,
    band_pct: 5,
    target_set: true,
    rows: [
      { bucket: 'equity', label: '股票', actual_weight: 0.72, target_weight: 0.6, actual_twd: 71111111, alert: true, drift: 0.12, trade_twd: -11851851.85 },
      { bucket: 'cash', label: '現金', actual_weight: 0.28, target_weight: 0.2, actual_twd: 27654321.1, alert: false, drift: 0.08, trade_twd: 0 },
    ],
    estimated: [],
    missing_fx: [],
    sentiment: { heat: 0.62, label: '偏樂觀', inputs: 3 },
  },
};

let posts = [];
let postBodies = [];

test.beforeEach(async ({ page }) => {
  posts = [];
  postBodies = [];
  await page.route('https://example.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const raw = request.postData() || '{}';
      posts.push(request.url());
      postBodies.push(raw);
      let action = '';
      try {
        action = JSON.parse(raw).action || '';
      } catch {
        action = '';
      }
      if (action === 'add_transaction' && posts.length === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'parse_error', reason: 'lost_body' }),
        });
        return;
      }
      const result = action === 'add_transaction' ? { ids: ['TX9'] } : { ids: [] };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, result }),
      });
      return;
    }
    const url = new URL(request.url());
    const q = url.searchParams.get('q') || '';
    let body = gets[q] || { ok: false, error: 'unknown q' };
    if (q === 'chart' && url.searchParams.get('asset') === '4938') {
      body = { ...gets.chart, asset_id: '4938', symbol: '4938', name: '和碩', source: 'yahoo' };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.addInitScript(({ apiUrl: url, token: secret }) => {
    localStorage.setItem('pfpro.apiUrl', url);
    localStorage.setItem('pfpro.token', secret);
  }, { apiUrl, token });
});

async function fits(page, title) {
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  for (const label of nav) {
    await expect(page.getByRole('link', { name: label })).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const literalNull = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let count = 0;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim() === 'null') count += 1;
    }
    return count;
  });
  expect(literalNull).toBe(0);
}

test('設定 connects and stays inside the iPhone width', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByLabel('API 網址')).toHaveValue(apiUrl);
  await page.getByRole('button', { name: '測試連線' }).click();
  await expect(page.getByText('連線成功')).toBeVisible();
  await expect(page.getByRole('heading', { name: '配置政策' })).toBeVisible();
  await expect(page.getByText('個股上限')).toBeVisible();
  await expect(page.getByText('雇主')).toHaveCount(0);
  await fits(page, '設定');
});

test('總覽 shows net worth and quick entry', async ({ page }) => {
  await page.goto('/#/overview');
  await expect(page.getByText('淨資產 · 台幣')).toBeVisible();
  await expect(page.getByText('NT$98,765,432.10')).toBeVisible();
  await expect(page.getByRole('button', { name: '記支出' })).toBeVisible();
  await expect(page.getByRole('button', { name: '記收入' })).toBeVisible();
  await expect(page.getByRole('button', { name: '轉帳' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI 專家建議' })).toBeVisible();
  await expect(page.getByText('不構成投資建議')).toBeVisible();
  await expect(page.getByText('現金緩衝')).toBeVisible();
  await expect(page.getByText('雇主持股')).toHaveCount(0);
  await expect(page.getByText('和碩')).toBeVisible();
  await expect(page.getByText('玉山集團')).toHaveCount(0);
  await page.getByRole('button', { name: /玉山銀行/ }).click();
  await expect(page.getByRole('article').getByText('玉山銀行台幣活存')).toBeVisible();
  await page.getByRole('button', { name: /元大台灣50/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('價格來源：已儲存淨值')).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Levels' })).toBeVisible();
  await expect(sheet.getByText('目前位於支撐 170.00 與壓力 184.00 之間，站上 MA20')).toBeVisible();
  await expect(sheet.getByText('近期高點，接近時可考慮分批獲利、有效突破則可能轉為支撐')).toBeVisible();
  await expect(sheet.getByText('186.00')).toBeVisible();
  await expect(sheet.getByText('現價')).toBeVisible();
  await expect(sheet.getByText('技術指標僅供參考，不構成投資建議')).toBeVisible();
  const sheetOverflow = await sheet.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(sheetOverflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'K 線' }).click();
  await page.getByRole('button', { name: '關閉' }).click();
  await page.getByRole('button', { name: /和碩/ }).click();
  const pegatron = page.getByRole('dialog');
  await expect(pegatron.getByText('目前位於支撐 170.00 與壓力 184.00 之間，價格高於 MA20')).toBeVisible();
  await expect(pegatron.getByText('獲利')).toHaveCount(0);
  await expect(pegatron.getByText('停損')).toHaveCount(0);
  await expect(pegatron.getByText('布局')).toHaveCount(0);
  await expect(pegatron.getByText('null', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await fits(page, '總覽');
});

test('記帳 posts the token on the query string', async ({ page }) => {
  await page.goto('/#/entry');
  await expect(page.getByRole('tab', { name: '收支' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '轉帳' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '投資' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '報價' })).toBeVisible();
  await page.locator('select[name="account_id"]:visible').selectOption('cash');
  await page.locator('input[name="amount"]:visible').fill('186');
  await page.getByRole('button', { name: '入帳' }).click();
  await expect(page.getByText('已寫入')).toBeVisible();
  expect(posts.length).toBe(2);
  for (const href of posts) {
    const posted = new URL(href);
    expect(posted.searchParams.get('token')).toBe(token);
    expect(posted.searchParams.get('m')).toBe('post');
  }
  const ids = postBodies.map((raw) => JSON.parse(raw).request_id);
  expect(ids[0]).toBeTruthy();
  expect(ids[1]).toBe(ids[0]);
  await fits(page, '記帳');
});

test('明細 lists a recent transaction', async ({ page }) => {
  await page.goto('/#/records');
  await expect(page.getByText('午餐便當')).toBeVisible();
  await expect(page.getByRole('button', { name: '作廢', exact: true })).toBeVisible();
  await fits(page, '明細');
});

test('績效 draws the chart', async ({ page }) => {
  await page.goto('/#/performance');
  await expect(page.getByText('時間加權', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '淨值指數與指標' })).toBeVisible();
  await fits(page, '績效');
});

test('配置 shows weights', async ({ page }) => {
  await page.goto('/#/allocation');
  await expect(page.getByText('可投資資產 · 台幣')).toBeVisible();
  await expect(page.getByText('股票', { exact: true })).toBeVisible();
  await expect(page.getByText('再平衡')).toBeVisible();
  await expect(page.getByText('偏樂觀')).toBeVisible();
  await expect(page.getByText(/VIX 16\.2/)).toBeVisible();
  await expect(page.getByText(/可考慮減少/)).toBeVisible();
  await expect(page.getByText('不構成投資建議')).toBeVisible();
  await expect(page.getByText('雇主持股')).toHaveCount(0);
  await fits(page, '配置');
});
