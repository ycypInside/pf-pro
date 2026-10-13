/**
 * Phase 3 reads. Facts (transactions, trades, prices) are never overwritten.
 * Cashflows is rebuilt. Benchmarks are append-only. Performance itself is computed on read.
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
  var accounts = perfAccounts_();
  var invIds = accounts.filter(function (a) { return a.is_investment; }).map(function (a) { return a.account_id; });
  var trades = perfTrades_();
  var txns = perfTxns_();
  var assets = assetsById_();
  var priceRows = readTable_('Prices_FX');
  var snapshots = readTable_('Snapshots');
  var boundary = range.from ? dayBefore_(range.from) : null;
  var dates = perfDates_(boundary, range.to, snapshots, trades);
  var bookSnaps = pfBooksOnDates(trades, dates);
  var cashSnaps = pfCashOnDates(accounts, txns, dates);
  var booksByDate = {};
  var cashByDate = {};
  bookSnaps.forEach(function (snap) { booksByDate[snap.date] = snap.books; });
  cashSnaps.forEach(function (snap) { cashByDate[snap.date] = snap; });
  var built = portfolioPoints_(dates, snapshots, accounts, booksByDate, cashByDate, assets, priceRows, range.to);
  var points = built.points;
  var warnings = built.warnings.slice();
  var linkFrom = points.length ? points[0].date : range.from;
  var linkTo = points.length ? points[points.length - 1].date : range.to;
  var linkFlows = pfPortfolioFlows(txns, invIds, linkFrom, linkTo);
  var linked = pfLinkedTwr(points, linkFlows);
  if (linked.gaps.length) warnings.push('有一段淨值的報酬分母是 0，該段先以 0 連結。');
  var schedule = points.length >= 2
    ? pfXirrSchedule(linkFlows, points[0].nav, points[0].date, points[points.length - 1].nav, points[points.length - 1].date)
    : [];
  var shownFlows = pfPortfolioFlows(txns, invIds, boundary, range.to);
  var contribution = 0;
  var withdrawal = 0;
  shownFlows.forEach(function (f) {
    if (f.amount > 0) contribution += f.amount;
    else withdrawal += f.amount;
  });
  var marks = perfMarks_(trades, assets, priceRows, boundary, range.to);
  var pnl = pfPeriodPnl(trades, marks, boundary, range.to);
  if (pnl.unpriced.length) warnings.push('有持倉在區間端點缺少報價，未實現損益不含該部位。');
  var income = pfIncome(txns, boundary, range.to, invIds);
  var bench = benchmarkView_(benchmarkId, points.map(function (p) { return p.date; }), linkFrom, linkTo);
  if (bench.id && bench.twd_return === null && bench.local_return === null) warnings.push('這個區間還沒有 ' + bench.id + ' 的指標價格。');
  var benchByDate = {};
  (bench.series || []).forEach(function (row) { benchByDate[row.date] = row.index; });
  var accountRows = accountMetrics_(accounts, points, cashByDate, booksByDate, assets, priceRows, txns);
  var holdingRows = holdingMetrics_(points, booksByDate, assets, priceRows, trades, txns, boundary, range.to);
  var prices = pricesPayload_();
  var staleHoldings = holdingRows.filter(function (h) { return h.is_stale; }).length;
  if (staleHoldings) warnings.push('有 ' + staleHoldings + ' 檔持倉的報價已過期。');
  return {
    ok: true,
    period: range.period,
    from: range.from,
    to: range.to,
    method: built.method,
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
    rows: alloc.rows,
    estimated: estimated,
    stale_count: (prices.stale || []).length,
    last_valuations: prices.last_valuations || [],
    missing_fx: (balances.net_worth && balances.net_worth.missing_fx) || []
  };
}

function perfAccounts_() {
  return readTable_('Accounts').filter(function (a) { return a.status !== 'closed'; }).map(function (a) {
    return {
      account_id: a.account_id,
      name: a.name || a.account_id,
      type: a.type,
      currency: a.currency,
      opening_balance: num_(a.opening_balance),
      opening_date: fmtDate_(a.opening_date),
      is_investment: String(a.is_investment).toUpperCase() === 'TRUE',
      status: a.status
    };
  });
}

function perfTrades_() {
  return readTable_('Investment_Trades').filter(function (t) { return t.status === 'active'; }).map(function (t) {
    return {
      id: t.trade_id, date: fmtDate_(t.trade_date), account_id: t.account_id, asset_id: t.asset_id, side: t.side,
      quantity: num_(t.quantity), gross: num_(t.gross_amount), fee: num_(t.fee), tax: num_(t.tax), fx: num_(t.fx_rate) || 1
    };
  });
}

function perfTxns_() {
  return readTable_('Transactions').filter(function (t) { return t.status === 'active'; }).map(function (t) {
    return {
      txn_id: t.txn_id, date: fmtDate_(t.date), account_id: t.account_id, amount: num_(t.amount),
      amount_twd: num_(t.amount_twd), flow_class: t.flow_class, trade_id: t.trade_id || '',
      txn_type: t.txn_type, status: t.status, asset_id: t.asset_id || '', currency: t.currency
    };
  });
}

function dayBefore_(date) {
  return Utilities.formatDate(new Date(Date.parse(date + 'T00:00:00Z') - 86400000), 'UTC', 'yyyy-MM-dd');
}

function perfDates_(from, to, snapshots, trades) {
  var set = {};
  if (from) set[from] = true;
  (snapshots || []).forEach(function (s) {
    var d = fmtDate_(s.snapshot_date);
    if (!d || d > to) return;
    if (from && d < from) return;
    set[d] = true;
  });
  var hasSpan = Object.keys(set).length > (from ? 1 : 0);
  if (!hasSpan) {
    (trades || []).forEach(function (t) {
      if (t.date && t.date <= to && (!from || t.date >= from)) set[t.date] = true;
    });
  }
  set[to] = true;
  return Object.keys(set).sort();
}

function portfolioPoints_(dates, snapshots, accounts, booksByDate, cashByDate, assets, priceRows, today) {
  var snapNav = {};
  (snapshots || []).forEach(function (s) {
    var d = fmtDate_(s.snapshot_date);
    if (!d || s.investments_twd === '' || s.investments_twd === null || s.investments_twd === undefined) return;
    snapNav[d] = num_(s.investments_twd);
  });
  var snapPoints = [];
  dates.forEach(function (d) {
    if (Object.prototype.hasOwnProperty.call(snapNav, d)) snapPoints.push({ date: d, nav: snapNav[d], source: 'snapshot' });
  });
  var allZero = snapPoints.length > 0 && snapPoints.every(function (p) { return !p.nav; });
  var warnings = [];
  if (snapPoints.length >= 2 && !allZero) {
    var points = snapPoints.slice();
    var first = dates[0];
    if (first && points[0].date !== first && booksByDate[first]) {
      points.unshift({ date: first, nav: investmentNav_(first, accounts, cashByDate[first], booksByDate[first], assets, priceRows), source: 'computed' });
    }
    if (points[points.length - 1].date !== today && booksByDate[today]) {
      points.push({ date: today, nav: investmentNav_(today, accounts, cashByDate[today], booksByDate[today], assets, priceRows), source: 'computed' });
    }
    if (points[points.length - 1].source === 'computed') warnings.push('今天還沒有快照，最新一點用持倉與現金推算。');
    return { method: 'snapshot', points: points, warnings: warnings };
  }
  warnings.push('這個區間的快照不足兩點，報酬改由交易與報價推算。');
  return {
    method: 'computed',
    points: dates.map(function (d) {
      return { date: d, nav: investmentNav_(d, accounts, cashByDate[d], booksByDate[d], assets, priceRows), source: 'computed' };
    }),
    warnings: warnings
  };
}

function investmentNav_(date, accounts, cashSnap, books, assets, priceRows) {
  var cash = 0;
  accounts.forEach(function (a) {
    if (!a.is_investment || a.type === 'loan' || a.type === 'credit_card') return;
    var local = cashSnap && cashSnap.balances ? Number(cashSnap.balances[a.account_id] || 0) : 0;
    var fx = fxOn_(a.currency, date, priceRows);
    if (fx === null) return;
    cash += pfRound2(local * fx);
  });
  return pfRound2(cash + valueBooks_(books || {}, date, assets, priceRows).total);
}

function accountNav_(account, date, cashSnap, books, assets, priceRows) {
  var local = cashSnap && cashSnap.balances ? Number(cashSnap.balances[account.account_id] || 0) : 0;
  var fx = fxOn_(account.currency, date, priceRows);
  if (fx === null) return null;
  var subset = {};
  Object.keys(books || {}).forEach(function (key) {
    if (books[key].account_id === account.account_id) subset[key] = books[key];
  });
  return pfRound2(pfRound2(local * fx) + valueBooks_(subset, date, assets, priceRows).total);
}

function valueBooks_(books, date, assets, priceRows) {
  var total = 0;
  Object.keys(books || {}).forEach(function (key) {
    var book = books[key];
    if (!(book.qty > 0)) return;
    var mark = markOn_(assets[book.asset_id] || {}, date, priceRows);
    var unrealized = pfUnrealized(book, mark.price, mark.fx);
    if (unrealized.market_value_twd !== '') total += unrealized.market_value_twd;
  });
  return { total: pfRound2(total) };
}

function fxOn_(currency, date, rows) {
  if (!currency || currency === 'TWD') return 1;
  var best = null;
  var bestDate = '';
  (rows || []).forEach(function (p) {
    if (p.kind !== 'fx' || p.symbol !== currency + 'TWD') return;
    var d = fmtDate_(p.date);
    if (!d || d > date) return;
    if (!bestDate || d >= bestDate) { best = num_(p.value); bestDate = d; }
  });
  return best;
}

function markOn_(asset, date, rows) {
  var prior = [];
  (rows || []).forEach(function (p) { if (fmtDate_(p.date) <= date) prior.push(p); });
  var quote = pickQuote_(asset || {}, indexQuotes_(prior));
  var ccy = (asset && asset.currency) || (quote && quote.currency) || '';
  return {
    price: quote ? num_(quote.value) : null,
    fx: fxOn_(ccy, date, rows),
    kind: quote ? quote.kind : '',
    date: quote ? fmtDate_(quote.date) : ''
  };
}

function perfMarks_(trades, assets, priceRows, from, to) {
  var keys = {};
  Object.keys(pfReplay(trades).books).forEach(function (key) { keys[key] = true; });
  if (from) {
    Object.keys(pfReplay(trades.filter(function (t) { return t.date <= from; })).books).forEach(function (key) { keys[key] = true; });
  }
  var marks = {};
  Object.keys(keys).forEach(function (key) {
    var assetId = key.split('|')[1];
    var asset = assets[assetId] || {};
    var start = from ? markOn_(asset, from, priceRows) : { price: null, fx: null };
    var end = markOn_(asset, to, priceRows);
    marks[key] = { startPrice: start.price, startFx: start.fx, endPrice: end.price, endFx: end.fx };
  });
  return marks;
}

function accountMetrics_(accounts, points, cashByDate, booksByDate, assets, priceRows, txns) {
  var rows = [];
  accounts.forEach(function (account) {
    if (!account.is_investment || account.type === 'loan' || account.type === 'credit_card') return;
    var series = [];
    points.forEach(function (point) {
      var nav = accountNav_(account, point.date, cashByDate[point.date], booksByDate[point.date], assets, priceRows);
      if (nav === null) return;
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

function holdingMetrics_(points, booksByDate, assets, priceRows, trades, txns, from, to) {
  var events = pfReplay(trades).events;
  var latest = points.length ? booksByDate[points[points.length - 1].date] || {} : {};
  var keys = {};
  Object.keys(latest).forEach(function (key) { if (latest[key].qty > 0) keys[key] = true; });
  events.forEach(function (ev) {
    if (!points.length) return;
    if (ev.date > points[0].date && ev.date <= points[points.length - 1].date) keys[ev.account_id + '|' + ev.asset_id] = true;
  });
  var names = {};
  readTable_('Accounts').forEach(function (a) { names[a.account_id] = a.name || a.account_id; });
  var days = staleDaysMap_();
  var rows = [];
  Object.keys(keys).sort().forEach(function (key) {
    var sample = latest[key] || { account_id: key.split('|')[0], asset_id: key.split('|')[1], qty: 0 };
    var asset = assets[sample.asset_id] || {};
    var series = [];
    var closed = false;
    points.forEach(function (point) {
      var book = (booksByDate[point.date] || {})[key];
      if (!book || !(book.qty > 0)) {
        if (series.length && !closed) {
          series.push({ date: point.date, nav: 0 });
          closed = true;
        }
        return;
      }
      closed = false;
      var mark = markOn_(asset, point.date, priceRows);
      var unrealized = pfUnrealized(book, mark.price, mark.fx);
      if (unrealized.market_value_twd === '') return;
      series.push({ date: point.date, nav: unrealized.market_value_twd });
    });
    var from = series.length ? series[0].date : null;
    var to = series.length ? series[series.length - 1].date : null;
    var flows = events.filter(function (ev) {
      return ev.account_id === sample.account_id && ev.asset_id === sample.asset_id && pfInWindow(ev.date, from, to);
    }).map(function (ev) { return { date: ev.date, amount: ev.capital }; });
    var income = txns.filter(function (t) {
      return t.account_id === sample.account_id && t.asset_id === sample.asset_id && (t.txn_type === 'dividend' || t.txn_type === 'interest') && pfInWindow(t.date, from, to);
    }).map(function (t) { return { date: t.date, amount: t.amount_twd }; });
    var linked = pfLinkedTwr(series, flows, income);
    var endNav = series.length ? series[series.length - 1].nav : 0;
    var xirrFlows = flows.concat(income.map(function (row) { return { date: row.date, amount: -row.amount }; }));
    var xirr = series.length >= 2 ? pfXirr(pfXirrSchedule(xirrFlows, series[0].nav, series[0].date, endNav, series[series.length - 1].date)) : null;
    var nowBook = latest[key] || pfEmptyBook(sample.account_id, sample.asset_id);
    var nowMark = points.length ? markOn_(asset, points[points.length - 1].date, priceRows) : { price: null, fx: null, kind: '', date: '' };
    var nowU = pfUnrealized(nowBook, nowMark.price, nowMark.fx);
    var periodRealized = { price: 0, fx: 0, total: 0 };
    events.forEach(function (ev) {
      if (ev.kind !== 'realized' || ev.account_id !== sample.account_id || ev.asset_id !== sample.asset_id) return;
      if (!pfInWindow(ev.date, from, to)) return;
      periodRealized.price += ev.price;
      periodRealized.fx += ev.fx;
      periodRealized.total += ev.total;
    });
    if (!(nowBook.qty > 0) && !periodRealized.total && linked.twr === null) return;
    rows.push({
      account_id: sample.account_id,
      account_name: names[sample.account_id] || sample.account_id,
      asset_id: sample.asset_id,
      name: asset.name || sample.asset_id,
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

function targetSettings_() {
  var saved = settings_();
  var target = { stock: 0.6, bond: 0.2, cash: 0.2 };
  var set = false;
  if (saved.target_allocation) {
    try {
      var parsed = typeof saved.target_allocation === 'string' ? JSON.parse(saved.target_allocation) : saved.target_allocation;
      if (parsed && typeof parsed === 'object') { target = parsed; set = true; }
    } catch (err) { /* keep the default mix */ }
  }
  var band = Number(saved.rebalance_band_pct);
  if (!isFinite(band) || band <= 0) band = 5;
  return { target: target, band: band, set: set };
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
  var rows = [];
  readTable_('Transactions').forEach(function (t) {
    if (t.status !== 'active') return;
    var acc = accounts[t.account_id];
    var inv = !!(acc && String(acc.is_investment).toUpperCase() === 'TRUE');
    var cls = pfClassifyCashflow({
      status: t.status, trade_id: t.trade_id || '', txn_type: t.txn_type,
      flow_class: t.flow_class, amount: num_(t.amount)
    }, inv);
    if (!cls) return;
    rows.push({
      cf_id: 'CF-' + String(t.txn_id || '').replace(/^TX-/, ''),
      date: fmtDate_(t.date),
      scope: inv ? 'investment' : 'household',
      account_id: t.account_id,
      direction: num_(t.amount) >= 0 ? 'in' : 'out',
      amount_twd: num_(t.amount_twd),
      amount: num_(t.amount),
      currency: t.currency,
      fx_rate: num_(t.fx_rate) || 1,
      cf_class: cls,
      source_txn_id: t.txn_id
    });
  });
  replaceBody_('Cashflows', rows);
  return rows.length;
}

/** Append public index levels. Existing benchmark_id + date rows are left as they are. */
function fetchBenchmarks() {
  beginRequest_();
  return fetchBenchmarksBody_();
}

function fetchBenchmarksBody_() {
  var added = 0;
  var warnings = [];
  benchmarkSymbols_().forEach(function (symbol) {
    try {
      var rows = fetchBenchmarkSeries_(symbol);
      added += appendBenchmarkRows_(symbol, rows);
    } catch (err) {
      warnings.push(symbol + ': ' + err.message);
    }
  });
  return { ids: [], added: added, warnings: warnings };
}

function fetchBenchmarkSeries_(symbol) {
  try { return fetchYahooDaily_(symbol); }
  catch (err) {
    var matched = /^(\d{4,6})\.TW$/i.exec(symbol);
    if (!matched) throw err;
    return fetchTwseDaily_(matched[1]);
  }
}

function fetchYahooDaily_(symbol) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=2y';
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

function fetchTwseDaily_(stockNo) {
  var out = [];
  var today = new Date();
  for (var i = 0; i < 4; i++) {
    var month = new Date(today.getFullYear(), today.getMonth() - i, 1);
    var ymd = Utilities.formatDate(month, CONFIG.TZ, 'yyyyMM') + '01';
    var url = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=' + ymd + '&stockNo=' + stockNo;
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) continue;
    var body = JSON.parse(res.getContentText());
    (body.data || []).forEach(function (row) {
      var date = rocDate_(row[0]);
      var close = Number(String(row[6] || '').replace(/,/g, ''));
      if (date && isFinite(close)) out.push({ date: date, value: close, currency: 'TWD', total_return: false, source: 'twse' });
    });
    if (i < 3) Utilities.sleep(300);
  }
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
