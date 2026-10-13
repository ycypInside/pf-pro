/**
 * Pure performance math. No SpreadsheetApp, no UrlFetchApp.
 * Apps Script loads this file as globals. Node tests run it in a vm.
 *
 * Cost: moving average. A buy adds gross+fee+tax. A sell relieves
 * average cost. Transfers move cost and do not book price P&L.
 *
 * TWD split (ending FX on the price, cost FX on the currency move):
 *   price = (local value change) * FX_now
 *   fx    = cost_local * (FX_now - FX_cost)
 *   fx is then adjusted by at most a cent so price + fx = total TWD.
 *
 * TWR links snapshot NAVs. A one-day gap is ordinary daily linking.
 * A longer gap uses Modified Dietz. A flow on the end date has weight 0
 * (it is already inside the ending NAV and earned no return).
 * External principal is a flow. Dividends, interest, and fees are not.
 *
 * XIRR uses Excel's sign (money in is negative) and an actual/365 exponent.
 */

function pfRoundDigits(n, digits) {
  var f = Math.pow(10, digits);
  var x = Number(n);
  if (!isFinite(x)) return 0;
  var rounded = Math.round((Math.abs(x) * f) + 1e-6) / f * (x < 0 ? -1 : 1);
  return rounded === 0 ? 0 : rounded;
}

function pfRound2(n) { return pfRoundDigits(n, 2); }
function pfRound4(n) { return pfRoundDigits(n, 4); }
function pfRound6(n) { return pfRoundDigits(n, 6); }

function pfDaysBetween(fromDate, toDate) {
  var ms = Date.parse(String(toDate) + 'T00:00:00Z') - Date.parse(String(fromDate) + 'T00:00:00Z');
  if (!isFinite(ms)) return 0;
  return Math.round(ms / 86400000);
}

function pfPeriodRange(period, today) {
  var day = String(today || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { from: null, to: day, period: 'ALL' };
  var name = String(period || 'YTD').toUpperCase();
  if (name === 'MTD') return { from: day.slice(0, 8) + '01', to: day, period: 'MTD' };
  if (name === 'YTD') return { from: day.slice(0, 4) + '-01-01', to: day, period: 'YTD' };
  if (name === '1Y') return { from: String(Number(day.slice(0, 4)) - 1) + day.slice(4), to: day, period: '1Y' };
  return { from: null, to: day, period: 'ALL' };
}

function pfEmptyBook(accountId, assetId) {
  return {
    account_id: accountId || '',
    asset_id: assetId || '',
    qty: 0,
    cost: 0,
    costTwd: 0,
    realizedPrice: 0,
    realizedFx: 0,
    realizedTotal: 0,
    feesTwd: 0
  };
}

function pfApplyTrade(books, events, t) {
  var key = t.account_id + '|' + t.asset_id;
  if (!books[key]) books[key] = pfEmptyBook(t.account_id, t.asset_id);
  var b = books[key];
  var q = Number(t.quantity) || 0;
  var gross = Number(t.gross) || 0;
  var fee = Number(t.fee) || 0;
  var tax = Number(t.tax) || 0;
  var fx = Number(t.fx) || 1;
  var feeTwd = pfRound2((fee + tax) * fx);
  var side = t.side;

  if (side === 'buy' || side === 'dividend_reinvest' || side === 'transfer_in') {
    var add = gross + fee + tax;
    var addTwd = pfRound2(add * fx);
    b.cost = pfRound4(b.cost + add);
    b.costTwd = pfRound2(b.costTwd + addTwd);
    b.qty = pfRound4(b.qty + q);
    b.feesTwd = pfRound2(b.feesTwd + feeTwd);
    events.push({ date: t.date, account_id: t.account_id, asset_id: t.asset_id, kind: 'capital', capital: addTwd, fee: feeTwd, price: 0, fx: 0, total: 0 });
    return;
  }

  if (side === 'sell' || side === 'maturity') {
    var avg = b.qty ? b.cost / b.qty : 0;
    var avgT = b.qty ? b.costTwd / b.qty : 0;
    var relieved = avg * q;
    var relievedTwd = avgT * q;
    var proceeds = gross - fee - tax;
    var proceedsTwd = pfRound2(proceeds * fx);
    var total = pfRound2(proceedsTwd - relievedTwd);
    var priceEffect = pfRound2((proceeds - relieved) * fx);
    var fxEffect = pfRound2(total - priceEffect);
    b.realizedPrice = pfRound2(b.realizedPrice + priceEffect);
    b.realizedFx = pfRound2(b.realizedFx + fxEffect);
    b.realizedTotal = pfRound2(b.realizedTotal + total);
    b.feesTwd = pfRound2(b.feesTwd + feeTwd);
    b.cost = pfRound4(Math.max(0, b.cost - relieved));
    b.costTwd = pfRound2(Math.max(0, b.costTwd - relievedTwd));
    b.qty = pfRound4(b.qty - q);
    if (b.qty <= 0.0000001) { b.qty = 0; b.cost = 0; b.costTwd = 0; }
    events.push({ date: t.date, account_id: t.account_id, asset_id: t.asset_id, kind: 'realized', capital: -proceedsTwd, fee: feeTwd, price: priceEffect, fx: fxEffect, total: total });
    return;
  }

  if (side === 'transfer_out') {
    var avgOut = b.qty ? b.cost / b.qty : 0;
    var avgOutT = b.qty ? b.costTwd / b.qty : 0;
    var relievedOut = avgOut * q;
    var relievedOutTwd = avgOutT * q;
    b.feesTwd = pfRound2(b.feesTwd + feeTwd);
    b.cost = pfRound4(Math.max(0, b.cost - relievedOut));
    b.costTwd = pfRound2(Math.max(0, b.costTwd - relievedOutTwd));
    b.qty = pfRound4(b.qty - q);
    if (b.qty <= 0.0000001) { b.qty = 0; b.cost = 0; b.costTwd = 0; }
    events.push({ date: t.date, account_id: t.account_id, asset_id: t.asset_id, kind: 'capital', capital: pfRound2(-relievedOutTwd), fee: feeTwd, price: 0, fx: 0, total: 0 });
    return;
  }

  if (side === 'split') {
    b.qty = pfRound4(b.qty + q);
    if (fee || tax) {
      b.cost = pfRound4(b.cost + fee + tax);
      b.costTwd = pfRound2(b.costTwd + feeTwd);
      b.feesTwd = pfRound2(b.feesTwd + feeTwd);
      events.push({ date: t.date, account_id: t.account_id, asset_id: t.asset_id, kind: 'capital', capital: feeTwd, fee: feeTwd, price: 0, fx: 0, total: 0 });
    }
  }
}

function pfSortTrades(trades) {
  return (trades || []).slice().sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    var ia = String(a.id || '');
    var ib = String(b.id || '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

function pfReplay(trades) {
  var books = {};
  var events = [];
  pfSortTrades(trades).forEach(function (t) { pfApplyTrade(books, events, t); });
  return { books: books, events: events };
}

function pfCloneBooks(books) {
  var out = {};
  Object.keys(books).forEach(function (key) {
    var b = books[key];
    out[key] = {
      account_id: b.account_id,
      asset_id: b.asset_id,
      qty: b.qty,
      cost: b.cost,
      costTwd: b.costTwd,
      realizedPrice: b.realizedPrice,
      realizedFx: b.realizedFx,
      realizedTotal: b.realizedTotal,
      feesTwd: b.feesTwd
    };
  });
  return out;
}

function pfBooksOnDates(trades, dates) {
  var list = pfSortTrades(trades);
  var wanted = (dates || []).slice().sort();
  var books = {};
  var events = [];
  var ti = 0;
  return wanted.map(function (date) {
    while (ti < list.length && list[ti].date <= date) {
      pfApplyTrade(books, events, list[ti]);
      ti++;
    }
    return { date: date, books: pfCloneBooks(books) };
  });
}

function pfUnrealized(book, price, fx) {
  var b = book || pfEmptyBook();
  var avg = b.qty ? pfRound4(b.cost / b.qty) : 0;
  if (!(b.qty > 0) || price === null || price === undefined || price === '' || fx === null || fx === undefined || fx === '') {
    return { market_value: '', market_value_twd: '', price_effect: '', fx_effect: '', total: '', avg_cost: avg, fx_cost: '' };
  }
  var px = Number(price);
  var rate = Number(fx);
  var mv = pfRound4(b.qty * px);
  var mvTwd = pfRound2(mv * rate);
  var total = pfRound2(mvTwd - b.costTwd);
  var priceEffect = pfRound2((px - (b.qty ? b.cost / b.qty : 0)) * b.qty * rate);
  var fxEffect = pfRound2(total - priceEffect);
  var fxCost = b.cost ? b.costTwd / b.cost : rate;
  return {
    market_value: mv,
    market_value_twd: mvTwd,
    price_effect: priceEffect,
    fx_effect: fxEffect,
    total: total,
    avg_cost: avg,
    fx_cost: pfRound4(fxCost)
  };
}

function pfPeriodPnl(trades, marks, from, to) {
  var history = trades || [];
  var startReplay = from
    ? pfReplay(history.filter(function (t) { return t.date <= from; }))
    : { books: {}, events: [] };
  var endReplay = pfReplay(history.filter(function (t) { return !to || t.date <= to; }));
  var keys = {};
  Object.keys(startReplay.books).forEach(function (k) { keys[k] = true; });
  Object.keys(endReplay.books).forEach(function (k) { keys[k] = true; });
  var unrealizedPrice = 0;
  var unrealizedFx = 0;
  var unrealizedTotal = 0;
  var unpriced = [];
  Object.keys(keys).forEach(function (key) {
    var mark = (marks && marks[key]) || {};
    var startBook = startReplay.books[key] || pfEmptyBook();
    var endBook = endReplay.books[key] || pfEmptyBook();
    if (endBook.qty > 0 && (mark.endPrice === null || mark.endPrice === undefined || mark.endFx === null || mark.endFx === undefined)) {
      unpriced.push(key);
      return;
    }
    if (startBook.qty > 0 && (mark.startPrice === null || mark.startPrice === undefined || mark.startFx === null || mark.startFx === undefined)) {
      unpriced.push(key);
      return;
    }
    var startU = pfUnrealized(startBook, startBook.qty > 0 ? mark.startPrice : null, startBook.qty > 0 ? mark.startFx : null);
    var endU = pfUnrealized(endBook, endBook.qty > 0 ? mark.endPrice : null, endBook.qty > 0 ? mark.endFx : null);
    var sp = startU.price_effect === '' ? 0 : startU.price_effect;
    var sf = startU.fx_effect === '' ? 0 : startU.fx_effect;
    var st = startU.total === '' ? 0 : startU.total;
    var ep = endU.price_effect === '' ? 0 : endU.price_effect;
    var ef = endU.fx_effect === '' ? 0 : endU.fx_effect;
    var et = endU.total === '' ? 0 : endU.total;
    unrealizedPrice += ep - sp;
    unrealizedFx += ef - sf;
    unrealizedTotal += et - st;
  });
  var realizedPrice = 0;
  var realizedFx = 0;
  var realizedTotal = 0;
  var tradeFees = 0;
  endReplay.events.forEach(function (ev) {
    if (from && ev.date <= from) return;
    if (to && ev.date > to) return;
    tradeFees += Number(ev.fee) || 0;
    if (ev.kind !== 'realized') return;
    realizedPrice += ev.price;
    realizedFx += ev.fx;
    realizedTotal += ev.total;
  });
  return {
    realized_price: pfRound2(realizedPrice),
    realized_fx: pfRound2(realizedFx),
    realized_total: pfRound2(realizedTotal),
    unrealized_price: pfRound2(unrealizedPrice),
    unrealized_fx: pfRound2(unrealizedFx),
    unrealized_total: pfRound2(unrealizedTotal),
    trade_fees: pfRound2(tradeFees),
    unpriced: unpriced
  };
}

function pfInWindow(date, from, to) {
  if (from && date <= from) return false;
  if (to && date > to) return false;
  return true;
}

function pfActive(row) {
  return !row.status || row.status === 'active';
}

function pfPortfolioFlows(txns, investmentIds, from, to) {
  var set = {};
  (investmentIds || []).forEach(function (id) { set[id] = true; });
  var out = [];
  (txns || []).forEach(function (t) {
    if (!pfActive(t) || !set[t.account_id] || t.trade_id) return;
    if (t.flow_class !== 'external') return;
    if (!pfInWindow(t.date, from, to)) return;
    var amt = Number(t.amount_twd);
    if (!amt) return;
    out.push({ date: t.date, amount: amt, account_id: t.account_id });
  });
  return out;
}

function pfAccountFlows(txns, accountId, from, to) {
  var out = [];
  (txns || []).forEach(function (t) {
    if (!pfActive(t) || t.account_id !== accountId || t.trade_id) return;
    if (!pfInWindow(t.date, from, to)) return;
    if (t.txn_type === 'dividend' || t.txn_type === 'interest' || t.txn_type === 'fee' || t.txn_type === 'tax') return;
    var capital = t.flow_class === 'external' || t.flow_class === 'internal';
    var transfer = t.txn_type === 'transfer_in' || t.txn_type === 'transfer_out' || t.txn_type === 'fx_in' || t.txn_type === 'fx_out';
    if (!capital && !transfer) return;
    var amt = Number(t.amount_twd);
    if (!amt) return;
    out.push({ date: t.date, amount: amt, account_id: accountId });
  });
  return out;
}

function pfIncome(txns, from, to, investmentIds) {
  var set = null;
  if (investmentIds) {
    set = {};
    investmentIds.forEach(function (id) { set[id] = true; });
  }
  var dividends = 0;
  var interest = 0;
  var fees = 0;
  (txns || []).forEach(function (t) {
    if (!pfActive(t)) return;
    if (set && !set[t.account_id]) return;
    if (!pfInWindow(t.date, from, to)) return;
    var amt = Number(t.amount_twd) || 0;
    if (t.txn_type === 'dividend') dividends += amt;
    else if (t.txn_type === 'interest') interest += amt;
    else if (t.txn_type === 'fee' || t.txn_type === 'tax') fees += -amt;
  });
  return { dividends: pfRound2(dividends), interest: pfRound2(interest), fees: pfRound2(fees) };
}

function pfClassifyCashflow(txn, isInvestment) {
  if (!txn || !pfActive(txn) || txn.trade_id) return '';
  if (txn.txn_type === 'dividend') return 'income_dividend';
  if (txn.txn_type === 'interest') return 'income_interest';
  if (txn.txn_type === 'fee') return 'fee';
  if (txn.txn_type === 'tax') return 'tax';
  if (!isInvestment) return '';
  if (txn.flow_class === 'external') return Number(txn.amount) >= 0 ? 'external_contribution' : 'external_withdrawal';
  if (txn.flow_class === 'internal') return 'internal_transfer';
  if (txn.flow_class === 'investment_income') return txn.txn_type === 'interest' ? 'income_interest' : 'income_dividend';
  if (txn.flow_class === 'investment_cost') return txn.txn_type === 'tax' ? 'tax' : 'fee';
  return '';
}

function pfModifiedDietz(bmv, emv, flows, start, end, income) {
  var days = pfDaysBetween(start, end);
  var cf = 0;
  var weighted = 0;
  (flows || []).forEach(function (f) {
    if (!pfInWindow(f.date, start, end)) return;
    var w = days > 0 ? pfDaysBetween(f.date, end) / days : 0;
    cf += Number(f.amount) || 0;
    weighted += (Number(f.amount) || 0) * w;
  });
  var extra = 0;
  (income || []).forEach(function (f) {
    if (!pfInWindow(f.date, start, end)) return;
    extra += Number(f.amount) || 0;
  });
  var gain = Number(emv) - Number(bmv) - cf + extra;
  var denom = Math.abs(Number(bmv)) < 1e-6 ? cf : Number(bmv) + weighted;
  if (Math.abs(denom) < 1e-8) {
    return { r: Math.abs(gain) < 1e-6 ? 0 : null, gain: gain, cashflow: cf, denominator: denom };
  }
  return { r: gain / denom, gain: gain, cashflow: cf, denominator: denom };
}

function pfLinkedTwr(points, flows, income) {
  var series = [];
  if (!points || points.length < 2) {
    if (points && points.length === 1) {
      series.push({ date: points[0].date, nav: Number(points[0].nav) || 0, index: 1, drawdown: 0, sub_return: 0, link: 'start' });
    }
    return { twr: null, series: series, max_drawdown: null, gaps: [] };
  }
  var growth = 1;
  var peak = 1;
  var peakDate = points[0].date;
  var maxDd = 0;
  var ddPeak = points[0].date;
  var ddTrough = points[0].date;
  var gaps = [];
  series.push({ date: points[0].date, nav: Number(points[0].nav) || 0, index: 1, drawdown: 0, sub_return: 0, link: 'start' });
  for (var i = 1; i < points.length; i++) {
    var span = pfDaysBetween(points[i - 1].date, points[i].date);
    var dietz = pfModifiedDietz(points[i - 1].nav, points[i].nav, flows, points[i - 1].date, points[i].date, income);
    var r = dietz.r;
    if (r === null) {
      gaps.push(points[i].date);
      r = 0;
    }
    growth *= (1 + r);
    if (growth > peak) {
      peak = growth;
      peakDate = points[i].date;
    }
    var dd = peak ? growth / peak - 1 : 0;
    if (dd < maxDd) {
      maxDd = dd;
      ddPeak = peakDate;
      ddTrough = points[i].date;
    }
    series.push({
      date: points[i].date,
      nav: Number(points[i].nav) || 0,
      index: growth,
      drawdown: dd,
      sub_return: r,
      link: span === 1 ? 'daily' : 'dietz'
    });
  }
  return {
    twr: growth - 1,
    series: series,
    max_drawdown: { value: maxDd, peak_date: ddPeak, trough_date: ddTrough },
    gaps: gaps
  };
}

function pfXirrSchedule(flows, startNav, startDate, endNav, endDate) {
  var rows = [];
  if (startDate && isFinite(Number(startNav))) rows.push({ date: startDate, amount: -Number(startNav) });
  (flows || []).forEach(function (f) {
    if (!pfInWindow(f.date, startDate, endDate)) return;
    rows.push({ date: f.date, amount: -Number(f.amount) });
  });
  if (endDate && isFinite(Number(endNav))) rows.push({ date: endDate, amount: Number(endNav) });
  var map = {};
  rows.forEach(function (r) {
    map[r.date] = (map[r.date] || 0) + r.amount;
  });
  return Object.keys(map).sort().map(function (date) {
    return { date: date, amount: map[date] };
  }).filter(function (r) { return Math.abs(r.amount) > 1e-8; });
}

function pfXirr(cashflows, guess) {
  var flows = (cashflows || []).filter(function (f) { return f && f.date && Math.abs(Number(f.amount)) > 1e-8; })
    .slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  if (flows.length < 2) return null;
  var hasPos = false;
  var hasNeg = false;
  flows.forEach(function (f) {
    if (Number(f.amount) > 0) hasPos = true;
    if (Number(f.amount) < 0) hasNeg = true;
  });
  if (!hasPos || !hasNeg) return null;
  var d0 = flows[0].date;
  function years(date) { return pfDaysBetween(d0, date) / 365; }
  function valueAt(rate) {
    var sum = 0;
    for (var i = 0; i < flows.length; i++) sum += Number(flows[i].amount) / Math.pow(1 + rate, years(flows[i].date));
    return sum;
  }
  function slopeAt(rate) {
    var sum = 0;
    for (var i = 0; i < flows.length; i++) {
      var t = years(flows[i].date);
      sum += -t * Number(flows[i].amount) / Math.pow(1 + rate, t + 1);
    }
    return sum;
  }
  var seeds = [guess === undefined ? 0.1 : guess, 0.1, -0.2, 0.5, -0.5, 1];
  for (var s = 0; s < seeds.length; s++) {
    if (seeds[s] === undefined || seeds[s] === null) continue;
    var rate = Number(seeds[s]);
    if (!isFinite(rate) || rate <= -0.999999) continue;
    for (var n = 0; n < 60; n++) {
      var y = valueAt(rate);
      var slope = slopeAt(rate);
      if (!isFinite(y)) break;
      if (Math.abs(y) < 1e-8) return rate;
      if (!isFinite(slope) || Math.abs(slope) < 1e-12) break;
      var next = rate - y / slope;
      if (!isFinite(next) || next <= -0.999999) next = (rate - 0.9) / 2;
      if (Math.abs(next - rate) < 1e-10) return next;
      rate = next;
    }
  }
  return null;
}

function pfNormalizeTarget(target) {
  var out = {};
  if (!target || typeof target !== 'object') return out;
  var keys = Object.keys(target);
  var max = 0;
  keys.forEach(function (key) {
    var n = Number(target[key]);
    if (isFinite(n) && n > max) max = n;
  });
  var scale = max > 1.5 ? 100 : 1;
  keys.forEach(function (key) {
    var n = Number(target[key]);
    if (!isFinite(n)) return;
    out[key] = n / scale;
  });
  return out;
}

function pfBucket(assetClass, target) {
  var name = assetClass || 'other';
  if (name === 'etf') return 'stock';
  if (name === 'cash_equiv') return 'cash';
  if (name === 'fund' && !(target && Object.prototype.hasOwnProperty.call(target, 'fund'))) return 'stock';
  return name;
}

function pfAllocation(amounts, target, bandPct) {
  var weights = pfNormalizeTarget(target);
  var actual = {};
  var total = 0;
  Object.keys(amounts || {}).forEach(function (key) {
    var n = Number(amounts[key]) || 0;
    actual[key] = (actual[key] || 0) + n;
    total += n;
  });
  var keys = {};
  Object.keys(weights).forEach(function (key) { keys[key] = true; });
  Object.keys(actual).forEach(function (key) { keys[key] = true; });
  var band = Number(bandPct);
  if (!isFinite(band) || band < 0) band = 5;
  var rows = Object.keys(keys).sort().map(function (key) {
    var amount = actual[key] || 0;
    var actualWeight = total ? amount / total : 0;
    var targetWeight = weights[key] || 0;
    var drift = actualWeight - targetWeight;
    var trade = total ? (targetWeight - actualWeight) * total : 0;
    return {
      bucket: key,
      actual_twd: pfRound2(amount),
      actual_weight: actualWeight,
      target_weight: targetWeight,
      drift: drift,
      trade_twd: pfRound2(trade),
      alert: Math.abs(drift) > band / 100 + 1e-12
    };
  });
  return { total_twd: pfRound2(total), band_pct: band, rows: rows };
}

function pfCashOnDates(accounts, txns, dates) {
  var list = (txns || []).filter(pfActive).slice().sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.txn_id || '') < String(b.txn_id || '') ? -1 : 1;
  });
  var wanted = (dates || []).slice().sort();
  var bal = {};
  var opened = {};
  (accounts || []).forEach(function (a) { bal[a.account_id] = 0; });
  var ti = 0;
  return wanted.map(function (date) {
    (accounts || []).forEach(function (a) {
      if (opened[a.account_id]) return;
      if (a.opening_date && a.opening_date <= date) {
        bal[a.account_id] = pfRound4((bal[a.account_id] || 0) + (Number(a.opening_balance) || 0));
        opened[a.account_id] = true;
      }
    });
    while (ti < list.length && list[ti].date <= date) {
      var txn = list[ti++];
      if (bal[txn.account_id] === undefined) bal[txn.account_id] = 0;
      bal[txn.account_id] = pfRound4(bal[txn.account_id] + (Number(txn.amount) || 0));
    }
    var snap = {};
    Object.keys(bal).forEach(function (id) { snap[id] = bal[id]; });
    return { date: date, balances: snap };
  });
}

function pfLevelOn(rows, date) {
  var best = null;
  (rows || []).forEach(function (row) {
    if (!row || !row.date || row.date > date) return;
    if (!best || row.date >= best.date) best = row;
  });
  return best;
}

function pfBenchmarkReturn(levels, from, to, fxLevels) {
  var end = to ? pfLevelOn(levels, to) : null;
  var start = from ? pfLevelOn(levels, from) : null;
  if (!start) {
    (levels || []).forEach(function (row) {
      if (!row || !row.date || (from && row.date < from) || (to && row.date > to)) return;
      if (!start || row.date < start.date) start = row;
    });
  }
  if (!end) {
    (levels || []).forEach(function (row) {
      if (!row || !row.date || (to && row.date > to)) return;
      if (!end || row.date >= end.date) end = row;
    });
  }
  if (!start || !end || !Number(start.value) || start.date > end.date) return null;
  var local = Number(end.value) / Number(start.value) - 1;
  if (!fxLevels || !fxLevels.length) {
    return { local: local, twd: local, start_date: start.date, end_date: end.date };
  }
  var startFx = pfLevelOn(fxLevels, start.date);
  var endFx = pfLevelOn(fxLevels, end.date);
  if (!startFx || !endFx || !Number(startFx.value) || !Number(endFx.value)) {
    return { local: local, twd: null, start_date: start.date, end_date: end.date };
  }
  return {
    local: local,
    twd: (Number(end.value) * Number(endFx.value)) / (Number(start.value) * Number(startFx.value)) - 1,
    start_date: start.date,
    end_date: end.date
  };
}

function pfBenchmarkSeries(dates, levels, fxLevels) {
  var base = null;
  var baseFx = 1;
  return (dates || []).map(function (date) {
    var level = pfLevelOn(levels, date);
    if (!level || !Number(level.value)) return { date: date, index: null };
    var fx = 1;
    if (fxLevels && fxLevels.length) {
      var fxRow = pfLevelOn(fxLevels, date);
      if (!fxRow || !Number(fxRow.value)) return { date: date, index: null };
      fx = Number(fxRow.value);
    }
    if (!base) { base = Number(level.value); baseFx = fx; }
    return { date: date, index: (Number(level.value) * fx) / (base * baseFx) };
  });
}
