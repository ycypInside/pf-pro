/**
 * PF Pro v0.1 — Web App entry points.
 * POST body (JSON): { token, request_id, action, actor?, client?, data }
 * Pipeline: token -> request_id idempotency -> lock -> validate -> write -> audit -> record result.
 */
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (!body.token || body.token !== props_().getProperty('API_TOKEN')) return json_({ ok: false, error: 'unauthorized' });
  if (!body.request_id) return json_({ ok: false, error: 'request_id required' });
  var handler = ACTIONS[body.action];
  if (!handler) return json_({ ok: false, error: 'unknown action' });

  var payloadForHash = { action: body.action, data: body.data };
  var hash = sha256_(stableJson_(payloadForHash));
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var prior = idemCheck_(body.request_id, hash);
    if (prior && prior.conflict) return json_({ ok: false, error: 'V9: request_id reused with different payload' });
    if (prior && prior.replay) return json_({ ok: prior.status === 'ok', replay: true, status: prior.status, result_ref: prior.ref });

    var ctx = { request_id: body.request_id, actor: body.actor || Session.getEffectiveUser().getEmail() || 'owner', client: body.client || 'web' };
    try {
      var res = handler(body.data || {}, ctx);
      if (body.action === 'add_transaction' || body.action === 'add_transfer' || body.action === 'void_transaction' || body.action === 'replace_transaction' || body.action === 'add_trade' || body.action === 'void_trade') {
        var cfWarn = safeRebuildCashflows_();
        if (cfWarn) res.warnings = (res.warnings || []).concat([cfWarn]);
      }
      idemRecord_(body.request_id, body.action, hash, 'ok', (res.ids || []).join(','));
      return json_({ ok: true, result: res });
    } catch (err) {
      var status = err instanceof ValidationError ? 'rejected' : 'error';
      idemRecord_(body.request_id, body.action, hash, status, String(err.message).slice(0, 200));
      return json_({ ok: false, status: status, error: err.message });
    }
  } finally { lock.releaseLock(); }
}

/**
 * Read-only endpoints.
 * GET ?token=..&q=health|accounts|balances|income_expense|incomeexpense|checks
 *     |transactions|trades|assets|prices|holdings|settings|performance|allocation
 * Phase 2 adds the reads the web client needs. `incomeexpense` is an alias of `income_expense`.
 */
function doGet(e) {
  var p = e.parameter || {};
  if (p.token !== props_().getProperty('API_TOKEN')) return json_({ ok: false, error: 'unauthorized' });
  switch (p.q) {
    case 'health': return json_({ ok: true, schema_version: settings_().schema_version, at: nowIso_() });
    case 'accounts': return json_({ ok: true, accounts: readTable_('Accounts').map(strip_) });
    case 'balances': return json_(balancesPayload_());
    case 'income_expense':
    case 'incomeexpense': return json_({ ok: true, report: incomeExpense_(p.from, p.to) });
    case 'checks': return json_({ ok: true, warnings: dailyChecks_() });
    case 'transactions': return json_(transactionsPayload_(p.limit));
    case 'trades': return json_(tradesPayload_(p.limit));
    case 'assets': return json_({ ok: true, assets: readTable_('Assets').map(strip_) });
    case 'prices': return json_(pricesPayload_());
    case 'holdings': return json_(holdingsPayload_());
    case 'performance': return json_(performancePayload_(p.period, p.benchmark));
    case 'allocation': return json_(allocationPayload_());
    case 'settings': return json_({ ok: true, settings: settings_() });
    default: return json_({ ok: false, error: 'unknown q' });
  }
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

  close_account: function (d, ctx) {
    var a = readTable_('Accounts').filter(function (x) { return x.account_id === d.account_id; })[0];
    if (!a) fail_('V1', 'unknown account');
    updateCells_('Accounts', a._row, { status: 'closed' });
    audit_(ctx, 'config_change', 'Accounts', a.account_id, strip_(a), { status: 'closed' });
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
    recs.forEach(function (r) { appendRecord_('Transactions', r); audit_(ctx, 'create', 'Transactions', r.txn_id, null, r); });
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
    if (r) { updateCells_('Settings', r._row, { value: d.value }); audit_(ctx, 'config_change', 'Settings', d.key, { value: r.value }, { value: d.value }); }
    else { appendRecord_('Settings', { key: d.key, value: d.value, note: d.note || '' }); audit_(ctx, 'config_change', 'Settings', d.key, null, { value: d.value }); }
    return { ids: [d.key] };
  },

  create_asset: function (d, ctx) { return actionCreateAsset_(d, ctx); },
  add_trade: function (d, ctx) { return actionAddTrade_(d, ctx); },
  void_trade: function (d, ctx) { return actionVoidTrade_(d, ctx); },
  add_price: function (d, ctx) { return actionAddPrice_(d, ctx); },
  refresh_benchmarks: function () { return fetchBenchmarks(); }
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
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
