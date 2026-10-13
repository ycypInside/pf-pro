/**
 * Phase 2 market data, holdings, and the reads/writes the web client needs.
 * Formulas for trade cash (buy/sell net) match web/js/money.js.
 * Prices_FX stays append-only. Holdings is computed and replaced on each rebuild.
 */

function staleDaysMap_() {
  var s = settings_();
  return {
    price: Number(s.stale_days_price || 3),
    nav: Number(s.stale_days_fund || 7),
    bond_valuation: Number(s.stale_days_bond || 45),
    fx: Number(s.stale_days_price || 3)
  };
}

function isStaleKind_(kind, dateStr, days) {
  var map = days || staleDaysMap_();
  var limit = map[kind] !== undefined ? map[kind] : map.price;
  return daysBetween_(dateStr, today_()) > limit;
}

function indexQuotes_(rows) {
  var best = {};
  rows.forEach(function (p) {
    if (!p.symbol || !p.kind) return;
    var k = p.symbol + '|' + p.kind;
    if (!best[k] || quoteNewer_(p, best[k])) best[k] = p;
  });
  return best;
}

function quoteNewer_(a, b) {
  var da = fmtDate_(a.date), db = fmtDate_(b.date);
  if (da !== db) return da > db;
  return String(a.fetched_at || '') >= String(b.fetched_at || '');
}

function assetsById_() {
  var m = {};
  readTable_('Assets').forEach(function (a) { m[a.asset_id] = a; });
  return m;
}

function pickQuote_(asset, idx) {
  var symbols = [];
  if (asset.symbol) symbols.push(asset.symbol);
  if (asset.asset_id && symbols.indexOf(asset.asset_id) < 0) symbols.push(asset.asset_id);
  var kinds = asset.asset_class === 'fund' ? ['nav', 'price']
    : asset.asset_class === 'bond' ? ['bond_valuation', 'price']
    : ['price', 'nav', 'bond_valuation'];
  for (var i = 0; i < symbols.length; i++) {
    for (var j = 0; j < kinds.length; j++) {
      var hit = idx[symbols[i] + '|' + kinds[j]];
      if (hit) return hit;
    }
  }
  return null;
}

function latestFxFromIndex_(currency, idx) {
  if (currency === 'TWD') return { value: 1, date: today_(), is_stale: false };
  var row = idx[currency + 'TWD|fx'];
  if (!row) return null;
  return { value: num_(row.value), date: fmtDate_(row.date), is_stale: isStaleKind_('fx', row.date) };
}

/** Cash that actually leaves or enters the brokerage. Share transfers and splits only move fees. */
function cashNetForSide_(side, gross, fee, tax) {
  if (side === 'buy' || side === 'dividend_reinvest') return round4_(-(gross + fee + tax));
  if (side === 'sell' || side === 'maturity') return round4_(gross - fee - tax);
  return round4_(-(fee + tax));
}

function heldQty_(accountId, assetId) {
  var qty = 0;
  readTable_('Investment_Trades').forEach(function (t) {
    if (t.status !== 'active' || t.account_id !== accountId || t.asset_id !== assetId) return;
    var q = num_(t.quantity);
    if (t.side === 'buy' || t.side === 'dividend_reinvest' || t.side === 'transfer_in' || t.side === 'split') qty += q;
    else if (t.side === 'sell' || t.side === 'maturity' || t.side === 'transfer_out') qty -= q;
  });
  return round4_(qty);
}

function computeHoldings_() {
  var assets = assetsById_();
  var trades = readTable_('Investment_Trades').filter(function (t) { return t.status === 'active'; });
  trades.sort(function (a, b) {
    var da = fmtDate_(a.trade_date), db = fmtDate_(b.trade_date);
    if (da !== db) return da < db ? -1 : 1;
    return String(a.trade_id) < String(b.trade_id) ? -1 : 1;
  });
  var book = {};
  trades.forEach(function (t) {
    var key = t.account_id + '|' + t.asset_id;
    if (!book[key]) book[key] = { account_id: t.account_id, asset_id: t.asset_id, qty: 0, cost: 0, costTwd: 0 };
    var b = book[key];
    var q = num_(t.quantity);
    var gross = num_(t.gross_amount);
    var fee = num_(t.fee);
    var tax = num_(t.tax);
    var fx = num_(t.fx_rate) || 1;
    var side = t.side;
    if (side === 'buy' || side === 'dividend_reinvest' || side === 'transfer_in') {
      var add = gross + fee + tax;
      b.cost = round4_(b.cost + add);
      b.costTwd = round2_(b.costTwd + round2_(add * fx));
      b.qty = round4_(b.qty + q);
    } else if (side === 'sell' || side === 'maturity' || side === 'transfer_out') {
      var avg = b.qty ? b.cost / b.qty : 0;
      var avgT = b.qty ? b.costTwd / b.qty : 0;
      b.cost = round4_(Math.max(0, b.cost - avg * q));
      b.costTwd = round2_(Math.max(0, b.costTwd - avgT * q));
      b.qty = round4_(b.qty - q);
      if (b.qty <= 0.0000001) { b.qty = 0; b.cost = 0; b.costTwd = 0; }
    } else if (side === 'split') {
      b.qty = round4_(b.qty + q);
      if (fee || tax) {
        b.cost = round4_(b.cost + fee + tax);
        b.costTwd = round2_(b.costTwd + round2_((fee + tax) * fx));
      }
    }
  });

  var idx = indexQuotes_(readTable_('Prices_FX'));
  var days = staleDaysMap_();
  var asOf = today_();
  var out = [];
  Object.keys(book).forEach(function (key) {
    var b = book[key];
    if (!(b.qty > 0)) return;
    var asset = assets[b.asset_id] || {};
    var quote = pickQuote_(asset, idx);
    var ccy = asset.currency || (quote ? quote.currency : '');
    var price = quote ? num_(quote.value) : '';
    var priceDate = quote ? fmtDate_(quote.date) : '';
    var stale = quote ? isStaleKind_(quote.kind, quote.date, days) : true;
    var fx = latestFxFromIndex_(ccy, idx);
    var fxRate = fx ? fx.value : null;
    var mv = price === '' ? '' : round4_(b.qty * price);
    var mvTwd = (mv === '' || !fxRate) ? '' : round2_(mv * fxRate);
    out.push({
      account_id: b.account_id,
      asset_id: b.asset_id,
      as_of: asOf,
      quantity: b.qty,
      avg_cost: b.qty ? round4_(b.cost / b.qty) : 0,
      cost_basis: round4_(b.cost),
      cost_basis_twd: round2_(b.costTwd),
      last_price: price,
      price_date: priceDate,
      is_stale: stale,
      market_value: mv,
      market_value_twd: mvTwd,
      unrealized_pl_twd: mvTwd === '' ? '' : round2_(mvTwd - b.costTwd),
      cost_method: 'moving_avg',
      name: asset.name || '',
      symbol: asset.symbol || '',
      currency: ccy
    });
  });
  out.sort(function (a, b) { return String(a.account_id).localeCompare(String(b.account_id)) || String(a.asset_id).localeCompare(String(b.asset_id)); });
  return out;
}

function safeRebuildHoldings_() {
  try { rebuildHoldings_(); return ''; }
  catch (err) { return 'holdings rebuild failed: ' + err.message; }
}

function rebuildHoldings_() {
  var rows = computeHoldings_();
  var sh = sheet_('Holdings');
  var last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);
  rows.forEach(function (r) { appendRecord_('Holdings', r); });
  return rows;
}

function balancesPayload_() {
  var accounts = accountsById_();
  var idx = indexQuotes_(readTable_('Prices_FX'));
  var sums = {};
  Object.keys(accounts).forEach(function (id) { sums[id] = num_(accounts[id].opening_balance); });
  readTable_('Transactions').forEach(function (t) {
    if (t.status === 'active' && sums[t.account_id] !== undefined) sums[t.account_id] += num_(t.amount);
  });
  var missing = [];
  var assets = 0, liabs = 0, cash = 0, invCash = 0;
  var balances = Object.keys(accounts).map(function (id) {
    var a = accounts[id];
    var bal = round2_(sums[id]);
    var fx = latestFxFromIndex_(a.currency, idx);
    var twd = fx ? round2_(bal * fx.value) : null;
    if (!fx) missing.push(id);
    var active = a.status === 'active';
    if (active && twd !== null) {
      if (['loan', 'credit_card'].indexOf(a.type) >= 0) liabs += Math.abs(twd);
      else {
        assets += twd;
        if (String(a.is_investment).toUpperCase() === 'TRUE') invCash += twd;
        else cash += twd;
      }
    }
    return {
      account_id: id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      is_investment: String(a.is_investment).toUpperCase() === 'TRUE',
      status: a.status,
      balance: bal,
      fx_rate: fx ? fx.value : null,
      fx_date: fx ? fx.date : '',
      fx_stale: fx ? !!fx.is_stale : false,
      fx_missing: !fx,
      balance_twd: twd
    };
  });
  var holdTwd = 0;
  computeHoldings_().forEach(function (h) {
    if (h.market_value_twd === '' || h.market_value_twd === null || isNaN(Number(h.market_value_twd))) return;
    holdTwd += Number(h.market_value_twd);
  });
  holdTwd = round2_(holdTwd);
  assets = round2_(assets + holdTwd);
  liabs = round2_(liabs);
  return {
    ok: true,
    balances: balances,
    net_worth: {
      total_assets_twd: assets,
      total_liabilities_twd: liabs,
      net_worth_twd: round2_(assets - liabs),
      cash_twd: round2_(cash),
      investments_cash_twd: round2_(invCash),
      holdings_twd: holdTwd,
      investments_twd: round2_(invCash + holdTwd),
      missing_fx: missing
    }
  };
}

function limitN_(limit) {
  var n = Number(limit);
  if (!n || n < 1) n = 50;
  if (n > 200) n = 200;
  return n;
}

function transactionsPayload_(limit) {
  var rows = readTable_('Transactions').map(strip_);
  rows.sort(compareRecent_);
  return { ok: true, transactions: rows.slice(0, limitN_(limit)) };
}

function tradesPayload_(limit) {
  var rows = readTable_('Investment_Trades').map(strip_);
  rows.sort(function (a, b) {
    if (a.trade_date !== b.trade_date) return a.trade_date < b.trade_date ? 1 : -1;
    return String(a.created_at || '') < String(b.created_at || '') ? 1 : -1;
  });
  return { ok: true, trades: rows.slice(0, limitN_(limit)) };
}

function compareRecent_(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (String(a.created_at || '') !== String(b.created_at || '')) return String(a.created_at) < String(b.created_at) ? 1 : -1;
  return String(a.txn_id) < String(b.txn_id) ? 1 : -1;
}

function pricesPayload_() {
  var assets = readTable_('Assets').map(strip_);
  var idx = indexQuotes_(readTable_('Prices_FX'));
  var days = staleDaysMap_();
  var quotes = Object.keys(idx).map(function (k) {
    var p = idx[k];
    var date = fmtDate_(p.date);
    return {
      symbol: p.symbol,
      kind: p.kind,
      date: date,
      value: num_(p.value),
      currency: p.currency,
      source: p.source,
      is_stale: isStaleKind_(p.kind, date, days),
      note: p.note || ''
    };
  });
  quotes.sort(function (a, b) {
    if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
  var valuations = [];
  var seen = {};
  quotes.forEach(function (q) {
    if (q.kind !== 'bond_valuation') return;
    valuations.push({ symbol: q.symbol, date: q.date, value: q.value, currency: q.currency, is_stale: q.is_stale, missing: false, name: '' });
    seen[q.symbol] = true;
  });
  assets.forEach(function (a) {
    if (a.asset_class !== 'bond' || a.status === 'delisted') return;
    var sym = a.symbol || a.asset_id;
    if (seen[sym] || seen[a.asset_id]) return;
    valuations.push({
      symbol: sym, asset_id: a.asset_id, name: a.name, date: '', value: null,
      currency: a.currency, is_stale: true, missing: true
    });
  });
  return { ok: true, quotes: quotes, stale: quotes.filter(function (q) { return q.is_stale; }), last_valuations: valuations };
}

function actionCreateAsset_(d, ctx) {
  ['asset_id', 'name', 'asset_class', 'currency', 'price_source'].forEach(function (k) {
    if (d[k] === undefined || String(d[k]).trim() === '') fail_('V1', 'missing ' + k);
  });
  if (ENUMS.asset_class.indexOf(d.asset_class) < 0) fail_('V1', 'bad asset_class');
  if (ENUMS.currency.indexOf(d.currency) < 0) fail_('V1', 'bad currency');
  if (ENUMS.price_source.indexOf(d.price_source) < 0) fail_('V1', 'bad price_source');
  var id = String(d.asset_id).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(id)) fail_('V1', 'bad asset_id');
  if (assetsById_()[id]) fail_('V1', 'asset exists');
  if (d.bond_maturity && !isDate_(d.bond_maturity)) fail_('V1', 'bad bond_maturity');
  var rec = {
    asset_id: id,
    name: String(d.name).trim(),
    asset_class: d.asset_class,
    symbol: d.symbol ? String(d.symbol).trim() : '',
    isin: d.isin ? String(d.isin).trim() : '',
    exchange: d.exchange ? String(d.exchange).trim() : '',
    currency: d.currency,
    price_source: d.price_source,
    tags: d.tags ? String(d.tags).trim() : '',
    bond_coupon: d.bond_coupon === undefined || d.bond_coupon === '' ? '' : num_(d.bond_coupon),
    bond_maturity: d.bond_maturity || '',
    status: 'active'
  };
  appendRecord_('Assets', rec);
  audit_(ctx, 'create', 'Assets', rec.asset_id, null, rec);
  return { ids: [rec.asset_id] };
}

function actionAddPrice_(d, ctx) {
  ['symbol', 'kind', 'date', 'value', 'currency'].forEach(function (k) {
    if (d[k] === undefined || String(d[k]).trim() === '') fail_('V1', 'missing ' + k);
  });
  if (ENUMS.price_kind.indexOf(d.kind) < 0) fail_('V1', 'bad kind');
  if (ENUMS.currency.indexOf(d.currency) < 0) fail_('V1', 'bad currency');
  if (!isDate_(d.date)) fail_('V1', 'date must be YYYY-MM-DD');
  var value = num_(d.value);
  if (!(value > 0)) fail_('V1', 'value must be > 0');
  var source = d.source || 'manual';
  if (ENUMS.market_source.indexOf(source) < 0) fail_('V1', 'bad source');
  var symbol = String(d.symbol).trim();
  var dup = readTable_('Prices_FX').some(function (p) {
    return p.symbol === symbol && fmtDate_(p.date) === d.date && String(p.source) === source;
  });
  if (dup) fail_('V1', 'price exists for symbol+date+source; history is append-only');
  var rec = {
    symbol: symbol,
    kind: d.kind,
    date: d.date,
    value: value,
    currency: d.currency,
    source: source,
    fetched_at: nowIso_(),
    is_stale: isStaleKind_(d.kind, d.date),
    note: d.note ? String(d.note).slice(0, 200) : ''
  };
  appendRecord_('Prices_FX', rec);
  audit_(ctx, 'price_import', 'Prices_FX', symbol + '@' + d.date, null, rec);
  var warn = safeRebuildHoldings_();
  return { ids: [symbol + '@' + d.date], warnings: warn ? [warn] : [] };
}

function actionAddTrade_(d, ctx) {
  ['trade_date', 'account_id', 'asset_id', 'side', 'quantity', 'price', 'fx_source'].forEach(function (k) {
    if (d[k] === undefined || d[k] === '' || d[k] === null) fail_('V1', 'missing ' + k);
  });
  if (!isDate_(d.trade_date)) fail_('V1', 'bad trade_date');
  if (d.settle_date && !isDate_(d.settle_date)) fail_('V1', 'bad settle_date');
  if (ENUMS.trade_side.indexOf(d.side) < 0) fail_('V1', 'bad side');
  if (ENUMS.fx_source.indexOf(d.fx_source) < 0) fail_('V1', 'bad fx_source');
  var qty = num_(d.quantity), price = num_(d.price), fee = num_(d.fee || 0), tax = num_(d.tax || 0);
  if (!(qty > 0)) fail_('V1', 'quantity must be > 0');
  if (fee < 0 || tax < 0) fail_('V1', 'fee/tax must be >= 0');
  var freePrice = ['split', 'transfer_in', 'transfer_out'].indexOf(d.side) >= 0;
  if (freePrice ? price < 0 : !(price > 0)) fail_('V1', freePrice ? 'price must be >= 0' : 'price must be > 0');
  var accounts = accountsById_();
  var acc = accounts[d.account_id];
  if (!acc) fail_('V1', 'unknown account ' + d.account_id);
  var invest = String(acc.is_investment).toUpperCase() === 'TRUE';
  if (['brokerage', 'fund_platform'].indexOf(acc.type) < 0 && !invest) fail_('V1', 'trade account must be an investment account');
  var asset = assetsById_()[d.asset_id];
  if (!asset || asset.status === 'delisted') fail_('V1', 'unknown or delisted asset');
  var currency = asset.currency;
  if (acc.currency !== currency) fail_('V2', 'account currency ' + acc.currency + ' != asset ' + currency);
  var fx = d.fx_rate === undefined || d.fx_rate === '' ? (currency === 'TWD' ? 1 : NaN) : num_(d.fx_rate);
  if (!(fx > 0)) fail_('V1', 'bad fx_rate');
  if (currency === 'TWD' && fx !== 1) fail_('V2', 'TWD fx_rate must be 1');
  var accrued = d.accrued_interest === undefined || d.accrued_interest === '' || d.accrued_interest === null ? null : num_(d.accrued_interest);
  if (accrued !== null && isNaN(accrued)) fail_('V1', 'bad accrued_interest');
  var held = heldQty_(d.account_id, d.asset_id);
  if (['sell', 'maturity', 'transfer_out'].indexOf(d.side) >= 0 && qty - held > 0.0000001) {
    fail_('V1', 'quantity exceeds holding ' + held);
  }
  if (d.side === 'split' && !(held > 0)) fail_('V1', 'split needs an existing holding');
  var gross = round4_(qty * price);
  var net = cashNetForSide_(d.side, gross, fee, tax);
  if (accrued) {
    if (d.side === 'buy' || d.side === 'dividend_reinvest') net = round4_(net - accrued);
    else if (d.side === 'sell' || d.side === 'maturity') net = round4_(net + accrued);
  }
  var tradeId = newId_('TR', d.trade_date);
  var warnings = [];
  var cashId = '';
  if (round4_(net) !== 0) {
    var cash = {
      date: d.trade_date,
      account_id: d.account_id,
      txn_type: 'adjustment',
      category: '投資交易',
      amount: net,
      currency: currency,
      fx_rate: fx,
      fx_source: d.fx_source,
      flow_class: 'internal',
      trade_id: tradeId,
      asset_id: d.asset_id,
      description: d.description || (d.side + ' ' + (asset.symbol || asset.asset_id))
    };
    warnings = validateTxn_(cash, accounts);
    var rec = txnRecord_(cash, ctx);
    appendRecord_('Transactions', rec);
    audit_(ctx, 'create', 'Transactions', rec.txn_id, null, rec);
    cashId = rec.txn_id;
  }
  var at = nowIso_();
  var trade = {
    trade_id: tradeId,
    trade_date: d.trade_date,
    settle_date: d.settle_date || '',
    account_id: d.account_id,
    asset_id: d.asset_id,
    side: d.side,
    quantity: qty,
    price: price,
    currency: currency,
    gross_amount: gross,
    fee: fee,
    tax: tax,
    net_amount: net,
    fx_rate: fx,
    net_amount_twd: round2_(net * fx),
    accrued_interest: accrued === null ? '' : accrued,
    lot_match_ref: d.lot_match_ref || '',
    cash_txn_id: cashId,
    status: 'active',
    void_reason: '',
    voided_at: '',
    replaces_id: '',
    created_at: at,
    created_by: ctx.actor,
    request_id: ctx.request_id,
    updated_at: at
  };
  appendRecord_('Investment_Trades', trade);
  audit_(ctx, 'create', 'Investment_Trades', trade.trade_id, null, trade);
  var rebuildWarn = safeRebuildHoldings_();
  if (rebuildWarn) warnings.push(rebuildWarn);
  return {
    ids: cashId ? [tradeId, cashId] : [tradeId],
    trade_id: tradeId,
    cash_txn_id: cashId,
    net_amount: net,
    net_amount_twd: trade.net_amount_twd,
    warnings: warnings
  };
}

/** Void a trade row only. Cash is voided by the caller when it is a separate step. */
function voidTradeRow_(tradeId, reason, ctx, at) {
  var rows = readTable_('Investment_Trades');
  var t = rows.filter(function (r) { return r.trade_id === tradeId && r.status === 'active'; })[0];
  if (!t) return null;
  updateCells_('Investment_Trades', t._row, { status: 'void', void_reason: reason, voided_at: at, updated_at: at });
  audit_(ctx, 'void', 'Investment_Trades', t.trade_id, strip_(t), { status: 'void', void_reason: reason });
  return t;
}

function actionVoidTrade_(d, ctx) {
  if (!d.void_reason) fail_('V10', 'void_reason required');
  var rows = readTable_('Investment_Trades');
  var target = rows.filter(function (r) { return r.trade_id === d.trade_id; })[0];
  if (!target) fail_('V10', 'unknown trade');
  if (target.status !== 'active') fail_('V10', 'only active trades can be voided');
  var at = nowIso_();
  voidTradeRow_(target.trade_id, d.void_reason, ctx, at);
  var ids = [target.trade_id];
  if (target.cash_txn_id) {
    var tx = readTable_('Transactions').filter(function (r) { return r.txn_id === target.cash_txn_id; })[0];
    if (tx && tx.status === 'active') {
      updateCells_('Transactions', tx._row, { status: 'void', void_reason: d.void_reason, voided_at: at, updated_at: at });
      audit_(ctx, 'void', 'Transactions', tx.txn_id, strip_(tx), { status: 'void', void_reason: d.void_reason });
      ids.push(tx.txn_id);
    }
  }
  var warn = safeRebuildHoldings_();
  return { ids: ids, warnings: warn ? [warn] : [] };
}
