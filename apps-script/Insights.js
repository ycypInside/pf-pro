/**
 * v0.2 insights: bank roll-up, market sentiment, dynamic target, quotes/charts, advice.
 * Public data only (Yahoo Finance chart API). Not financial advice.
 */
var PF_EMPLOYER_SYMBOL = '4938';
var PF_DEFAULT_POLICY = {
  equity_max: 0.90, equity_min: 0.80, bond_max: 0.05, bond_target: 0.05,
  cash_min: 0.05, cash_max: 0.15, other: 'hold',
  sentiment_mode: 'defensive_when_hot', single_name_max: 0.10,
  fixed_target: { stock: 0.90, bond: 0.05, cash: 0.05 },
  dca_exempt_enabled: false, dca_core_assets: [],
  dca_pause: { enabled: false, cash_pct_total: 0.08, net_cash_pct_nw: 0.02 }
};

function targetPolicy_() {
  var s = settings_();
  var p = {};
  Object.keys(PF_DEFAULT_POLICY).forEach(function (k) { p[k] = PF_DEFAULT_POLICY[k]; });
  if (s.target_policy) {
    try {
      var parsed = typeof s.target_policy === 'string' ? JSON.parse(s.target_policy) : s.target_policy;
      Object.keys(parsed || {}).forEach(function (k) { p[k] = parsed[k]; });
      if (parsed && parsed.dca_pause) {
        var dp = {}; Object.keys(PF_DEFAULT_POLICY.dca_pause).forEach(function (k) { dp[k] = PF_DEFAULT_POLICY.dca_pause[k]; });
        Object.keys(parsed.dca_pause).forEach(function (k) { dp[k] = parsed.dca_pause[k]; });
        p.dca_pause = dp;
      }
    } catch (e) { /* defaults */ }
  }
  return p;
}

/** Equity target slides from equity_max (calm/fear) to equity_min (overheated). Cash absorbs the rest. */
function dynamicTarget_(policy, sentiment, otherWeight) {
  if (policy.sentiment_mode === 'off') {
    var ft = policy.fixed_target || PF_DEFAULT_POLICY.fixed_target;
    var oth = policy.other === 'hold' ? (otherWeight || 0) : 0;
    var t0 = { stock: pfRound6(Math.max(0, Number(ft.stock || 0) - oth)), bond: pfRound6(Number(ft.bond || 0)), cash: pfRound6(Number(ft.cash || 0)) };
    if (oth) t0.other = pfRound6(oth);
    return t0;
  }
  var heat = sentiment && isFinite(sentiment.heat) ? sentiment.heat : 0.5; // 0 fear .. 1 overheated
  if (policy.sentiment_mode === 'aggressive_when_hot') heat = 1 - heat;
  var other = policy.other === 'hold' ? (otherWeight || 0) : 0;
  var eq = policy.equity_max - (policy.equity_max - policy.equity_min) * heat;
  var bond = Math.min(policy.bond_target, policy.bond_max);
  var cash = 1 - eq - bond - other;
  if (cash < policy.cash_min) { eq -= (policy.cash_min - cash); cash = policy.cash_min; }
  if (cash > policy.cash_max) { eq += (cash - policy.cash_max); cash = policy.cash_max; eq = Math.min(eq, policy.equity_max); }
  var t = { stock: pfRound6(eq), bond: pfRound6(bond), cash: pfRound6(cash) };
  if (other) t.other = pfRound6(other);
  return t;
}

// ---------- Yahoo ----------
function yahooSymbol_(asset) {
  var sym = String(asset.symbol || '').trim();
  var cls = asset.asset_class;
  if (!sym || cls === 'fund' || cls === 'bond' || cls === 'other') return '';
  if (asset.currency === 'TWD') {
    if (/^\d{2,3}$/.test(sym)) sym = '00' + sym;
    return sym + '.TW';
  }
  if (asset.currency === 'USD') return sym;
  return '';
}

function yahooChartUrl_(sym, range) {
  return 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1d&range=' + (range || '1y');
}

function parseYahoo_(text) {
  try {
    var r = JSON.parse(text).chart.result[0];
    var q = r.indicators.quote[0];
    var out = [];
    (r.timestamp || []).forEach(function (ts, i) {
      if (q.close[i] == null) return;
      out.push({ d: Utilities.formatDate(new Date(ts * 1000), r.meta.exchangeTimezoneName || 'UTC', 'yyyy-MM-dd'),
        o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] });
    });
    return out;
  } catch (e) { return null; }
}

/** Fetch many daily series in parallel; 1h script cache per symbol+range. Retries .TW -> .TWO. */
function yahooSeriesMany_(syms, range) {
  var cache = CacheService.getScriptCache();
  var out = {}, need = [];
  syms.forEach(function (s) {
    var hit = null;
    try { hit = cache.get('pf:y:' + range + ':' + s); } catch (e) {}
    if (hit) out[s] = JSON.parse(hit); else need.push(s);
  });
  if (!need.length) return out;
  var reqs = need.map(function (s) { return { url: yahooChartUrl_(s, range), muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }; });
  var res = [];
  try { res = UrlFetchApp.fetchAll(reqs); } catch (e) { res = []; }
  var retry = [];
  need.forEach(function (s, i) {
    var rows = res[i] && res[i].getResponseCode() === 200 ? parseYahoo_(res[i].getContentText()) : null;
    if (rows && rows.length) out[s] = rows;
    else if (/\.TW$/.test(s)) retry.push(s);
  });
  if (retry.length) {
    var r2 = [];
    try { r2 = UrlFetchApp.fetchAll(retry.map(function (s) { return { url: yahooChartUrl_(s + 'O', range), muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }; })); } catch (e) {}
    retry.forEach(function (s, i) {
      var rows = r2[i] && r2[i].getResponseCode() === 200 ? parseYahoo_(r2[i].getContentText()) : null;
      if (rows && rows.length) out[s] = rows;
    });
  }
  Object.keys(out).forEach(function (s) {
    if (need.indexOf(s) < 0) return;
    try { cache.put('pf:y:' + range + ':' + s, JSON.stringify(out[s]), 3600); } catch (e) { /* too big */ }
  });
  return out;
}

function sma_(arr, n, i) {
  if (i + 1 < n) return null;
  var s = 0; for (var k = i - n + 1; k <= i; k++) s += arr[k];
  return s / n;
}

/** Support/resistance from swing points (5-bar fractals) over the last ~120 bars, plus MA20/MA60 and classic pivots. */
function levels_(rows) {
  var c = rows.map(function (r) { return r.c; });
  var n = rows.length;
  if (!n) return null;
  var last = rows[n - 1];
  var swings = [];
  var from = Math.max(2, n - 120);
  for (var i = from; i < n - 2; i++) {
    var h = rows[i].h, l = rows[i].l, hi = true, lo = true;
    for (var k = i - 2; k <= i + 2; k++) { if (k === i) continue; if (rows[k].h >= h) hi = false; if (rows[k].l <= l) lo = false; }
    if (hi) swings.push({ type: 'high', price: h, d: rows[i].d });
    if (lo) swings.push({ type: 'low', price: l, d: rows[i].d });
  }
  var price = last.c;
  var res = swings.filter(function (s) { return s.price > price; }).sort(function (a, b) { return a.price - b.price; }).slice(0, 3);
  var sup = swings.filter(function (s) { return s.price < price; }).sort(function (a, b) { return b.price - a.price; }).slice(0, 3);
  var prev = n > 1 ? rows[n - 2] : last;
  var P = (prev.h + prev.l + prev.c) / 3;
  return {
    ma20: sma_(c, 20, n - 1), ma60: sma_(c, 60, n - 1), ma120: sma_(c, 120, n - 1),
    resistance: res, support: sup,
    pivot: { p: P, r1: 2 * P - prev.l, s1: 2 * P - prev.h, r2: P + (prev.h - prev.l), s2: P - (prev.h - prev.l) },
    high_52w: Math.max.apply(null, rows.map(function (r) { return r.h; })),
    low_52w: Math.min.apply(null, rows.map(function (r) { return r.l; }))
  };
}

// ---------- market sentiment ----------
function marketPayload_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get('pf:market');
    if (hit) { var m = JSON.parse(hit); m.policy = targetPolicy_(); m.target = dynamicTarget_(m.policy, m.sentiment, 0); return m; }
  } catch (e) {}
  var s = yahooSeriesMany_(['^VIX', '^TWII', '^GSPC'], '1y');
  var out = { ok: true, at: nowIso_(), indicators: {} };
  var scores = [];
  var vix = s['^VIX'];
  if (vix && vix.length) {
    var v = vix[vix.length - 1].c;
    out.indicators.vix = { value: v, date: vix[vix.length - 1].d };
    // VIX 12 -> heat 1, 30 -> heat 0
    scores.push(Math.max(0, Math.min(1, (30 - v) / 18)));
  }
  ['^TWII', '^GSPC'].forEach(function (sym) {
    var rows = s[sym];
    if (!rows || rows.length < 60) return;
    var c = rows.map(function (r) { return r.c; });
    var n = c.length, last = c[n - 1];
    var ma20 = sma_(c, 20, n - 1), ma60 = sma_(c, 60, n - 1);
    var ma200 = n >= 200 ? sma_(c, 200, n - 1) : null;
    var peak = Math.max.apply(null, c);
    var gap60 = last / ma60 - 1;
    out.indicators[sym === '^TWII' ? 'twii' : 'spx'] = {
      value: last, date: rows[n - 1].d, ma20: ma20, ma60: ma60, ma200: ma200,
      above_ma20: last > ma20, above_ma60: last > ma60, gap_ma60: gap60, drawdown: last / peak - 1,
      change_1d: n > 1 ? last / c[n - 2] - 1 : null
    };
    // +10% over MA60 -> heat 1, -10% -> 0
    scores.push(Math.max(0, Math.min(1, (gap60 + 0.10) / 0.20)));
  });
  var heat = scores.length ? scores.reduce(function (a, b) { return a + b; }, 0) / scores.length : 0.5;
  out.sentiment = {
    heat: pfRound6(heat),
    label: heat >= 0.75 ? '過熱' : heat >= 0.55 ? '偏樂觀' : heat >= 0.35 ? '中性' : heat >= 0.15 ? '偏悲觀' : '恐慌',
    inputs: scores.length
  };
  try { cache.put('pf:market', JSON.stringify(out), 3600); } catch (e) {}
  out.policy = targetPolicy_();
  out.target = dynamicTarget_(out.policy, out.sentiment, 0);
  return out;
}

// ---------- quotes for holdings list (sparkline + day change) ----------
function quotesPayload_() {
  var assets = readTable_('Assets');
  var map = {}, syms = [];
  assets.forEach(function (a) {
    var y = yahooSymbol_(a);
    if (y) { map[a.asset_id] = y; if (syms.indexOf(y) < 0) syms.push(y); }
  });
  var series = yahooSeriesMany_(syms, '3mo');
  var navHist = storedHistory_();
  var quotes = {};
  assets.forEach(function (a) {
    var rows = map[a.asset_id] ? series[map[a.asset_id]] : null;
    var closes, dates, src;
    if (rows && rows.length) { closes = rows.map(function (r) { return r.c; }); dates = rows.map(function (r) { return r.d; }); src = 'yahoo'; }
    else if (navHist[a.asset_id] && navHist[a.asset_id].length) {
      closes = navHist[a.asset_id].map(function (r) { return r.v; }); dates = navHist[a.asset_id].map(function (r) { return r.d; }); src = 'stored';
    } else return;
    var n = closes.length;
    quotes[a.asset_id] = {
      symbol: a.symbol, yahoo: map[a.asset_id] || '', source: src,
      last: closes[n - 1], date: dates[n - 1], prev: n > 1 ? closes[n - 2] : null,
      change_pct: n > 1 && closes[n - 2] ? closes[n - 1] / closes[n - 2] - 1 : null,
      spark: closes.slice(-30)
    };
  });
  var hs = {};
  computeHoldings_().forEach(function (h) { hs[h.asset_id] = h; });
  var days = staleDaysMap_();
  Object.keys(quotes).forEach(function (id) {
    var h = hs[id]; if (!h) return;
    quotes[id].is_stale = !!h.is_stale; quotes[id].price_date = h.price_date || '';
    quotes[id].stale_limit_days = staleLimit_(days, h.price_kind || 'price', h.symbol, h.currency);
  });
  return { ok: true, at: nowIso_(), quotes: quotes };
}

/** Daily price/NAV history already stored in Prices_FX, keyed by asset_id. */
function storedHistory_() {
  var bySym = {};
  readTable_('Assets').forEach(function (a) { bySym[a.symbol] = a.asset_id; bySym[a.asset_id] = a.asset_id; });
  var out = {};
  readTable_('Prices_FX').forEach(function (r) {
    if (r.kind === 'fx') return;
    var id = bySym[r.symbol];
    if (!id) return;
    var d = r.date instanceof Date ? Utilities.formatDate(r.date, CONFIG.TZ, 'yyyy-MM-dd') : String(r.date).slice(0, 10);
    (out[id] = out[id] || []).push({ d: d, v: Number(r.value) });
  });
  Object.keys(out).forEach(function (k) {
    var seen = {};
    out[k] = out[k].sort(function (a, b) { return a.d < b.d ? -1 : 1; }).filter(function (r) { if (seen[r.d]) return false; seen[r.d] = 1; return true; });
  });
  return out;
}

function chartPayload_(assetId) {
  var a = null;
  readTable_('Assets').forEach(function (x) { if (x.asset_id === assetId || x.symbol === assetId) a = x; });
  if (!a) return { ok: false, error: 'unknown asset' };
  var y = yahooSymbol_(a);
  var rows = y ? (yahooSeriesMany_([y], '1y')[y] || null) : null;
  var src = 'yahoo';
  if (!rows || !rows.length) {
    src = 'stored';
    rows = (storedHistory_()[a.asset_id] || []).map(function (r) { return { d: r.d, o: r.v, h: r.v, l: r.v, c: r.v, v: null }; });
  }
  var c = rows.map(function (r) { return r.c; });
  var ma20 = c.map(function (_, i) { return sma_(c, 20, i); });
  var ma60 = c.map(function (_, i) { return sma_(c, 60, i); });
  return { ok: true, asset_id: a.asset_id, symbol: a.symbol, name: a.name, currency: a.currency, source: src, yahoo: y,
    rows: rows, ma20: ma20, ma60: ma60, levels: rows.length ? levels_(rows) : null,
    employer: String(a.symbol) === PF_EMPLOYER_SYMBOL };
}

// ---------- bank roll-up ----------
/** Adds holdings value per account and rolls children into parent/institution groups. */
function enrichBalances_(payload) {
  var accounts = accountsById_();
  var holdBy = {};
  computeHoldings_().forEach(function (h) {
    var v = Number(h.market_value_twd);
    if (!isFinite(v)) v = Number(h.cost_basis_twd) || 0;
    holdBy[h.account_id] = (holdBy[h.account_id] || 0) + v;
  });
  var rows = payload.balances;
  rows.forEach(function (b) {
    var a = accounts[b.account_id] || {};
    b.institution = a.institution || '';
    b.parent_account_id = a.parent_account_id || '';
    b.holdings_twd = round2_(holdBy[b.account_id] || 0);
    var sign = (b.type === 'loan' || b.type === 'credit_card') ? -1 : 1;
    if (b.balance_twd === null) b.total_twd = null;
    else b.total_twd = sign < 0 ? round2_(-Math.abs(b.balance_twd)) : round2_(b.balance_twd + b.holdings_twd);
    b.is_group = false;
  });
  var byId = {};
  rows.forEach(function (b) { byId[b.account_id] = b; });
  rows.forEach(function (b) {
    var hasKids = rows.some(function (k) { return k.parent_account_id === b.account_id; });
    if (hasKids) {
      b.is_group = true;
      b.rollup_twd = round2_(rows.filter(function (k) { return k.parent_account_id === b.account_id; })
        .reduce(function (s, k) { return s + (k.total_twd || 0); }, b.total_twd || 0));
    }
  });
  var groups = {};
  rows.forEach(function (b) {
    if (b.is_group || b.status !== 'active') return;
    var g = b.institution || '其他';
    var G = groups[g] = groups[g] || { institution: g, cash_twd: 0, holdings_twd: 0, liabilities_twd: 0, total_twd: 0, accounts: [] };
    if (b.type === 'loan' || b.type === 'credit_card') G.liabilities_twd += Math.abs(b.balance_twd || 0);
    else G.cash_twd += (b.balance_twd || 0);
    G.holdings_twd += b.holdings_twd;
    G.total_twd += (b.total_twd || 0);
    G.accounts.push(b.account_id);
  });
  payload.institutions = Object.keys(groups).map(function (k) {
    var G = groups[k];
    ['cash_twd', 'holdings_twd', 'liabilities_twd', 'total_twd'].forEach(function (f) { G[f] = round2_(G[f]); });
    return G;
  }).sort(function (a, b) { return b.total_twd - a.total_twd; });
  return payload;
}

// ---------- advice ----------
function pegatronPreEarnings_(today) {
  // Public calendar pattern: quarterly results ~mid Feb/May/Aug/Nov. Treat the 30 days before as sensitive.
  var d = today || new Date();
  var md = Number(Utilities.formatDate(d, CONFIG.TZ, 'MMdd'));
  var windows = [[120, 220], [420, 520], [720, 820], [1020, 1120]];
  return windows.some(function (w) { return md >= w[0] && md <= w[1]; });
}

function advicePayload_() {
  var alloc = allocationPayload_();
  var bal = enrichBalances_(balancesPayload_());
  var holdings = computeHoldings_();
  var market = marketPayload_();
  market.policy = targetPolicy_();
  var total = alloc.total_twd || 1;
  var items = [];
  function add(level, title, body, tag) { items.push({ level: level, title: title, body: body, tag: tag || '' }); }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }

  var pol = market.policy || PF_DEFAULT_POLICY;
  // 4938 compliance note only (no ratio limit): avoid suggesting 4938 trades in pre-earnings windows.
  var holdsEmp = holdings.some(function (h) { return String(h.symbol) === PF_EMPLOYER_SYMBOL; });
  if (holdsEmp && pegatronPreEarnings_())
    add('info', '和碩 4938：接近財報公布前', '目前接近和碩財報公布前的期間。這段時間不提供任何 4938 的交易建議，任何交易也請遵守公司內部人規範。', 'compliance');
  // Single-name concentration
  var byAsset = {};
  holdings.forEach(function (h) {
    if (h.asset_class !== 'stock') return;
    var k = h.symbol; byAsset[k] = byAsset[k] || { name: h.name, v: 0 }; byAsset[k].v += Number(h.market_value_twd) || 0;
  });
  Object.keys(byAsset).forEach(function (k) {
    var w = byAsset[k].v / total;
    if (w > pol.single_name_max) add('warn', '個股集中：' + byAsset[k].name + '（' + k + '）', '單一個股約 ' + pct(w) + '，高於 ' + pct(pol.single_name_max) + ' 的上限，可考慮分批降低。' + (k === PF_EMPLOYER_SYMBOL && pegatronPreEarnings_() ? '（目前接近財報公布前，這段時間不建議調整 4938）' : ''), 'concentration');
  });
  // Drift vs target
  (alloc.rows || []).forEach(function (r) {
    if (!r.alert) return;
    var dir = r.drift > 0 ? '高於' : '低於';
    var hint = r.bucket === 'cash' && r.drift < 0 ? '可考慮讓新收入先留在現金，補足緩衝。'
      : r.bucket === 'stock' && r.drift > 0 ? (pol.dca_exempt_enabled
        ? '可考慮暫停加碼與單筆投入；核心定額照常扣款' + (coreList_(pol).length ? '（' + coreList_(pol).join('、') + '）' : '') + '。'
        : '可考慮從漲幅大的部位分批獲利了結，或暫停新的股票投入（不含增加 4938）。')
      : r.bucket === 'bond' && r.drift > 0 ? '債券比例偏高，到期或配息時可轉回其他資產。'
      : r.bucket === 'stock' && r.drift < 0 ? '股票比例偏低，可考慮分批投入大盤型 ETF（不含 4938）。' : '';
    add('info', r.label + '比例' + dir + '目標', '目前 ' + pct(r.actual_weight) + '，目標 ' + pct(r.target_weight) + '（容許 ±' + alloc.band_pct + '%）。' + hint, 'drift');
  });
  // Cash buffer
  var cashW = (alloc.rows || []).filter(function (r) { return r.bucket === 'cash'; })[0];
  if (!(pol.dca_pause && String(pol.dca_pause.enabled).toUpperCase() === 'TRUE') && cashW && cashW.actual_weight < pol.cash_min) add('warn', '現金緩衝不足', '現金只佔 ' + pct(cashW.actual_weight) + '，低於 ' + pct(pol.cash_min) + ' 的下限。', 'cash');
  // DCA cash brake (off by default; parameters in target_policy.dca_pause)
  var brake = cashBrake_(pol, bal, cashW);
  if (brake.enabled && brake.triggered) add('warn', '暫停定額（現金煞車）', brake.reason, 'dca_pause');
  // Stale prices
  var stale = staleHoldings_(holdings);
  if (stale.length) add('warn', '有 ' + stale.length + ' 檔價格過期', stale.map(function (x) { return x.name + '（' + x.price_date + '，上限 ' + x.limit + ' 天）'; }).join('、') + '。請補上最新淨值或報價，配置與損益才準確。', 'stale');
  // Debt
  var liab = bal.net_worth.total_liabilities_twd;
  if (liab > 0 && cashW) add('info', '信貸與現金', '負債約 NT$' + Math.round(liab).toLocaleString() + '，現金約 NT$' + Math.round(cashW.actual_twd).toLocaleString() + '。如果信貸利率高於定存或預期報酬，可以考慮提前償還一部分。', 'debt');
  // Drawdowns / technicals on holdings via quotes
  try {
    var q = quotesPayload_().quotes;
    holdings.forEach(function (h) {
      var x = q[h.asset_id];
      if (!x || !x.spark || x.spark.length < 20) return;
      var peak = Math.max.apply(null, x.spark), dd = x.last / peak - 1;
      if (dd < -0.15 && (Number(h.market_value_twd) || 0) / total > 0.02)
        add('info', h.name + ' 近期回檔 ' + pct(-dd), '距離近 30 個交易日高點下跌超過 15%。可以檢查原本的持有理由是否還成立，再決定續抱、停損或分批調整。', 'drawdown');
    });
  } catch (e) { /* quotes unavailable */ }
  // Sentiment
  if (market.sentiment) {
    var vix = market.indicators.vix ? market.indicators.vix.value.toFixed(1) : '—';
    var off = pol.sentiment_mode === 'off';
    add('info', '市場情緒：' + market.sentiment.label, 'VIX ' + vix + '，綜合熱度 ' + Math.round(market.sentiment.heat * 100) + '/100。' +
      (off ? '情緒調整已關閉，目標配置固定（股票 ' + pct(alloc.target.stock || 0) + '、現金 ' + pct(alloc.target.cash || 0) + '），此項僅供參考。'
           : '股票目標依此調為 ' + pct(market.target.stock) + '，現金 ' + pct(market.target.cash) + '。'), 'sentiment');
  }
  var order = { warn: 0, info: 1 };
  items.sort(function (a, b) { return order[a.level] - order[b.level]; });
  return { ok: true, at: nowIso_(), items: items, sentiment: market.sentiment, target: market.target,
    disclaimer: '以上內容由規則依你的資料與公開市場數據自動產生，只是參考方向，不構成投資建議，也不是買賣指示。' };
}

/** Daily: append the latest Yahoo close for each listed stock/ETF to Prices_FX (append-only, source yahoo). Runs inside dailySnapshot. */
function syncMarketPrices_() {
  var assets = readTable_('Assets');
  var map = {}, syms = [];
  assets.forEach(function (a) { var y = yahooSymbol_(a); if (y) { map[a.asset_id] = y; if (syms.indexOf(y) < 0) syms.push(y); } });
  if (!syms.length) return 0;
  try { syms.forEach(function (s) { CacheService.getScriptCache().remove('pf:y:5d:' + s); }); } catch (e) {}
  var series = yahooSeriesMany_(syms, '5d');
  var have = {};
  readTable_('Prices_FX').forEach(function (p) { have[p.symbol + '|' + fmtDate_(p.date)] = true; });
  var added = 0;
  assets.forEach(function (a) {
    var rows = map[a.asset_id] ? series[map[a.asset_id]] : null;
    if (!rows || !rows.length) return;
    rows.forEach(function (r) {
      if (have[a.symbol + '|' + r.d] || !(r.c > 0)) return;
      appendRecord_('Prices_FX', { symbol: a.symbol, kind: 'price', date: r.d, value: Math.round(r.c * 10000) / 10000,
        currency: a.currency, source: 'yahoo', fetched_at: nowIso_(), is_stale: false, note: 'auto daily' });
      have[a.symbol + '|' + r.d] = true; added++;
    });
  });
  if (added) { safeRebuildHoldings_(); bumpCache_(); }
  return added;
}

/** Manual entry point (runnable from the editor). */
function syncMarketPricesNow() { beginRequest_(); return syncMarketPrices_(); }

function coreList_(pol) {
  var v = pol.dca_core_assets;
  if (typeof v === 'string') v = v.split(/[,，\s]+/);
  return (v || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
}

/** Path-D brake: cash < cash_pct_total of total assets, or net cash (cash - liabilities) < net_cash_pct_nw of net worth. */
function cashBrake_(pol, bal, cashRow) {
  var dp = pol.dca_pause || PF_DEFAULT_POLICY.dca_pause;
  var nw = bal.net_worth;
  var cash = nw.cash_twd + (nw.investments_cash_twd || 0);
  var cashPct = nw.total_assets_twd ? cash / nw.total_assets_twd : 0;
  var netCash = cash - nw.total_liabilities_twd;
  var netPct = nw.net_worth_twd ? netCash / nw.net_worth_twd : 0;
  var a = cashPct < Number(dp.cash_pct_total), b = netPct < Number(dp.net_cash_pct_nw);
  var reasons = [];
  if (a) reasons.push('現金佔總資產 ' + (cashPct * 100).toFixed(1) + '%，低於 ' + (dp.cash_pct_total * 100).toFixed(0) + '%');
  if (b) reasons.push('淨現金佔淨值 ' + (netPct * 100).toFixed(1) + '%，低於 ' + (dp.net_cash_pct_nw * 100).toFixed(0) + '%');
  return { enabled: dp.enabled === true || String(dp.enabled).toUpperCase() === 'TRUE', triggered: a || b,
    cash_pct_total: pfRound6(cashPct), net_cash_twd: round2_(netCash), net_cash_pct_nw: pfRound6(netPct),
    thresholds: { cash_pct_total: dp.cash_pct_total, net_cash_pct_nw: dp.net_cash_pct_nw },
    reason: reasons.join('；') + (reasons.length ? '。依規則可考慮暫停定額，直到現金回升。' : '') };
}

function staleHoldings_(holdings) {
  var days = staleDaysMap_();
  var seen = {}, out = [];
  holdings.forEach(function (h) {
    if (!h.is_stale || seen[h.asset_id]) return;
    seen[h.asset_id] = 1;
    out.push({ asset_id: h.asset_id, symbol: h.symbol, name: h.name, price_date: h.price_date || '',
      limit: staleLimit_(days, h.price_kind || 'price', h.symbol, h.currency) });
  });
  return out;
}

/** Read-only daily digest for 財政與經濟部. */
function financeSummaryPayload_() {
  var bal = enrichBalances_(balancesPayload_());
  var alloc = allocationPayload_();
  var holdings = computeHoldings_();
  var pol = targetPolicy_();
  var total = alloc.total_twd || 1;
  var byName = {};
  holdings.forEach(function (h) {
    if (h.asset_class !== 'stock') return;
    var k = h.symbol; byName[k] = byName[k] || { symbol: k, name: h.name, value_twd: 0 };
    byName[k].value_twd += Number(h.market_value_twd) || 0;
  });
  var single = Object.keys(byName).map(function (k) {
    var x = byName[k]; x.value_twd = round2_(x.value_twd); x.weight = pfRound6(x.value_twd / total);
    x.over_limit = x.weight > pol.single_name_max; return x;
  }).sort(function (a, b) { return b.weight - a.weight; });
  var cashRow = (alloc.rows || []).filter(function (r) { return r.bucket === 'cash'; })[0];
  var advice = null;
  try { advice = advicePayload_(); } catch (e) { advice = null; }
  return {
    ok: true, at: nowIso_(), as_of: today_(),
    net_worth: bal.net_worth,
    institutions: bal.institutions,
    allocation: { total_twd: alloc.total_twd, band_pct: alloc.band_pct, target: alloc.target, rows: alloc.rows,
      estimated: alloc.estimated, sentiment: alloc.sentiment, sentiment_mode: pol.sentiment_mode,
      denominator: 'total_assets_incl_cash' },
    single_stocks: single, single_name_max: pol.single_name_max,
    pegatron_pre_earnings: pegatronPreEarnings_(),
    cash_brake: cashBrake_(pol, bal, cashRow),
    dca: { exempt_enabled: !!pol.dca_exempt_enabled, core_assets: coreList_(pol) },
    stale: staleHoldings_(holdings),
    advice: advice ? advice.items : [],
    disclaimer: '自動產生，僅供參考，不構成投資建議。'
  };
}
