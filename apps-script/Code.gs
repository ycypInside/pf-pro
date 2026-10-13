/**
 * PF Pro v0.1 — Web App entry points.
 * POST body (JSON): { token, request_id, action, actor?, client?, data }
 * Pipeline: token -> request_id idempotency -> lock -> validate -> write -> audit -> record result.
 * Auth and parsing stay outside the lock. A missing script secret is auth_unavailable, not unauthorized.
 */
function doPost(e) {
  var lock = null;
  try {
    beginRequest_();
    var params = requestParams_(e);
    var raw = e && e.postData && e.postData.contents;
    // A 302 follows as GET and drops the body. Prefer the query token when the body token is blank.
    if (!raw) {
      var missingBody = decideAuth_(presentedToken_('', params.token), scriptProp_('API_TOKEN'));
      if (missingBody) return json_({ ok: false, error: missingBody.error, reason: missingBody.reason });
      return json_({ ok: false, error: 'bad json', reason: 'parse_error' });
    }
    var body;
    try { body = JSON.parse(raw); } catch (parseErr) { return json_({ ok: false, error: 'bad json', reason: 'parse_error' }); }
    if (!body || typeof body !== 'object') return json_({ ok: false, error: 'bad json', reason: 'parse_error' });
    var auth = decideAuth_(presentedToken_(body.token, params.token), scriptProp_('API_TOKEN'));
    if (auth) return json_({ ok: false, error: auth.error, reason: auth.reason });
    if (!body.request_id) return json_({ ok: false, error: 'request_id required' });
    var handler = ACTIONS[body.action];
    if (!handler) return json_({ ok: false, error: 'unknown action' });

    var hash = sha256_(stableJson_({ action: body.action, data: body.data }));
    lock = LockService.getScriptLock();
    try { lock.waitLock(20000); }
    catch (lockErr) { return json_({ ok: false, error: 'busy' }); }
    var prior = idemCheck_(body.request_id, hash);
    if (prior && prior.conflict) return json_({ ok: false, error: 'V9: request_id reused with different payload' });
    if (prior && prior.replay) return json_({ ok: prior.status === 'ok', replay: true, status: prior.status, result_ref: prior.ref });

    var ctx = { request_id: body.request_id, actor: body.actor || safeActor_(), client: body.client || 'web' };
    try {
      var res = handler(body.data || {}, ctx);
      if (needsCashflowRebuild_(body.action)) {
        var cfWarn = safeRebuildCashflows_();
        if (cfWarn) res.warnings = (res.warnings || []).concat([cfWarn]);
      }
      idemRecord_(body.request_id, body.action, hash, 'ok', (res.ids || []).join(','));
      SpreadsheetApp.flush();
      bumpCache_();
      return json_(publicWrite_(body.action, res));
    } catch (err) {
      var status = err instanceof ValidationError ? 'rejected' : 'error';
      try { idemRecord_(body.request_id, body.action, hash, status, String(err && err.message).slice(0, 200)); } catch (ignore) {}
      try { SpreadsheetApp.flush(); bumpCache_(); } catch (ignore2) {}
      return json_({ ok: false, status: status, error: err && err.message ? err.message : 'server' });
    }
  } catch (outer) {
    return json_({ ok: false, error: 'server' });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (ignore3) {} }
  }
}

/**
 * Read-only endpoints.
 * GET ?token=..&q=health|summary|accounts|balances|income_expense|incomeexpense|checks
 *     |transactions|trades|assets|prices|holdings|settings|performance|allocation
 * `incomeexpense` is an alias of `income_expense`. `summary` is the 總覽 payload.
 */
function doGet(e) {
  try {
    beginRequest_();
    var p = requestParams_(e);
    var auth = decideAuth_(p.token, scriptProp_('API_TOKEN'));
    if (auth) return json_({ ok: false, error: auth.error, reason: auth.reason });
    if (p.q === 'health') return json_({ ok: true, schema_version: settings_().schema_version, at: nowIso_() });
    var extra = [p.from || '', p.to || '', p.period || '', p.benchmark || '', p.limit || ''].join('|');
    var payload = cachedGet_(String(p.q || '') + '|' + extra, function () { return routeGet_(p); });
    // HtmlService, or a throw inside JSON.stringify, serves an HTML page. That page
    // 302s again, and a strict client counts the extra hop as a redirect loop.
    // q=summary is the large GET that showed it. Every branch here returns ContentService JSON.
    if (!payload || typeof payload !== 'object') payload = { ok: false, error: 'server' };
    return json_(payload);
  } catch (err) {
    return json_({ ok: false, error: 'server' });
  }
}

function requestParams_(e) {
  return mergeRequestParams_(e && e.parameter, e && e.parameters, e && e.queryString);
}

function routeGet_(p) {
  switch (p.q) {
    case 'summary': return summaryPayload_(p.from, p.to);
    case 'accounts': return { ok: true, accounts: readTable_('Accounts').map(strip_) };
    case 'balances': return balancesPayload_();
    case 'income_expense':
    case 'incomeexpense': return { ok: true, report: incomeExpense_(p.from, p.to) };
    case 'checks': return { ok: true, warnings: dailyChecks_() };
    case 'transactions': return transactionsPayload_(p.limit);
    case 'trades': return tradesPayload_(p.limit);
    case 'assets': return { ok: true, assets: readTable_('Assets').map(strip_) };
    case 'prices': return pricesPayload_();
    case 'holdings': return holdingsPayload_();
    case 'performance': return performancePayload_(p.period, p.benchmark);
    case 'allocation': return allocationPayload_();
    case 'settings': return { ok: true, settings: settings_() };
    default: return { ok: false, error: 'unknown q' };
  }
}

function summaryPayload_(fromDate, toDate) {
  var prices = pricesPayload_();
  var balances = balancesPayload_();
  return {
    ok: true,
    accounts: readTable_('Accounts').map(strip_),
    balances: balances.balances,
    net_worth: balances.net_worth,
    report: incomeExpense_(fromDate, toDate),
    warnings: dailyChecks_(),
    quotes: prices.quotes,
    stale: prices.stale,
    last_valuations: prices.last_valuations,
    holdings: computeHoldings_()
  };
}

function needsCashflowRebuild_(action) {
  return action === 'add_transaction' || action === 'add_transfer' || action === 'void_transaction' || action === 'replace_transaction' || action === 'add_trade' || action === 'void_trade';
}

function safeActor_() {
  try {
    var email = Session.getEffectiveUser().getEmail();
    return email || 'owner';
  } catch (err) { return 'owner'; }
}

var ACTIONS = {
  create_account: function (d, ctx) {
    ['account_id', 'name', 'type', 'currency', 'institution', 'opening_balance', 'opening_date'].forEach(function (k) {
      if (d[k] === undefined || d[k] === '') fail_('V1', 'missing ' + k);
    });
    if (ENUMS.account_type.indexOf(d.type) < 0) fail_('V1', 'bad type');
    if (ENUMS.currency.indexOf(d.currency) < 0) fail_('V1', 'bad currency');
    if (!isDate_(d.opening_date)) fail_('V1', 'bad opening_date');
    if (accountsById_()[d.account_id]) fail_('V1', 'account exists');
    if (d.note && /\d{5,}/.test(d.note)) fail_('V1', 'note must not contain full account numbers (last 4 only)');
    var rec = { account_id: d.account_id, name: d.name, type: d.type, currency: d.currency, institution: d.institution,
      parent_account_id: d.parent_account_id || '', is_investment: !!d.is_investment, opening_balance: Number(d.opening_balance),
      opening_date: d.opening_date, status: 'active', note: d.note || '' };
    appendRecord_('Accounts', rec);
    audit_(ctx, 'create', 'Accounts', rec.account_id, null, rec);
    return { ids: [rec.account_id] };
  },

  update_account: function (d, ctx) {
    if (!d.account_id) fail_('V1', 'missing account_id');
    var a = accountsById_()[d.account_id];
    if (!a) fail_('V1', 'unknown account');
    var patch = {};
    if (d.name !== undefined) {
      var name = String(d.name).trim();
      if (!name) fail_('V1', 'bad name');
      patch.name = name;
    }
    if (d.opening_date !== undefined && d.opening_date !== '') {
      if (!isDate_(d.opening_date)) fail_('V1', 'bad opening_date');
      patch.opening_date = d.opening_date;
    }
    if (d.opening_balance !== undefined && d.opening_balance !== '') {
      if (isNaN(Number(d.opening_balance))) fail_('V1', 'bad opening_balance');
      patch.opening_balance = Number(d.opening_balance);
    }
    if (d.active !== undefined && d.active !== '') {
      var active = d.active === true || String(d.active).toUpperCase() === 'TRUE';
      var inactive = d.active === false || String(d.active).toUpperCase() === 'FALSE';
      if (!active && !inactive) fail_('V1', 'bad active');
      patch.status = active ? 'active' : 'closed';
    }
    if (!Object.keys(patch).length) fail_('V1', 'nothing to update');
    var before = strip_(a);
    updateCells_('Accounts', a._row, patch);
    audit_(ctx, 'config_change', 'Accounts', a.account_id, before, patch);
    return { ids: [a.account_id] };
  },

  close_account: function (d, ctx) {
    var a = readTable_('Accounts').filter(function (x) { return x.account_id === d.account_id; })[0];
    if (!a) fail_('V1', 'unknown account');
    var beforeClose = strip_(a);
    updateCells_('Accounts', a._row, { status: 'closed' });
    audit_(ctx, 'config_change', 'Accounts', a.account_id, beforeClose, { status: 'closed' });
    return { ids: [a.account_id] };
  },

  add_transaction: function (d, ctx) {
    if (TRANSFER_TYPES.indexOf(d.txn_type) >= 0) fail_('V3', 'use add_transfer for transfer/fx legs');
    var accounts = accountsById_();
    var warn = validateTxn_(d, accounts);
    var rec = txnRecord_(d, ctx);
    appendRecord_('Transactions', rec);
    audit_(ctx, 'create', 'Transactions', rec.txn_id, null, rec);
    return { ids: [rec.txn_id], warnings: warn };
  },

  /** One call writes both legs with a shared transfer_group_id (spec section 4). */
  add_transfer: function (d, ctx) {
    var accounts = accountsById_();
    var gid = newId_('TG', d.date);
    var fx = d.from.currency !== d.to.currency;
    var legs = [
      Object.assign({}, d.from, { date: d.date, txn_type: fx ? 'fx_out' : 'transfer_out', category: 'transfer', flow_class: d.flow_class || 'internal',
        transfer_group_id: gid, counterparty_account_id: d.to.account_id, description: d.description }),
      Object.assign({}, d.to, { date: d.date, txn_type: fx ? 'fx_in' : 'transfer_in', category: 'transfer', flow_class: d.flow_class || 'internal',
        transfer_group_id: gid, counterparty_account_id: d.from.account_id, description: d.description })
    ];
    var warn = [];
    legs.forEach(function (l) { warn = warn.concat(validateTxn_(l, accounts)); });
    validatePair_(legs[0], legs[1]);
    var recs = legs.map(function (l) { return txnRecord_(l, ctx); });
    if (d.fee) {
      var f = Object.assign({}, d.fee, { date: d.date, txn_type: 'fee', category: '手續費', flow_class: 'investment_cost', transfer_group_id: gid });
      warn = warn.concat(validateTxn_(f, accounts));
      recs.push(txnRecord_(f, ctx));
    }
    appendRecords_('Transactions', recs);
    recs.forEach(function (r) { audit_(ctx, 'create', 'Transactions', r.txn_id, null, r); });
    return { ids: recs.map(function (r) { return r.txn_id; }), transfer_group_id: gid, warnings: warn };
  },

  /** V10: only active rows; transfer voids the whole group. */
  void_transaction: function (d, ctx) {
    if (!ckVoidReasonOk_(d.void_reason)) fail_('V10', 'void_reason required');
    var rows = readTable_('Transactions'), target = rows.filter(function (r) { return r.txn_id === d.txn_id; })[0];
    if (!target) fail_('V10', 'unknown txn');
    if (target.status !== 'active') fail_('V10', 'only active rows can be voided');
    var set = target.transfer_group_id ? rows.filter(function (r) { return r.transfer_group_id === target.transfer_group_id && r.status === 'active'; }) : [target];
    var at = nowIso_();
    var ids = [];
    set.forEach(function (r) {
      updateCells_('Transactions', r._row, { status: 'void', void_reason: d.void_reason, voided_at: at, updated_at: at });
      audit_(ctx, 'void', 'Transactions', r.txn_id, strip_(r), { status: 'void', void_reason: d.void_reason });
      ids.push(r.txn_id);
    });
    // A trade's cash leg and the lot must void together, or holdings and cash diverge.
    var tradeIds = {};
    set.forEach(function (r) { if (r.trade_id) tradeIds[r.trade_id] = true; });
    Object.keys(tradeIds).forEach(function (tid) {
      if (voidTradeRow_(tid, d.void_reason, ctx, at)) ids.push(tid);
    });
    if (Object.keys(tradeIds).length) safeRebuildHoldings_();
    return { ids: ids };
  },

  /** Edit = void old + insert new with replaces_id (non-transfer rows). */
  replace_transaction: function (d, ctx) {
    var rows = readTable_('Transactions'), old = rows.filter(function (r) { return r.txn_id === d.txn_id; })[0];
    if (!old || old.status !== 'active') fail_('V10', 'can only replace an active row');
    if (old.transfer_group_id) fail_('V10', 'void the transfer group and re-add instead');
    if (old.trade_id) fail_('V10', 'void the trade and re-add instead');
    var accounts = accountsById_();
    var nd = Object.assign({}, d.data);
    var warn = validateTxn_(nd, accounts);
    var rec = txnRecord_(nd, ctx); rec.replaces_id = old.txn_id;
    var at = nowIso_();
    updateCells_('Transactions', old._row, { status: 'void', void_reason: d.void_reason || 'replaced', voided_at: at, updated_at: at });
    appendRecord_('Transactions', rec);
    audit_(ctx, 'replace', 'Transactions', rec.txn_id, strip_(old), rec);
    return { ids: [rec.txn_id], replaced: old.txn_id, warnings: warn };
  },

  add_liability: function (d, ctx) {
    ['account_id', 'name', 'liability_type', 'currency', 'principal_original', 'balance', 'balance_as_of', 'interest_rate', 'rate_type', 'start_date'].forEach(function (k) {
      if (d[k] === undefined || d[k] === '') fail_('V1', 'missing ' + k);
    });
    if (ENUMS.liability_type.indexOf(d.liability_type) < 0 || ENUMS.rate_type.indexOf(d.rate_type) < 0) fail_('V1', 'bad enum');
    var acc = accountsById_()[d.account_id];
    if (!acc || ['loan', 'credit_card'].indexOf(acc.type) < 0) fail_('V1', 'liability account must be loan/credit_card');
    var rec = Object.assign({}, d, { liability_id: d.liability_id || newId_('LIA'), status: 'active', created_at: nowIso_(), created_by: ctx.actor, request_id: ctx.request_id });
    appendRecord_('Liabilities', rec);
    audit_(ctx, 'create', 'Liabilities', rec.liability_id, null, rec);
    return { ids: [rec.liability_id] };
  },

  reconcile: function (d, ctx) { return { ids: [], reconciliation: reconcile_(d.account_id, d.statement_balance) }; },

  set_setting: function (d, ctx) {
    var rows = readTable_('Settings'), r = rows.filter(function (x) { return x.key === d.key; })[0];
    if (r) {
      var previous = r.value;
      updateCells_('Settings', r._row, { value: d.value });
      audit_(ctx, 'config_change', 'Settings', d.key, { value: previous }, { value: d.value });
    }
    else { appendRecord_('Settings', { key: d.key, value: d.value, note: d.note || '' }); audit_(ctx, 'config_change', 'Settings', d.key, null, { value: d.value }); }
    return { ids: [d.key] };
  },

  create_asset: function (d, ctx) { return actionCreateAsset_(d, ctx); },
  add_trade: function (d, ctx) { return actionAddTrade_(d, ctx); },
  void_trade: function (d, ctx) { return actionVoidTrade_(d, ctx); },
  add_price: function (d, ctx) { return actionAddPrice_(d, ctx); },
  refresh_benchmarks: function () { return fetchBenchmarksBody_(); },
  run_snapshot: function () {
    if (fxNeedsFetch_(fxDate_('USDTWD'), today_())) fetchBotFxBody_();
    var date = today_();
    var created = writeSnapshot_() === true;
    return { ids: [date], created: created, snapshot_date: date };
  }
};

function txnRecord_(d, ctx) {
  var at = nowIso_();
  return {
    txn_id: newId_('TX', d.date), date: d.date, account_id: d.account_id, txn_type: d.txn_type, category: d.category,
    amount: Number(d.amount), currency: d.currency, fx_rate: Number(d.fx_rate), amount_twd: round2_(Number(d.amount) * Number(d.fx_rate)),
    fx_source: d.fx_source, transfer_group_id: d.transfer_group_id || '', counterparty_account_id: d.counterparty_account_id || '',
    asset_id: d.asset_id || '', trade_id: d.trade_id || '', flow_class: d.flow_class, description: d.description || '',
    status: 'active', void_reason: '', voided_at: '', replaces_id: '', created_at: at, created_by: ctx.actor,
    request_id: ctx.request_id, updated_at: at
  };
}
function strip_(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k] instanceof Date ? fmtDate_(o[k]) : o[k]; }); return c; }
function json_(o) {
  try {
    return ContentService.createTextOutput(safeJsonText_(o)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput('{"ok":false,"error":"server"}').setMimeType(ContentService.MimeType.JSON);
  }
}
