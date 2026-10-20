/**
 * Phase 3 reads. Facts (transactions, trades, prices) are never overwritten.
 * Cashflows is rebuilt. Benchmarks are append-only.
 * Performance is served from the Perf_Daily sheet. dailySnapshot fills it;
 * a read only computes a short catch-up chunk.
 */

function holdingsPayload_() {
  var prices = pricesPayload_();
  return {
    ok: true,
    holdings: computeHoldings_(),
    stale_count: (prices.stale || []).length,
    last_valuations: prices.last_valuations || []
  };
}

function performancePayload_(period, benchmarkId) {
  var today = today_();
  var range = pfPeriodRange(period, today);
  var facts = loadPerfFacts_();
  var refresh = { fresh: false, done: false, through: '', rows: [] };
  try { refresh = refreshPerfCacheFromFacts_(facts, 2500); }
  catch (err) { Logger.log('perf cache read skipped: ' + err); }
  var rows = refresh.rows || readPerfRows_();
  return servePerf_(rows, range, benchmarkId, today, facts, refresh);
}

function allocationPayload_() {
  var settings = targetSettings_();
  var target = pfNormalizeTarget(settings.target);
  var prices = pricesPayload_();
  var balances = balancesPayload_();
  var holdings = computeHoldings_();
  var amounts = {};
  var estimated = [];
  holdings.forEach(function (h) {
    var bucket = pfBucket(h.asset_class || 'other', target);
    var mv = h.market_value_twd;
    if (mv === '' || mv === null || mv === undefined) {
      mv = h.cost_basis_twd || 0;
      estimated.push(h.symbol || h.asset_id);
    }
    amounts[bucket] = (amounts[bucket] || 0) + Number(mv || 0);
  });
  (balances.balances || []).forEach(function (b) {
    if (b.type === 'loan' || b.type === 'credit_card') return;
    if (b.status && b.status !== 'active') return;
    if (b.balance_twd === null || b.balance_twd === undefined || b.balance_twd === '') return;
    amounts.cash = (amounts.cash || 0) + Number(b.balance_twd);
  });
  var market = null;
  if (!settings.legacy) {
    try { market = marketPayload_(); } catch (mErr) { market = null; }
    var tot = 0; Object.keys(amounts).forEach(function (k) { tot += Number(amounts[k]) || 0; });
    target = dynamicTarget_(targetPolicy_(), market && market.sentiment, tot ? (amounts.other || 0) / tot : 0);
  }
  var alloc = pfAllocation(amounts, target, settings.band);
  var labels = { stock: '股票', etf: '股票', bond: '債券', cash: '現金', fund: '基金', other: '其他' };
  alloc.rows.forEach(function (row) {
    row.label = labels[row.bucket] || row.bucket;
    row.actual_weight = pfRate_(row.actual_weight);
    row.target_weight = pfRate_(row.target_weight);
    row.drift = pfRate_(row.drift);
  });
  return {
    ok: true,
    total_twd: alloc.total_twd,
    band_pct: alloc.band_pct,
    target: target,
    target_set: settings.set,
    policy: settings.legacy ? null : targetPolicy_(),
    sentiment: market ? market.sentiment : null,
    rows: alloc.rows,
    estimated: estimated,
    stale_count: (prices.stale || []).length,
    last_valuations: prices.last_valuations || [],
    missing_fx: (balances.net_worth && balances.net_worth.missing_fx) || []
  };
}

function benchmarkSymbols_() {
  var raw = settings_().benchmarks || '0050.TW,^TWII,SPY';
  return String(raw).split(/[,，\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function benchmarkView_(requested, dates, from, to) {
  var stored = {};
  readTable_('Benchmarks').forEach(function (row) { if (row.benchmark_id) stored[row.benchmark_id] = true; });
  var available = benchmarkSymbols_().slice();
  Object.keys(stored).sort().forEach(function (id) { if (available.indexOf(id) < 0) available.push(id); });
  var id = requested && available.indexOf(requested) >= 0 ? requested : (available[0] || '');
  var levels = benchmarkLevels_(id);
  var currency = levels.length ? levels[0].currency : '';
  var fx = currency && currency !== 'TWD' ? fxHistory_(currency) : null;
  var result = dates.length ? pfBenchmarkReturn(levels, from || dates[0], to || dates[dates.length - 1], fx) : null;
  return {
    id: id,
    currency: currency,
    local_return: result ? result.local : null,
    twd_return: result ? result.twd : null,
    series: pfBenchmarkSeries(dates, levels, fx),
    available: available
  };
}

function benchmarkLevels_(id) {
  if (!id) return [];
  return readTable_('Benchmarks').filter(function (row) { return row.benchmark_id === id; }).map(function (row) {
    return { date: fmtDate_(row.date), value: num_(row.index_value), currency: row.currency || '' };
  }).filter(function (row) { return row.date && isFinite(row.value); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}

function fxHistory_(currency) {
  return readTable_('Prices_FX').filter(function (p) { return p.kind === 'fx' && p.symbol === currency + 'TWD'; }).map(function (p) {
    return { date: fmtDate_(p.date), value: num_(p.value) };
  }).filter(function (p) { return p.date && p.value; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}

function bandOf_(saved) {
  var band = Number(saved.rebalance_band_pct);
  return (!isFinite(band) || band <= 0) ? 5 : band;
}

function targetSettings_() {
  var saved = settings_();
  var target = { stock: 0.6, bond: 0.2, cash: 0.2 };
  var set = false;
  // v0.2: target_policy (dynamic, sentiment-adjusted) wins unless target_mode=fixed.
  if (String(saved.target_mode || '') !== 'fixed') return { target: target, band: bandOf_(saved), set: true, legacy: false };
  if (saved.target_allocation) {
    try {
      var parsed = typeof saved.target_allocation === 'string' ? JSON.parse(saved.target_allocation) : saved.target_allocation;
      if (parsed && typeof parsed === 'object') { target = parsed; set = true; }
    } catch (err) { /* keep the default mix */ }
  }
  var band = Number(saved.rebalance_band_pct);
  if (!isFinite(band) || band <= 0) band = 5;
  return { target: target, band: band, set: set, legacy: true };
}

function pfRate_(value) {
  if (value === null || value === undefined || !isFinite(Number(value))) return null;
  return pfRound6(Number(value));
}

function safeRebuildCashflows_() {
  try { rebuildCashflows_(); return ''; }
  catch (err) { return 'cashflows rebuild failed: ' + err.message; }
}

function rebuildCashflows_() {
  var accounts = accountsById_();
  var txns = readTable_('Transactions').map(function (t) {
    return {
      txn_id: t.txn_id,
      date: fmtDate_(t.date),
      account_id: t.account_id,
      status: t.status,
      trade_id: t.trade_id || '',
      txn_type: t.txn_type,
      flow_class: t.flow_class,
      amount: num_(t.amount),
      amount_twd: num_(t.amount_twd),
      currency: t.currency,
      fx_rate: num_(t.fx_rate) || 1
    };
  });
  var rows = pfBuildCashflows(txns, function (t) {
    var acc = accounts[t.account_id];
    return !!(acc && String(acc.is_investment).toUpperCase() === 'TRUE');
  });
  replaceBody_('Cashflows', rows);
  return rows.length;
}

/**
 * One public-index chunk per call. The cursor lives in Settings, so a replayed
 * request_id does not freeze progress: the next distinct request continues.
 * A trigger loops chunks until the year is covered or the time budget ends.
 */
function fetchBenchmarks() {
  beginRequest_();
  var started = Date.now();
  var added = 0;
  var warnings = [];
  var last = { done: false };
  var guard = 0;
  while (guard < 40 && Date.now() - started < 150000) {
    last = fetchBenchmarksBody_();
    added += last.added || 0;
    if (last.warnings && last.warnings.length) warnings = warnings.concat(last.warnings);
    guard++;
    if (last.done) break;
  }
  return { ids: [], added: added, warnings: warnings, done: !!last.done, chunks: guard, symbol: last.symbol || '' };
}

function fetchBenchmarksBody_() {
  var symbols = benchmarkSymbols_();
  var today = today_();
  var step = pfBenchmarkStep_(symbols, readBenchmarkCursor_(), today);
  var ran = runBenchmarkStep_(step);
  var next = step.maintenance
    ? { i: step.symbolCount, op: 'done', month: 0, maint: (step.symbolIndex + 1) % Math.max(step.symbolCount, 1), done: true }
    : pfNextBenchmark_(step, !!ran.covered);
  writeBenchmarkCursor_(next);
  return {
    ids: [],
    added: ran.added,
    warnings: ran.warnings,
    done: !!next.done,
    symbol: step.symbol,
    op: step.op,
    month: step.monthKey || ''
  };
}

function runBenchmarkStep_(step) {
  try {
    var rows;
    if (step.op === 'twse' && step.twseKind === 'index') rows = fetchTwseIndexMonth_(step.monthKey);
    else if (step.op === 'twse' && step.twseKind === 'stock') rows = fetchTwseMonth_(step.stockNo, step.monthKey);
    else rows = fetchYahooDaily_(step.symbol, step.yahooRange || '2y');
    return {
      added: appendBenchmarkRows_(step.symbol, rows),
      warnings: [],
      covered: pfCoversYear_(rows, today_())
    };
  } catch (err) {
    return {
      added: 0,
      warnings: [step.symbol + ': ' + (err && err.message ? err.message : 'fetch failed')],
      covered: false
    };
  }
}

function fetchYahooDaily_(symbol, range) {
  var span = range || '2y';
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=' + encodeURIComponent(span);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
  var body = JSON.parse(res.getContentText());
  var result = body.chart && body.chart.result && body.chart.result[0];
  if (!result || !result.timestamp) throw new Error('no chart');
  var adj = result.indicators && result.indicators.adjclose && result.indicators.adjclose[0] && result.indicators.adjclose[0].adjclose;
  var close = result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close;
  var currency = (result.meta && result.meta.currency) || '';
  var tz = (result.meta && result.meta.exchangeTimezoneName) || CONFIG.TZ;
  var out = [];
  for (var i = 0; i < result.timestamp.length; i++) {
    var value = adj && adj[i] !== null && adj[i] !== undefined ? adj[i] : (close ? close[i] : null);
    if (value === null || value === undefined || !isFinite(value)) continue;
    out.push({
      date: Utilities.formatDate(new Date(result.timestamp[i] * 1000), tz, 'yyyy-MM-dd'),
      value: value,
      currency: currency,
      total_return: !!(adj && adj[i] !== null && adj[i] !== undefined),
      source: 'yahoo'
    });
  }
  if (!out.length) throw new Error('empty chart');
  return out;
}

function fetchTwseMonth_(stockNo, yyyymm) {
  var rows = fetchTwseJson_('https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=' + yyyymm + '01&stockNo=' + stockNo);
  var closeAt = twseColumn_(rows.fields, ['收盤價', '收盤'], 6);
  return twseCloses_(rows.data, 0, closeAt, 'twse');
}

function fetchTwseIndexMonth_(yyyymm) {
  var rows = fetchTwseJson_('https://www.twse.com.tw/exchangeReport/FMTQIK?response=json&date=' + yyyymm + '01');
  var closeAt = twseColumn_(rows.fields, ['發行量加權股價指數'], 4);
  return twseCloses_(rows.data, 0, closeAt, 'twse');
}

function fetchTwseJson_(url) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
  var body = JSON.parse(res.getContentText());
  if (!body || body.stat === '很抱歉，沒有符合條件的資料!') throw new Error('empty twse');
  return { fields: body.fields || [], data: body.data || [] };
}

function twseColumn_(fields, names, fallback) {
  var list = fields || [];
  for (var i = 0; i < names.length; i++) {
    var at = list.indexOf(names[i]);
    if (at >= 0) return at;
  }
  return fallback;
}

function twseCloses_(data, dateAt, closeAt, source) {
  var out = [];
  (data || []).forEach(function (row) {
    var date = rocDate_(row[dateAt]);
    var close = Number(String(row[closeAt] || '').replace(/,/g, ''));
    if (date && isFinite(close) && close > 0) out.push({ date: date, value: close, currency: 'TWD', total_return: false, source: source });
  });
  if (!out.length) throw new Error('empty twse');
  return out;
}

function rocDate_(value) {
  var text = String(value || '').trim();
  var roc = /^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (roc) return (Number(roc[1]) + 1911) + '-' + ('0' + roc[2]).slice(-2) + '-' + ('0' + roc[3]).slice(-2);
  var iso = /^(\d{4})[\/-](\d{2})[\/-](\d{2})$/.exec(text);
  return iso ? iso[1] + '-' + iso[2] + '-' + iso[3] : '';
}

function appendBenchmarkRows_(symbol, rows) {
  var have = {};
  readTable_('Benchmarks').forEach(function (row) {
    if (row.benchmark_id === symbol) have[fmtDate_(row.date)] = true;
  });
  var added = [];
  var currency = '';
  var fetchedAt = nowIso_();
  rows.forEach(function (row) {
    if (!row.date || have[row.date]) return;
    have[row.date] = true;
    if (!currency && row.currency) currency = row.currency;
    added.push({
      benchmark_id: symbol,
      date: row.date,
      index_value: row.value,
      currency: row.currency || currency,
      total_return: row.total_return ? true : false,
      daily_return: '',
      source: row.source || 'yahoo',
      fetched_at: fetchedAt
    });
  });
  if (added.length) appendRecords_('Benchmarks', added);
  return added.length;
}

var PERF_DAILY_HEADERS = ['date', 'nav', 'source', 'accounts_json', 'holdings_json'];
var PERF_CHUNK_DATES = 40;

function readBenchmarkCursor_() {
  var raw = settings_().benchmark_cursor || '';
  if (!raw) return { i: 0, op: 'yahoo', month: 12, maint: 0 };
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { i: 0, op: 'yahoo', month: 12, maint: 0 };
  } catch (err) {
    return { i: 0, op: 'yahoo', month: 12, maint: 0 };
  }
}

function writeBenchmarkCursor_(state) {
  putSetting_('benchmark_cursor', JSON.stringify({
    i: state.i || 0,
    op: state.op || 'yahoo',
    month: state.month == null ? 12 : state.month,
    maint: state.maint || 0
  }));
}

function putSetting_(key, value) {
  var text = String(value);
  var rows = readTable_('Settings');
  var found = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].key === key) found = rows[i];
  if (found) {
    if (String(found.value) === text) return;
    updateCells_('Settings', found._row, { value: text });
    return;
  }
  appendRecord_('Settings', { key: key, value: text, note: '' });
}

function readPerfMeta_() {
  var raw = settings_().perf_cache || '';
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) { return {}; }
}

function writePerfMeta_(meta) {
  putSetting_('perf_cache', JSON.stringify(meta || {}));
}

function loadPerfFacts_() {
  var today = today_();
  var accounts = readTable_('Accounts').filter(function (row) { return row.status !== 'closed'; }).map(function (row) {
    return {
      account_id: row.account_id,
      name: row.name || row.account_id,
      type: row.type,
      currency: row.currency,
      opening_balance: num_(row.opening_balance),
      opening_date: fmtDate_(row.opening_date),
      is_investment: String(row.is_investment).toUpperCase() === 'TRUE',
      status: row.status || 'active'
    };
  });
  var trades = [];
  var tradeChanges = [];
  var lines = [];
  readTable_('Accounts').forEach(function (row) {
    lines.push(pfFactLine_('A', [
      row.account_id, row.status, fmtDate_(row.opening_date), row.opening_balance,
      row.is_investment, row.currency, row.type
    ]));
  });
  readTable_('Investment_Trades').forEach(function (row) {
    var date = fmtDate_(row.trade_date);
    var touched = touchedIso_(row.updated_at || row.created_at);
    lines.push(pfFactLine_('R', [row.trade_id, date, row.status, touched, row.quantity, row.side, row.asset_id, row.account_id, row.gross_amount, row.fx_rate]));
    tradeChanges.push({ date: date, touched: touched });
    if (row.status !== 'active') return;
    trades.push({
      id: row.trade_id, date: date, account_id: row.account_id, asset_id: row.asset_id, side: row.side,
      quantity: num_(row.quantity), gross: num_(row.gross_amount), fee: num_(row.fee), tax: num_(row.tax), fx: num_(row.fx_rate) || 1
    });
  });
  var txns = [];
  readTable_('Transactions').forEach(function (row) {
    var date = fmtDate_(row.date);
    var touched = touchedIso_(row.updated_at || row.created_at);
    lines.push(pfFactLine_('T', [row.txn_id, date, row.status, row.amount, row.amount_twd, touched, row.account_id, row.flow_class, row.txn_type, row.asset_id]));
    tradeChanges.push({ date: date, touched: touched });
    if (row.status !== 'active') return;
    txns.push({
      txn_id: row.txn_id, date: date, account_id: row.account_id, amount: num_(row.amount),
      amount_twd: num_(row.amount_twd), flow_class: row.flow_class, trade_id: row.trade_id || '',
      txn_type: row.txn_type, status: row.status, asset_id: row.asset_id || '', currency: row.currency
    });
  });
  var priceRows = readTable_('Prices_FX').map(function (row) {
    return {
      symbol: row.symbol, kind: row.kind, date: fmtDate_(row.date), value: row.value,
      currency: row.currency, fetched_at: touchedIso_(row.fetched_at), source: row.source
    };
  });
  priceRows.forEach(function (row) {
    lines.push(pfFactLine_('P', [row.symbol, row.kind, row.date, row.value, row.fetched_at]));
    tradeChanges.push({ date: row.date, touched: row.fetched_at });
  });
  var snapshots = readTable_('Snapshots').map(function (row) {
    return {
      snapshot_date: fmtDate_(row.snapshot_date),
      investments_twd: row.investments_twd,
      created_at: touchedIso_(row.created_at)
    };
  });
  snapshots.forEach(function (row) {
    lines.push(pfFactLine_('S', [row.snapshot_date, row.investments_twd, row.created_at]));
    tradeChanges.push({ date: row.snapshot_date, touched: row.created_at });
  });
  var assets = assetsById_();
  var origin = today;
  function consider(date) { if (date && date < origin) origin = date; }
  accounts.forEach(function (account) { if (account.is_investment) consider(account.opening_date); });
  trades.forEach(function (trade) { consider(trade.date); });
  txns.forEach(function (txn) { consider(txn.date); });
  snapshots.forEach(function (row) { consider(row.snapshot_date); });
  return {
    accounts: accounts,
    trades: trades,
    txns: txns,
    assets: assets,
    snapshots: snapshots,
    priceIndex: pfPriceIndex(priceRows),
    stamp: pfFactsStamp_(lines),
    accountDigest: pfAccountDigest_(accounts),
    origin: origin,
    changes: tradeChanges
  };
}

function touchedIso_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, CONFIG.TZ, "yyyy-MM-dd'T'HH:mm:ss") + '+08:00';
  }
  return String(value);
}

function refreshPerfCache_(budgetMs) {
  return refreshPerfCacheFromFacts_(loadPerfFacts_(), budgetMs || 90000);
}

function refreshPerfCacheFromFacts_(facts, budgetMs) {
  var started = Date.now();
  var today = today_();
  var meta = readPerfMeta_();
  var rows = null;
  var computedTotal = 0;
  var guard = 0;
  var through = meta.through || '';
  while (guard < 80 && Date.now() - started < budgetMs) {
    guard++;
    var plan = pfPlanPerf_(meta, facts, today);
    if (plan.action === 'fresh') {
      if (!rows) rows = readPerfRows_();
      if (rows.length) return { fresh: true, through: meta.through || today, done: true, computed: computedTotal, rows: rows };
      meta = {};
      continue;
    }
    if (plan.action === 'commit') {
      meta = {
        built_at: nowIso_(),
        through: meta.through || today,
        stamp: facts.stamp,
        account_digest: facts.accountDigest,
        pending_from: '',
        pending_stamp: ''
      };
      writePerfMeta_(meta);
      return { fresh: true, through: meta.through, done: true, computed: computedTotal, rows: rows };
    }
    var from = plan.from || facts.origin || today;
    if (facts.origin && from < facts.origin) from = facts.origin;
    if (from > today) from = today;
    var dates = pfDateSpan_(from, today);
    if (!dates.length) {
      meta = {
        built_at: nowIso_(), through: today, stamp: facts.stamp, account_digest: facts.accountDigest,
        pending_from: '', pending_stamp: ''
      };
      writePerfMeta_(meta);
      return { fresh: true, through: today, done: true, computed: computedTotal, rows: rows };
    }
    var room = budgetMs - (Date.now() - started);
    if (computedTotal && room < 500) break;
    var take = Math.max(1, Math.min(dates.length, PERF_CHUNK_DATES));
    if (!rows) rows = readPerfRows_();
    var kept = [];
    for (var i = 0; i < rows.length; i++) if (rows[i].date < from) kept.push(rows[i]);
    var computed = computePerfDates_(dates.slice(0, take), facts);
    var finished = computed.length >= dates.length;
    rows = kept.concat(computed);
    replacePerfRows_(rows);
    through = computed.length ? computed[computed.length - 1].date : through;
    computedTotal += computed.length;
    meta = {
      built_at: finished ? nowIso_() : (meta.built_at || ''),
      through: through,
      stamp: finished ? facts.stamp : (meta.stamp || ''),
      account_digest: facts.accountDigest,
      pending_from: finished ? '' : from,
      pending_stamp: finished ? '' : facts.stamp
    };
    writePerfMeta_(meta);
    if (finished) return { fresh: false, through: through, done: true, computed: computedTotal, rows: rows };
  }
  return { fresh: false, through: through, done: false, computed: computedTotal, rows: rows };
}

function computePerfDates_(dates, facts) {
  if (!dates.length) return [];
  var books = pfBooksOnDates(facts.trades, dates);
  var cash = pfCashOnDates(facts.accounts, facts.txns, dates);
  var snaps = {};
  (facts.snapshots || []).forEach(function (row) {
    if (!row.snapshot_date) return;
    if (row.investments_twd === '' || row.investments_twd === null || row.investments_twd === undefined) return;
    snaps[row.snapshot_date] = num_(row.investments_twd);
  });
  var out = [];
  for (var i = 0; i < dates.length; i++) {
    var snap = Object.prototype.hasOwnProperty.call(snaps, dates[i]) ? snaps[dates[i]] : null;
    out.push(pfDayPoint_(dates[i], books[i].books, cash[i].balances, facts.accounts, facts.assets, facts.priceIndex, snap));
  }
  return out;
}

function perfSheet_() {
  var name = 'Perf_Daily';
  var bag = req_();
  if (bag.sheets[name]) return bag.sheets[name];
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, PERF_DAILY_HEADERS.length).setValues([PERF_DAILY_HEADERS]);
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < 1 || !sh.getRange(1, 1).getValue()) {
    sh.getRange(1, 1, 1, PERF_DAILY_HEADERS.length).setValues([PERF_DAILY_HEADERS]);
  }
  bag.sheets[name] = sh;
  return sh;
}

function perfRowValues_(row) {
  return [row.date, row.nav, row.source || '', JSON.stringify(row.accounts || {}), JSON.stringify(row.holdings || {})];
}

function readPerfRows_() {
  var bag = req_();
  if (bag.perfRows) return bag.perfRows;
  var sh = perfSheet_();
  var last = sh.getLastRow();
  if (last < 2) { bag.perfRows = []; return bag.perfRows; }
  var vals = sh.getRange(2, 1, last - 1, PERF_DAILY_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var date = fmtDate_(vals[i][0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      date: date,
      nav: num_(vals[i][1]),
      source: String(vals[i][2] || ''),
      accounts: parsePerfJson_(vals[i][3]),
      holdings: parsePerfJson_(vals[i][4])
    });
  }
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  bag.perfRows = out;
  return out;
}

function parsePerfJson_(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    var parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) { return {}; }
}

function replacePerfRows_(rows) {
  var sh = perfSheet_();
  var list = rows || [];
  if (list.length) sh.getRange(2, 1, list.length, PERF_DAILY_HEADERS.length).setValues(list.map(perfRowValues_));
  var last = sh.getLastRow();
  var firstClear = list.length + 2;
  if (last >= firstClear) sh.getRange(firstClear, 1, last - firstClear + 1, PERF_DAILY_HEADERS.length).clearContent();
  req_().perfRows = list.slice();
  return list;
}

function servePerf_(rows, range, benchmarkId, today, facts, refresh) {
  var warnings = [];
  if (!rows.length) warnings.push('績效日檔還沒有資料，每日快照會開始補。');
  else if (refresh && refresh.done === false) warnings.push('績效日檔補到 ' + (refresh.through || rows[rows.length - 1].date) + '，其餘會在每日快照時繼續補。');
  var boundary = range.from ? pfAddDays_(range.from, -1) : '';
  var points = [];
  rows.forEach(function (row) {
    if (!row.date || row.date > (range.to || today)) return;
    if (boundary) { if (row.date < boundary) return; }
    else if (range.from && row.date < range.from) return;
    points.push({ date: row.date, nav: num_(row.nav), source: row.source, accounts: row.accounts || {}, holdings: row.holdings || {} });
  });
  var snapCount = 0;
  points.forEach(function (point) { if (point.source === 'snapshot' && point.nav) snapCount++; });
  var method = snapCount >= 2 ? 'snapshot' : 'computed';
  if (method === 'computed') warnings.push('這個區間的快照不足兩點，報酬改由交易與報價推算。');
  if (method === 'snapshot' && points.length && points[points.length - 1].source === 'computed') {
    warnings.push('今天還沒有快照，最新一點用持倉與現金推算。');
  }
  var linkFrom = points.length ? points[0].date : (range.from || '');
  var linkTo = points.length ? points[points.length - 1].date : (range.to || today);
  var invIds = facts.accounts.filter(function (account) { return account.is_investment; }).map(function (account) { return account.account_id; });
  var linkFlows = pfPortfolioFlows(facts.txns, invIds, linkFrom, linkTo);
  var linked = pfLinkedTwr(points, linkFlows);
  if (linked.gaps.length) warnings.push('有一段淨值的報酬分母是 0，該段先以 0 連結。');
  var schedule = points.length >= 2
    ? pfXirrSchedule(linkFlows, points[0].nav, points[0].date, points[points.length - 1].nav, points[points.length - 1].date)
    : [];
  var shownFlows = pfPortfolioFlows(facts.txns, invIds, boundary, range.to);
  var contribution = 0;
  var withdrawal = 0;
  shownFlows.forEach(function (flow) {
    if (flow.amount > 0) contribution += flow.amount;
    else withdrawal += flow.amount;
  });
  var marks = perfMarksAt_(facts.trades, facts.assets, facts.priceIndex, boundary, linkTo || range.to);
  var pnl = pfPeriodPnl(facts.trades, marks, boundary, range.to);
  if (pnl.unpriced.length) warnings.push('有持倉在區間端點缺少報價，未實現損益不含該部位。');
  var income = pfIncome(facts.txns, boundary, range.to, invIds);
  var bench = benchmarkView_(benchmarkId, points.map(function (point) { return point.date; }), linkFrom, linkTo);
  if (bench.id && bench.twd_return === null && bench.local_return === null) warnings.push('這個區間還沒有 ' + bench.id + ' 的指標價格。');
  var benchByDate = {};
  (bench.series || []).forEach(function (row) { benchByDate[row.date] = row.index; });
  var accountRows = accountRowsFromCache_(facts.accounts, points, facts.txns);
  var holdingRows = holdingRowsFromCache_(points, facts, boundary, range.to);
  var prices = pricesPayload_();
  var staleHoldings = holdingRows.filter(function (row) { return row.is_stale; }).length;
  if (staleHoldings) warnings.push('有 ' + staleHoldings + ' 檔持倉的報價已過期。');
  return {
    ok: true,
    period: range.period,
    from: range.from,
    to: range.to,
    method: method,
    portfolio: {
      twr: pfRate_(linked.twr),
      xirr: pfRate_(pfXirr(schedule)),
      max_drawdown: linked.max_drawdown ? {
        value: pfRate_(linked.max_drawdown.value),
        peak_date: linked.max_drawdown.peak_date,
        trough_date: linked.max_drawdown.trough_date
      } : null,
      nav: points.length ? pfRound2(points[points.length - 1].nav) : 0,
      external: {
        contribution: pfRound2(contribution),
        withdrawal: pfRound2(withdrawal),
        net: pfRound2(contribution + withdrawal)
      },
      pnl: {
        realized_price: pnl.realized_price,
        realized_fx: pnl.realized_fx,
        realized_total: pnl.realized_total,
        unrealized_price: pnl.unrealized_price,
        unrealized_fx: pnl.unrealized_fx,
        unrealized_total: pnl.unrealized_total,
        dividends: income.dividends,
        interest: income.interest,
        fees: income.fees,
        trade_fees: pnl.trade_fees
      }
    },
    series: linked.series.map(function (row) {
      return {
        date: row.date,
        nav: pfRound2(row.nav),
        index: pfRate_(row.index),
        drawdown: pfRate_(row.drawdown),
        link: row.link,
        benchmark_index: benchByDate[row.date] === undefined || benchByDate[row.date] === null ? null : pfRate_(benchByDate[row.date])
      };
    }),
    benchmark: {
      id: bench.id,
      currency: bench.currency,
      local_return: pfRate_(bench.local_return),
      twd_return: pfRate_(bench.twd_return),
      available: bench.available
    },
    accounts: accountRows,
    holdings: holdingRows,
    stale_count: (prices.stale || []).length,
    last_valuations: prices.last_valuations || [],
    warnings: warnings
  };
}

function perfMarksAt_(trades, assets, priceIndex, from, to) {
  var keys = {};
  Object.keys(pfReplay(trades).books).forEach(function (key) { keys[key] = true; });
  if (from) {
    Object.keys(pfReplay(trades.filter(function (trade) { return trade.date <= from; })).books).forEach(function (key) { keys[key] = true; });
  }
  var marks = {};
  Object.keys(keys).forEach(function (key) {
    var assetId = key.split('|')[1];
    var asset = (assets && assets[assetId]) || { asset_id: assetId };
    var start = from ? pfMarkAt_(asset, from, priceIndex) : { price: null, fx: null };
    var end = pfMarkAt_(asset, to, priceIndex);
    marks[key] = { startPrice: start.price, startFx: start.fx, endPrice: end.price, endFx: end.fx };
  });
  return marks;
}

function accountRowsFromCache_(accounts, points, txns) {
  var rows = [];
  (accounts || []).forEach(function (account) {
    if (!account.is_investment || account.type === 'loan' || account.type === 'credit_card') return;
    var series = [];
    points.forEach(function (point) {
      if (!point.accounts || !Object.prototype.hasOwnProperty.call(point.accounts, account.account_id)) return;
      var nav = Number(point.accounts[account.account_id]);
      if (!isFinite(nav)) return;
      series.push({ date: point.date, nav: nav });
    });
    if (!series.length || series.every(function (point) { return !point.nav; })) return;
    var from = series[0].date;
    var to = series[series.length - 1].date;
    var flows = pfAccountFlows(txns, account.account_id, from, to);
    var linked = pfLinkedTwr(series, flows);
    var xirr = series.length >= 2 ? pfXirr(pfXirrSchedule(flows, series[0].nav, from, series[series.length - 1].nav, to)) : null;
    rows.push({
      account_id: account.account_id,
      name: account.name,
      nav: pfRound2(series[series.length - 1].nav),
      twr: pfRate_(linked.twr),
      xirr: pfRate_(xirr),
      max_drawdown: linked.max_drawdown ? pfRate_(linked.max_drawdown.value) : null
    });
  });
  return rows;
}

function holdingRowsFromCache_(points, facts, from, to) {
  var replay = pfReplay(facts.trades);
  var endDate = points.length ? points[points.length - 1].date : '';
  var endBooks = endDate ? (pfBooksOnDates(facts.trades, [endDate])[0].books || {}) : {};
  var keys = {};
  points.forEach(function (point) {
    Object.keys(point.holdings || {}).forEach(function (key) { keys[key] = true; });
  });
  Object.keys(endBooks).forEach(function (key) { if (endBooks[key].qty > 0) keys[key] = true; });
  var names = {};
  (facts.accounts || []).forEach(function (account) { names[account.account_id] = account.name || account.account_id; });
  var days = staleDaysMap_();
  var rows = [];
  Object.keys(keys).sort().forEach(function (key) {
    var parts = key.split('|');
    var accountId = parts[0];
    var assetId = parts[1];
    var asset = (facts.assets && facts.assets[assetId]) || {};
    var series = [];
    var closed = false;
    points.forEach(function (point) {
      var nav = point.holdings ? point.holdings[key] : undefined;
      if (nav === undefined || nav === null || nav === '') {
        if (series.length && !closed) {
          series.push({ date: point.date, nav: 0 });
          closed = true;
        }
        return;
      }
      closed = false;
      series.push({ date: point.date, nav: Number(nav) });
    });
    var seriesFrom = series.length ? series[0].date : null;
    var seriesTo = series.length ? series[series.length - 1].date : null;
    var flows = replay.events.filter(function (event) {
      return event.account_id === accountId && event.asset_id === assetId && pfInWindow(event.date, seriesFrom, seriesTo);
    }).map(function (event) { return { date: event.date, amount: event.capital }; });
    var income = (facts.txns || []).filter(function (txn) {
      return txn.account_id === accountId && txn.asset_id === assetId && (txn.txn_type === 'dividend' || txn.txn_type === 'interest') && pfInWindow(txn.date, seriesFrom, seriesTo);
    }).map(function (txn) { return { date: txn.date, amount: txn.amount_twd }; });
    var linked = pfLinkedTwr(series, flows, income);
    var endNav = series.length ? series[series.length - 1].nav : 0;
    var xirrFlows = flows.concat(income.map(function (row) { return { date: row.date, amount: -row.amount }; }));
    var xirr = series.length >= 2 ? pfXirr(pfXirrSchedule(xirrFlows, series[0].nav, series[0].date, endNav, series[series.length - 1].date)) : null;
    var nowBook = endBooks[key] || pfEmptyBook(accountId, assetId);
    var nowMark = endDate ? pfMarkAt_(asset.asset_id ? asset : { asset_id: assetId, symbol: asset.symbol, asset_class: asset.asset_class, currency: asset.currency }, endDate, facts.priceIndex) : { price: null, fx: null, kind: '', date: '' };
    var nowU = pfUnrealized(nowBook, nowMark.price, nowMark.fx);
    var periodRealized = { price: 0, fx: 0, total: 0 };
    replay.events.forEach(function (event) {
      if (event.kind !== 'realized' || event.account_id !== accountId || event.asset_id !== assetId) return;
      if (!pfInWindow(event.date, seriesFrom, seriesTo)) return;
      periodRealized.price += event.price;
      periodRealized.fx += event.fx;
      periodRealized.total += event.total;
    });
    if (!(nowBook.qty > 0) && !periodRealized.total && linked.twr === null) return;
    rows.push({
      account_id: accountId,
      account_name: names[accountId] || accountId,
      asset_id: assetId,
      name: asset.name || assetId,
      symbol: asset.symbol || '',
      currency: asset.currency || '',
      asset_class: asset.asset_class || '',
      quantity: nowBook.qty || 0,
      market_value_twd: nowU.market_value_twd === '' ? null : nowU.market_value_twd,
      unrealized_price_twd: nowU.price_effect === '' ? null : nowU.price_effect,
      unrealized_fx_twd: nowU.fx_effect === '' ? null : nowU.fx_effect,
      unrealized_pl_twd: nowU.total === '' ? null : nowU.total,
      realized_price_twd: pfRound2(periodRealized.price),
      realized_fx_twd: pfRound2(periodRealized.fx),
      realized_pl_twd: pfRound2(periodRealized.total),
      twr: pfRate_(linked.twr),
      xirr: pfRate_(xirr),
      is_stale: nowMark.date ? isStaleKind_(nowMark.kind || 'price', nowMark.date, days) : true,
      price_date: nowMark.date || '',
      price_kind: nowMark.kind || ''
    });
  });
  return rows;
}
