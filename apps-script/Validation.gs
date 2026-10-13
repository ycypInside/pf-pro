/** Spec section 5 checks. Write-time checks throw ValidationError; daily checks return warnings. */
function ValidationError(code, msg) { this.code = code; this.message = code + ': ' + msg; }
function fail_(code, msg) { throw new ValidationError(code, msg); }

function accountsById_() {
  var m = {};
  readTable_('Accounts').forEach(function (a) { m[a.account_id] = a; });
  return m;
}

var TXN_REQUIRED = ['date', 'account_id', 'txn_type', 'category', 'amount', 'currency', 'fx_rate', 'fx_source', 'flow_class'];
var TRANSFER_TYPES = ['transfer_out', 'transfer_in', 'fx_out', 'fx_in'];

/** V1, V2, V8, V12 (+ V7 warning) for one transaction. Returns array of warnings. */
function validateTxn_(t, accounts, opts) {
  var warn = [];
  // V1 required / enum / date
  TXN_REQUIRED.forEach(function (k) { if (t[k] === undefined || t[k] === '' || t[k] === null) fail_('V1', 'missing ' + k); });
  if (ENUMS.txn_type.indexOf(t.txn_type) < 0) fail_('V1', 'bad txn_type ' + t.txn_type);
  if (ENUMS.fx_source.indexOf(t.fx_source) < 0) fail_('V1', 'bad fx_source');
  if (ENUMS.flow_class.indexOf(t.flow_class) < 0) fail_('V12', 'flow_class required');
  if (!isDate_(t.date)) fail_('V1', 'date must be YYYY-MM-DD');
  if (isNaN(Number(t.amount)) || isNaN(Number(t.fx_rate)) || Number(t.fx_rate) <= 0) fail_('V1', 'amount/fx_rate not numeric');
  var acc = accounts[t.account_id];
  if (!acc) fail_('V1', 'unknown account ' + t.account_id);
  // V2 currency / fx
  if (t.currency !== acc.currency) fail_('V2', 'currency ' + t.currency + ' != account ' + acc.currency);
  if (!ckTwdFxOk_(t.currency, t.fx_rate)) fail_('V2', 'TWD fx_rate must be 1');
  var expect = ckExpectTwd_(t.amount, t.fx_rate);
  if (t.amount_twd === undefined || t.amount_twd === '') t.amount_twd = expect;
  else if (!ckAmountTwdOk_(t.amount, t.fx_rate, t.amount_twd)) fail_('V2', 'amount_twd must be ' + expect);
  // V8 date / active
  if (acc.status !== 'active') fail_('V8', 'account not active');
  if (!ckDateOnOrAfter_(t.date, fmtDate_(acc.opening_date))) fail_('V8', 'date before account opening_date');
  // transfer fields
  if (TRANSFER_TYPES.indexOf(t.txn_type) >= 0) {
    if (!t.transfer_group_id || !t.counterparty_account_id) fail_('V3', 'transfer needs transfer_group_id + counterparty_account_id');
    if (!accounts[t.counterparty_account_id]) fail_('V3', 'unknown counterparty');
  }
  // V12 investment account inflow must be external/internal
  if (!ckInvestmentInflowOk_(acc.is_investment, t.amount, t.txn_type, t.flow_class)) fail_('V12', 'investment inflow must be external/internal');
  // V7 negative balance (warning)
  if (String(settings_().allow_negative_balance_check).toUpperCase() !== 'FALSE' &&
      ['credit_card', 'loan'].indexOf(acc.type) < 0) {
    var bal = balanceOf_(t.account_id, accounts) + Number(t.amount);
    if (bal < 0) warn.push('V7: ' + t.account_id + ' would go negative (' + bal + ')');
  }
  return warn;
}

/** V3 for a pair being written together. */
function validatePair_(a, b) {
  if (a.account_id === b.account_id) fail_('V3', 'transfer accounts must differ');
  if (!ckOppositeSignsOk_(a.amount, b.amount)) fail_('V3', 'transfer legs must have opposite signs');
  if (!ckSameCurrencyOk_(a.currency, a.amount, b.currency, b.amount)) fail_('V3', 'same-currency transfer must sum to 0');
}

/** V6 helper: opening_balance + sum(active amounts). */
function balanceOf_(accountId, accounts) {
  var acc = accounts[accountId], bal = Number(acc.opening_balance || 0);
  readTable_('Transactions').forEach(function (t) {
    if (t.account_id === accountId && t.status === 'active') bal += Number(t.amount);
  });
  return round2_(bal);
}

/** Daily checks V3, V4, V6(vs reconciliation inputs), V7. Returns warnings. */
function dailyChecks_() {
  var warn = [], s = settings_(), tol = Number(s.balance_tolerance_twd || 1);
  var tx = readTable_('Transactions').filter(function (t) { return t.status === 'active'; });
  var groups = {};
  tx.forEach(function (t) { if (t.transfer_group_id) (groups[t.transfer_group_id] = groups[t.transfer_group_id] || []).push(t); });
  Object.keys(groups).forEach(function (g) {
    var legs = groups[g].filter(function (t) { return TRANSFER_TYPES.indexOf(t.txn_type) >= 0; });
    if (legs.length !== 2) { warn.push('V3: group ' + g + ' has ' + legs.length + ' active legs'); return; }
    if (legs[0].currency !== legs[1].currency) {
      var diff = Math.abs(round2_(Number(legs[0].amount_twd) + Number(legs[1].amount_twd)));
      var hasFee = groups[g].some(function (t) { return t.txn_type === 'fee'; });
      if (diff > tol && !hasFee) warn.push('V4: fx group ' + g + ' TWD diff ' + diff + ' without fee row');
    }
  });
  var accounts = accountsById_();
  Object.keys(accounts).forEach(function (id) {
    var a = accounts[id];
    if (a.status !== 'active' || a.opening_balance === '') return;
    var b = balanceOf_(id, accounts);
    if (b < 0 && ['credit_card', 'loan'].indexOf(a.type) < 0) warn.push('V7: ' + id + ' negative ' + b);
  });
  return warn;
}

/** V6 manual reconciliation: compare user-entered statement balance. */
function reconcile_(accountId, statementBalance) {
  var accounts = accountsById_(), b = balanceOf_(accountId, accounts);
  var tol = Number(settings_().balance_tolerance_twd || 1);
  var diff = round2_(Number(statementBalance) - b);
  return { account_id: accountId, ledger: b, statement: Number(statementBalance), diff: diff, ok: Math.abs(diff) <= tol };
}

/** V5: income/expense report excludes transfer & fx legs. */
function incomeExpense_(fromDate, toDate) {
  var inc = 0, exp = 0, byCat = {};
  readTable_('Transactions').forEach(function (t) {
    var d = fmtDate_(t.date);
    if (t.status !== 'active' || d < fromDate || d > toDate) return;
    if (TRANSFER_TYPES.indexOf(t.txn_type) >= 0 || t.txn_type === 'opening') return; // V5
    if (t.txn_type === 'income') inc += Number(t.amount_twd);
    if (t.txn_type === 'expense') exp += -Number(t.amount_twd);
    if (t.txn_type === 'income' || t.txn_type === 'expense') byCat[t.category] = round2_((byCat[t.category] || 0) + Number(t.amount_twd));
  });
  return { income_twd: round2_(inc), expense_twd: round2_(exp), by_category: byCat };
}
