import { expect, test } from '@playwright/test';

const token = ['mock', 'ledger', 'token'].join('-');
const apiUrl = 'https://example.com/exec';
const nav = ['總覽', '計畫', '持股卡', '紙上倉', '績效', '配置', '基金成分', '個股分析', '記帳', '明細', '設定'];

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
  settings: {
    ok: true,
    settings: {
      categories_expense: ['餐飲', '交通'],
      categories_income: ['薪資'],
      stale_days_overrides: { 'SI-145': 14, 'nav:USD': 21 },
    },
  },
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
      4938: {
        last: 100,
        change_pct: 0.01,
        spark: [90, 95, 100],
        source: 'yahoo',
        is_stale: true,
        price_date: '2026-08-01',
        stale_limit_days: 7,
      },
    },
  },
  advice: {
    ok: true,
    items: [
      { level: 'warn', title: '雇主持股集中', body: '不要顯示這則。', tag: 'employer' },
      { level: 'info', title: '現金緩衝', body: '可考慮把新收入留在現金。', tag: 'cash' },
      { level: 'info', title: '價格過期', body: '請補上最新報價。', tag: 'stale' },
      { level: 'info', title: '暫停定額', body: '現金偏低。', tag: 'dca_pause' },
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
      dca_exempt_enabled: true,
      dca_core_assets: ['0050', 'VOO'],
      dca_pause: { enabled: true, cash_pct_total: 0.08, net_cash_pct_nw: 0.02 },
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
  plan: {
    ok: true,
    as_of: '2026-10-14',
    net_worth_twd: 98765432.1,
    path_d: {
      start_twd: 14020000,
      start_date: '2026-09-16',
      year1_target_twd: 16540000,
      year1_date: '2027-09-16',
      actual_twd: 15000000,
      progress_pct: (15000000 - 14020000) / (16540000 - 14020000),
      remaining_twd: 1540000,
    },
    nw_day_change: {
      change_twd: -12345.6,
      change_pct: -0.000125,
      date: '2026-10-14',
      prev_date: '2026-10-13',
    },
    note: '計畫值以基期淨值、月投入與年化報酬（月複利）推算；實際值為目前淨值（含非計畫內資產）。',
    tracks: [
      {
        track: 'D',
        label: '路徑 D',
        baseline_date: '2026-01-01',
        baseline_twd: 14020000,
        monthly_twd: 80000,
        cagr: 0.08,
        milestones: [{ year: 1, target_date: '2027-01-01', target_twd: 16540000, note: '第一年' }],
        plan_now_twd: 14800000,
        actual_twd: 98765432.1,
        gap_twd: 83965432.1,
        gap_pct: 5.67,
        next_milestone: { year: 1, target_date: '2027-01-01', target_twd: 16540000, note: '第一年' },
        on_track: true,
      },
      {
        track: 'main',
        label: '主計畫',
        baseline_date: '2024-01-01',
        baseline_twd: 50000000,
        monthly_twd: 150000,
        cagr: 0.07,
        milestones: [{ year: 2028, target_date: '2028-01-01', target_twd: 80000000, note: '第一個目標' }],
        plan_now_twd: 70000000,
        actual_twd: 98765432.1,
        gap_twd: 28765432.1,
        gap_pct: 0.41,
        next_milestone: { year: 2028, target_date: '2028-01-01', target_twd: 80000000, note: '第一個目標' },
        on_track: true,
      },
      {
        track: '挑戰上億',
        label: '挑戰上億',
        baseline_date: '2024-01-01',
        baseline_twd: 50000000,
        monthly_twd: 300000,
        cagr: 0.1,
        milestones: [{ year: 2030, target_date: '2030-01-01', target_twd: 100000000, note: '上億' }],
        plan_now_twd: 110000000,
        actual_twd: 98765432.1,
        gap_twd: -11234567.9,
        gap_pct: -0.102,
        next_milestone: { year: 2030, target_date: '2030-01-01', target_twd: 100000000, note: '上億' },
        on_track: false,
      },
    ],
  },
  dca: {
    ok: true,
    month: '2026-10',
    monthly_total_twd: 40000,
    brake: { enabled: true, triggered: true, reason: '現金佔比低於煞車門檻' },
    note: '本月狀態依 last_debit_date 判斷。',
    items: [
      { dca_id: 'dca-0050', name: '元大台灣50', symbol: '0050', currency: 'TWD', amount: 10000, debit_day: null, month_state: 'pending', core: true, note: '每月上限 1 萬；每月一次', status: 'active' },
      { dca_id: 'dca-voo', name: 'VOO', symbol: 'VOO', currency: 'USD', amount: 200, debit_day: 6, month_state: 'debited', core: true, note: '每月上限 200 美元；每月一次', status: 'active', last_debit_date: '2026-10-06' },
      { dca_id: 'dca-00646', name: '元大S&P500', symbol: '00646', currency: 'TWD', amount: 8000, debit_day: 15, month_state: 'paused_by_brake', core: true, note: '每月上限 8,000；每月一次', status: 'active' },
      { dca_id: 'dca-bond', name: '美債基金', symbol: 'BND', currency: 'TWD', amount: 5000, debit_day: '', month_state: 'pending', core: true, note: '每月上限 5,000；每季', status: 'active' },
    ],
  },
  alerts: {
    ok: true,
    disclaimer: '依持股卡規則與公開價格自動比對；僅為檢討提醒，不是操作單。',
    alerts: [
      { level: 'red', type: 'close_below', name: '元大台灣50', card_key: 'tw', action: '檢視部位', reason: '收盤低於規則線', detail: '收盤 180 / 線 190，連續 1/3 日', trigger_basis: 'close', close_date: '2026-10-13', close_price: 180 },
      { level: 'amber', name: '和碩', action: '只做紀錄', reason: '接近財報', detail: '觀察中' },
      { level: 'amber', type: 'trade_ticket', name: '賣出單', action: '確認交易單', reason: '還沒送出', detail: '1 筆' },
      { level: 'watch', name: '元大台灣50', card_key: 'tw', action: '再看一天', reason: '尚未連續確認', detail: '連續 1/3 日' },
      { level: 'upcoming', name: '和碩', action: '日期將到', reason: '規則日期接近', detail: '2026-10-20' },
      { level: 'info', name: '元大台灣50', action: '例行檢視', reason: '資訊型規則', detail: '提示用' },
    ],
  },
  holding_cards: {
    ok: true,
    cards: [
      {
        card_key: 'tw',
        name: '台灣50卡',
        asset_ids: ['0050'],
        status: 'active',
        trigger_basis: 'close',
        close_date: '2026-10-13',
        note: '核心部位',
        rules: [
          { rule_key: 'r1', type: 'close_below', level: 175, confirm_days: 3, action: '回到這條線時檢視部位', reason: '收盤低於規則價', status: 'active' },
          { rule_key: 'r2', type: 'date_reached', date: '2026-11-15', action: '論點檢討', reason: '到日回頭看論點', status: 'active' },
        ],
      },
      {
        card_key: 'peg',
        name: '和碩卡',
        asset_ids: ['4938'],
        status: 'active',
        note: '',
        rules: [{ rule_key: 'r2', type: 'close_below', level: 90, action: '只記錄價位', reason: '接近財報前只做紀錄', status: 'active' }],
      },
    ],
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
  decisions: {
    ok: true,
    count: 3,
    items: [
      { kind: 'exit_line', level: 'red', title: '元大台灣50：檢視部位', detail: '收盤低於規則線', ref: 'r1' },
      { kind: 'dca_paused', level: 'amber', title: '現金煞車：暫停定額', detail: '現金佔比低於煞車門檻', ref: 'dca-00646' },
      { kind: 'stale_quote', level: 'info', title: '和碩 報價過期', detail: '報價日 2026-08-01，上限 7 天', ref: '4938' },
    ],
    exit_lines: [],
    dca_paused: true,
    dca_paused_items: [],
    cash_brake: { enabled: true, triggered: true, reason: '現金佔比低於煞車門檻' },
    stale_quotes: [],
    trade_tickets: [],
    nw_day_change: {
      change_twd: -12345.6,
      change_pct: -0.000125,
      date: '2026-10-14',
      prev_date: '2026-10-13',
    },
    disclaimer: '待決事項僅為提醒，不是操作單。',
  },
  paper: {
    ok: true,
    mode: 'paper',
    is_stale: true,
    stale: '紙上倉報價已過期',
    note: '模擬倉，與實際持倉完全分開，不計入淨值與配置。年化以 252 交易日換算，交易日不足 20 日時僅供參考。',
    sleeves: [
      {
        sleeve: 'A',
        label: '紙上倉 A',
        status: 'paper',
        as_of: '2026-10-13',
        capital_twd: 1000000,
        equity_twd: 1050000,
        cash_twd: 200000,
        cash_pct: 19.05,
        return_pct: 5,
        drawdown_pct: -1.2,
        max_dd_pct: -3.4,
        trading_days: 12,
        trading_days_required: 20,
        trading_days_label: '12/20',
        annualized_pct: 18.2,
        annualized_target_pct: 21.71,
        annualized_ok: false,
        vs_0050_pp: 1.5,
        vs_00631L_pp: -0.4,
        n_positions: 1,
        positions: [{
          code: '2330',
          name: '台積電',
          industry: '半導體',
          qty: 10,
          entry: 900,
          last: 950,
          pnl_pct: 5.56,
          mv: 9500,
          stop_price: 850,
          take_profit_price: 1100,
          held_trading_days: 8,
          in_disposition: false,
        }],
        flags: [],
        gate: {
          target: 21.71,
          min_trading_days: 20,
          checks: [
            { label: '交易日', current: '12/20', ok: false },
            { label: '年化', current: '18.20%', ok: true },
          ],
          go_live_allowed: false,
        },
        series: [
          { date: '2026-10-01', return_pct: 0, equity_twd: 1000000, drawdown_pct: 0 },
          { date: '2026-10-13', return_pct: 5, equity_twd: 1050000, drawdown_pct: -1.2 },
        ],
      },
    ],
    benchmarks: {
      50: {
        symbol: '50',
        as_of: '2026-10-13',
        return_pct: 3.5,
        max_dd_pct: -4,
        series: [
          { date: '2026-10-01', return_pct: 0 },
          { date: '2026-10-13', return_pct: 3.5 },
        ],
      },
      '00631L': {
        symbol: '00631L',
        as_of: '2026-10-13',
        return_pct: 5.4,
        max_dd_pct: -6,
        series: [
          { date: '2026-10-01', return_pct: 0 },
          { date: '2026-10-13', return_pct: 5.4 },
        ],
      },
    },
  },
  fund_composition: {
    ok: true,
    as_of: '2026-10-14',
    file_date: '2026-10-01',
    source_note: '公開月報',
    portfolio_value_twd: 1000000,
    funds: [
      {
        fund_id: 'f1',
        asset_id: '0050',
        asset_ids: ['0050'],
        symbol: '0050',
        name: '台灣50',
        fund_type: 'etf',
        currency: 'TWD',
        data_date: '2026-09-30',
        file_date: '2026-10-01',
        held_value_twd: 250000,
        top10: [
          { rank: 1, name: '台積電', symbol: '2330', weight_pct: 40.5, sector: '半導體', region: '台灣' },
          { rank: 2, name: '聯發科', symbol: '2454', weight_pct: 5, sector: '半導體', region: '台灣' },
        ],
        sectors: [{ name: '半導體', weight_pct: 60 }],
        sectors_date: '2026-09-30',
        regions: [],
        regions_date: '',
        overlap: [{ asset_id: '2330', symbol: '2330', name: '台積電', holding_name: '台積電', fund_weight_pct: 40.5, direct_value_twd: 100000, via_fund_twd: 100000 }],
        overlap_weight_pct: 40.5,
        source: 'https://example.com/fund-note',
        updated_at: '2026-10-01',
      },
      {
        fund_id: 'f2',
        asset_id: 'bond',
        asset_ids: ['bond'],
        symbol: 'BOND',
        name: '全球債券',
        fund_type: 'fund',
        currency: 'TWD',
        data_date: '2026-08-31',
        file_date: '2026-10-01',
        held_value_twd: null,
        top10: [],
        sectors: [],
        sectors_date: '',
        regions: [{ name: '美國', weight_pct: 80 }],
        regions_date: '2026-08-31',
        overlap: [],
        overlap_weight_pct: 0,
        updated_at: '2026-10-01',
      },
    ],
    lookthrough: [{
      asset_id: '2330',
      symbol: '2330',
      name: '台積電',
      direct_value_twd: 100000,
      via_funds_twd: 80000,
      total_twd: 180000,
      funds: [{ fund_id: 'f1', fund_name: '台灣50', fund_weight_pct: 40.5, via_fund_twd: 80000 }],
    }],
    cross_fund: [{
      name: '台積電',
      funds: [
        { fund_id: 'f1', fund_name: '台灣50', weight_pct: 40.5 },
        { fund_id: 'f2', fund_name: '全球債券', weight_pct: 1 },
      ],
    }],
  },
  stock_rotation: {
    ok: true,
    as_of: '2026-10-14',
    file_date: '2026-10-12',
    cadence: '每週一檔',
    rotation: [
      { seq: 1, week_start: '2026-10-06', week_end: '2026-10-12', market: 'TW', symbol: '2330', name: '台積電', asset_id: '2330', status: 'done', is_current: false, note: '已結束', report_date: '2026-10-10', latest_report_date: '2026-10-10', has_report: true, extra: { report_path: '', extra_reports: [] } },
      { seq: 2, week_start: '2026-10-13', week_end: '2026-10-19', market: 'US', symbol: 'AAPL', name: '蘋果', asset_id: 'AAPL', status: 'current', is_current: true, note: '本週', report_date: '', latest_report_date: '', has_report: false, extra: { report_path: '', extra_reports: [] } },
    ],
    reports: [{ symbol: '2330', report_date: '2026-10-10', title: '台積電週報', chars: 12000, in_rotation: true }],
  },
  stock_report: {
    ok: true,
    symbol: '2330',
    report_date: '2026-10-10',
    title: '台積電週報',
    md: '# 台積電週報\n\n<script>alert(1)</script>\n\n<style>body{color:red}</style>\n\n<iframe src="https://example.com/frame"></iframe>\n\n<p onclick="alert(1)">段落</p>\n\n[壞](javascript:alert(1))\n\n[好](https://example.com/note)\n\n| 欄 | 值 |\n| --- | --- |\n| 甲 | 乙 |\n',
    complete: false,
    chars: 8000,
    updated_at: '2026-10-10',
    history_dates: ['2026-10-03', '2026-10-10'],
  },
};

let posts = [];
let postBodies = [];
let reads = [];

test.beforeEach(async ({ page }) => {
  posts = [];
  postBodies = [];
  reads = [];
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
    reads.push(`${q}:${url.searchParams.get('parts') || ''}:${url.searchParams.get('symbol') || ''}`);
    let body = gets[q] || { ok: false, error: 'unknown q' };
    if (q === 'stock_report' && url.searchParams.get('symbol') === 'AAPL') {
      body = { ok: false, error: 'no report', symbol: 'AAPL' };
    }
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
  await expect(page.getByText('定額豁免')).toBeVisible();
  await expect(page.getByText('0050、VOO')).toBeVisible();
  await expect(page.getByText('過期天數覆寫')).toBeVisible();
  await expect(page.getByText('SI-145：14 天、nav:USD：21 天')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: '待您決定' })).toBeVisible();
  await expect(page.locator('.decision-exit_line')).toContainText('元大台灣50：檢視部位');
  await expect(page.locator('.decision-dca_paused')).toContainText('現金煞車：暫停定額');
  await expect(page.locator('.decision-stale_quote')).toContainText('和碩 報價過期');
  await expect(page.getByText('今天無事')).toHaveCount(0);
  await expect(page.locator('section', { has: page.getByRole('heading', { name: '待您決定' }) })).toContainText('不是操作單');
  await expect(page.getByText('較前一日 −NT$12,345.60（−0.01%） 2026-10-13 → 2026-10-14')).toBeVisible();
  await expect(page.getByText('路徑 D 1,402萬 → 第一年 1,654萬')).toBeVisible();
  await expect(page.getByText('完成 39%')).toBeVisible();
  await expect(page.getByRole('heading', { name: '檢討提醒' })).toBeVisible();
  await expect(page.getByText('不是操作單')).toHaveCount(2);
  await expect(page.locator('article.alert-red')).toContainText('檢視部位');
  await expect(page.locator('article.alert-red')).toContainText('以 2026-10-13 收盤判定');
  await expect(page.locator('article.alert-amber', { hasText: '只做紀錄' })).toBeVisible();
  await expect(page.locator('article.alert-watch')).toContainText('再看一天');
  await expect(page.locator('article.alert-upcoming')).toContainText('日期將到');
  await expect(page.locator('article.alert-info')).toContainText('例行檢視');
  await expect(page.getByText('現金緩衝')).toBeVisible();
  await expect(page.locator('.banner.err', { hasText: '價格過期' })).toBeVisible();
  await expect(page.locator('.banner.err', { hasText: '暫停定額' })).toBeVisible();
  await expect(page.getByRole('button', { name: /和碩/ }).getByText('過期', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /和碩/ }).getByText('價格 2026-08-01 · 上限 7 天')).toBeVisible();
  await expect(page.getByRole('button', { name: /元大台灣50/ }).getByText('過期', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /元大台灣50/ }).locator('.estimate')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /和碩/ }).locator('.estimate').first()).toContainText('估');
  await expect(page.getByText('雇主持股')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /和碩/ })).toBeVisible();
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
  await expect(sheet.getByRole('heading', { name: '持股卡' })).toBeVisible();
  await expect(sheet.getByText('回到這條線時檢視部位')).toBeVisible();
  await expect(sheet.getByText('規則價位')).toBeVisible();
  await expect(sheet.getByText('不是操作單')).toBeVisible();
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
  await expect(pegatron.getByText('只記錄價位')).toBeVisible();
  await expect(pegatron.getByText('不是操作單')).toBeVisible();
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

test('計畫 shows both tracks, gaps, and the DCA card', async ({ page }) => {
  await page.goto('/#/plan');
  await expect(page.getByRole('img', { name: '計畫與實際淨值' })).toBeVisible();
  await expect(page.getByText(/路徑 D 自 1,402萬/)).toBeVisible();
  await expect(page.getByText(/上億差距/)).toBeVisible();
  await expect(page.getByText('本月定額：已扣款 1、待扣款 2、煞車暫停 1')).toBeVisible();
  await expect(page.locator('.acct-name', { hasText: '主計畫' })).toBeVisible();
  await expect(page.locator('.acct-name', { hasText: '挑戰上億' })).toBeVisible();
  await expect(page.getByText('第一個目標')).toBeVisible();
  await expect(page.getByText('NT$100,000,000.00')).toBeVisible();
  await expect(page.getByText('實際', { exact: true })).toBeVisible();
  await expect(page.getByText('現金佔比低於煞車門檻')).toBeVisible();
  await expect(page.getByText('待補')).toHaveCount(2);
  await expect(page.getByText('每月 6 日')).toBeVisible();
  await expect(page.getByText('每月上限 1 萬；每月一次')).toBeVisible();
  await expect(page.getByText('每月上限 200 美元；每月一次')).toBeVisible();
  await expect(page.getByText('每月上限 8,000；每月一次')).toBeVisible();
  await expect(page.getByText('每月上限 5,000；每季')).toBeVisible();
  await expect(page.getByText('煞車暫停', { exact: true })).toBeVisible();
  const pending = page.locator('.dca-item').filter({ hasText: '每月上限 1 萬' });
  await pending.getByRole('button', { name: '標記已扣款' }).click();
  await expect(pending.getByText('已扣款')).toBeVisible();
  await expect(page.getByText('已寫入')).toBeVisible();
  const posted = JSON.parse(postBodies.at(-1));
  expect(posted.action).toBe('mark_dca_debited');
  expect(posted.data).toEqual({ dca_id: 'dca-0050', date: posted.data.date });
  expect(posted.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const href = new URL(posts.at(-1));
  expect(href.searchParams.get('token')).toBe(token);
  expect(href.searchParams.get('m')).toBe('post');
  await fits(page, '計畫');
});

test('nav matches the column at 1280 and 375', async ({ page }) => {
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/#/overview');
    await expect(page.getByRole('heading', { level: 1, name: '總覽' })).toBeVisible();
    const box = await page.evaluate(async (labels) => {
      const app = document.querySelector('.app').getBoundingClientRect();
      const nav = document.querySelector('.nav');
      const navBox = nav.getBoundingClientRect();
      const reached = [];
      for (const label of labels) {
        const link = [...nav.querySelectorAll('a')].find((node) => node.textContent.includes(label));
        link.scrollIntoView({ inline: 'center', block: 'nearest' });
        const linkBox = link.getBoundingClientRect();
        const now = nav.getBoundingClientRect();
        reached.push(linkBox.width > 8 && linkBox.left >= now.left - 1 && linkBox.right <= now.right + 1);
      }
      return {
        appWidth: app.width,
        navWidth: navBox.width,
        appLeft: app.left,
        navLeft: navBox.left,
        navBottom: nav.getBoundingClientRect().bottom,
        innerHeight: window.innerHeight,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        reached,
        sameRow: new Set([...nav.querySelectorAll('a')].map((node) => node.offsetTop)).size === 1,
        wrap: getComputedStyle(nav).flexWrap,
      };
    }, nav);
    expect(box.sameRow).toBe(true);
    expect(box.wrap).toBe('nowrap');
    expect(Math.abs(box.navWidth - box.appWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.navLeft - box.appLeft)).toBeLessThanOrEqual(1);
    expect(box.navBottom).toBeGreaterThan(box.innerHeight * 0.85);
    expect(box.pageOverflow).toBeLessThanOrEqual(1);
    expect(box.reached.every(Boolean)).toBe(true);
  }
});

test('持股卡 shows price, exit distance, day count, and thesis date', async ({ page }) => {
  await page.goto('/#/cards');
  await expect(page.locator('.acct-name', { hasText: '台灣50卡' })).toBeVisible();
  await expect(page.getByText('180.25 TWD').first()).toBeVisible();
  await expect(page.getByText('出場線 175.00 TWD')).toBeVisible();
  await expect(page.getByText('第 1/3 日')).toBeVisible();
  await expect(page.getByText('論點檢討 2026-11-15')).toBeVisible();
  await expect(page.getByText('以 2026-10-13 收盤判定')).toBeVisible();
  await expect(page.getByText('不是操作單')).toBeVisible();
  const pegatron = page.locator('article').filter({ hasText: '和碩卡' });
  await expect(pegatron.locator('.estimate')).toContainText('估');
  await fits(page, '持股卡');
});

test('待您決定 shows 今天無事 when the count is zero', async ({ page }) => {
  const saved = gets.decisions;
  gets.decisions = {
    ok: true,
    count: 0,
    items: [],
    trade_tickets: [],
    nw_day_change: { change_twd: null, change_pct: null, date: '2026-10-14', prev_date: null },
    disclaimer: '待決事項僅為提醒，不是操作單。',
  };
  try {
    await page.goto('/#/overview');
    await expect(page.getByText('今天無事')).toBeVisible();
    await expect(page.getByText('不是操作單').first()).toBeVisible();
    await expect(page.getByText('較前一日 —（—）')).toBeVisible();
  } finally {
    gets.decisions = saved;
  }
});

test('紙上倉 stays separate from real holdings', async ({ page }) => {
  await page.goto('/#/paper');
  await expect(page.getByText('這是紙上倉，不是真實持倉')).toBeVisible();
  await expect(page.getByText('估 紙上倉報價已過期')).toBeVisible();
  await expect(page.locator('.paper-metrics .estimate').first()).toContainText('估');
  await expect(page.locator('.paper-compare .legend')).toContainText('估 0050');
  await expect(page.getByText('不計入淨值與配置').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '紙上倉 A' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '紙上倉 B' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '紙上倉 C' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '對照 0050、00631L' })).toBeVisible();
  await expect(page.getByRole('img', { name: '紙上倉與 0050、00631L' })).toBeVisible();
  await expect(page.locator('.paper-compare .legend')).toContainText('0050');
  await expect(page.locator('.paper-compare .legend')).toContainText('00631L');
  await expect(page.getByText('✗ 還不能上線')).toBeVisible();
  await expect(page.getByText('✗ 交易日 12/20')).toBeVisible();
  await expect(page.getByText('✓ 年化 18.20%')).toBeVisible();
  await expect(page.getByText('尚無紙上部位').first()).toBeVisible();
  await page.getByText('部位 1').click();
  await expect(page.getByText('2330 台積電')).toBeVisible();
  await expect(page.getByText('元大台灣50')).toHaveCount(0);
  await expect(page.getByText('NT$98,765,432.10')).toHaveCount(0);
  await fits(page, '紙上倉');
});

test('基金成分 shows holdings, overlap, and shared names', async ({ page }) => {
  await page.goto('/#/funds');
  await expect(page.getByText('檔案日 2026-10-01 · 公開月報')).toBeVisible();
  await expect(page.getByText('台灣50').first()).toBeVisible();
  await expect(page.getByText('ETF', { exact: true })).toBeVisible();
  await expect(page.getByText('持有 NT$250,000.00')).toBeVisible();
  await expect(page.getByText('資料日 2026-09-30 · 產業日 2026-09-30')).toBeVisible();
  const tsmc = page.locator('.weight-row', { hasText: '台積電' }).first();
  await expect(tsmc).toContainText('直接持有');
  await expect(tsmc).toContainText('40.50%');
  await expect(page.locator('.weight-row', { hasText: '聯發科' })).not.toContainText('直接持有');
  await expect(page.getByRole('heading', { name: '產業' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '地區' })).toHaveCount(0);
  await page.locator('summary', { hasText: '全球債券' }).click();
  await expect(page.getByText('基金', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('持有 —')).toBeVisible();
  await expect(page.getByRole('heading', { name: '地區' })).toBeVisible();
  await expect(page.getByText('美國')).toBeVisible();
  const source = page.getByRole('link', { name: '資料來源' });
  await expect(source).toHaveAttribute('href', 'https://example.com/fund-note');
  await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByText('https://example.com/fund-note')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '重疊曝險' })).toBeVisible();
  await expect(page.getByText('估算（僅前十大）')).toBeVisible();
  await expect(page.getByText('直接 NT$100,000.00 + 透過基金 NT$80,000.00 = NT$180,000.00')).toBeVisible();
  await expect(page.getByRole('heading', { name: '多檔基金共同持有' })).toBeVisible();
  await expect(page.getByText('僅供研究參考，非交易建議；和碩僅使用公開資料。')).toBeVisible();
  expect(reads.some((item) => item.startsWith('bundle:fund_composition'))).toBe(true);
  await fits(page, '基金成分');
});

test('個股分析 loads a sanitized report', async ({ page }) => {
  await page.goto('/#/rotation');
  await expect(page.getByText('每週一檔')).toBeVisible();
  await expect(page.locator('tr.rotation-current')).toContainText('AAPL');
  await expect(page.locator('tr.rotation-current')).toContainText('尚無報告');
  await expect(page.locator('tr', { hasText: '2330' })).toContainText('2026-10-06–2026-10-12');
  await expect(page.locator('tr', { hasText: '2330' })).toContainText('TW');
  await page.locator('tr[data-symbol="2330"]').click();
  await expect(page.locator('.report-pane h2', { hasText: '台積電週報' })).toBeVisible();
  await expect(page.locator('.report-pane')).toContainText('2026-10-10');
  await expect(page.locator('.report-pane')).toContainText('報告不完整');
  await expect(page.locator('.report-pane')).toContainText('歷史 2026-10-03、2026-10-10');
  await expect(page.locator('.md script, .md iframe, .md style, .md [onclick]')).toHaveCount(0);
  const link = page.locator('.md a[href="https://example.com/note"]');
  await expect(link).toHaveAttribute('href', 'https://example.com/note');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('.md a[href^="javascript:"]')).toHaveCount(0);
  const overflow = await page.locator('.md .md-table').evaluate((node) => getComputedStyle(node).overflowX);
  expect(['auto', 'scroll']).toContain(overflow);
  await page.getByRole('button', { name: '台積電週報 2026-10-10' }).click();
  await expect(page.locator('.report-pane h2', { hasText: '台積電週報' })).toBeVisible();
  await page.locator('tr[data-symbol="AAPL"]').click();
  await expect(page.locator('.report-pane')).toContainText('尚無報告');
  await expect(page.getByText('僅供研究參考，非交易建議；和碩僅使用公開資料。')).toBeVisible();
  expect(reads.some((item) => item.startsWith('bundle:stock_rotation'))).toBe(true);
  expect(reads.some((item) => item.startsWith('stock_report::2330'))).toBe(true);
  await fits(page, '個股分析');
});
