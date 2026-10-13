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
    const q = new URL(request.url()).searchParams.get('q') || '';
    const body = gets[q] || { ok: false, error: 'unknown q' };
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
  await fits(page, '設定');
});

test('總覽 shows net worth and quick entry', async ({ page }) => {
  await page.goto('/#/overview');
  await expect(page.getByText('淨資產 · 台幣')).toBeVisible();
  await expect(page.getByText('NT$98,765,432.10')).toBeVisible();
  await expect(page.getByRole('button', { name: '記支出' })).toBeVisible();
  await expect(page.getByRole('button', { name: '記收入' })).toBeVisible();
  await expect(page.getByRole('button', { name: '轉帳' })).toBeVisible();
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
  await fits(page, '配置');
});
