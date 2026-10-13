/**
 * Pure planning for the daily performance sheet and benchmark backfill.
 * Apps Script loads this as globals. Node tests load it after PerfMath.js.
 * Thirteen months (offset 12 through 0) covers a full year even mid-month.
 */

function pfFnv_(text) {
  var h = 2166136261;
  var body = String(text || '');
  for (var i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function pfFactLine_(kind, fields) {
  return kind + '|' + (fields || []).map(function (value) {
    return value == null ? '' : String(value);
  }).join('|');
}

function pfFactsStamp_(lines) {
  var sorted = (lines || []).slice().sort();
  return pfFnv_(sorted.join('\n')) + ':' + sorted.length;
}

function pfAccountDigest_(accounts) {
  var lines = (accounts || []).map(function (account) {
    return pfFactLine_('A', [
      account.account_id, account.status, account.opening_date, account.opening_balance,
      account.is_investment, account.currency, account.type
    ]);
  });
  return pfFactsStamp_(lines);
}

function pfEarliestChange_(changes, builtAt) {
  if (!builtAt) return '';
  var found = false;
  var from = '';
  (changes || []).forEach(function (row) {
    var touched = row && row.touched ? String(row.touched) : '';
    if (!touched || touched <= String(builtAt)) return;
    found = true;
    var date = row && row.date ? String(row.date) : '';
    if (!date) return;
    if (!from || date < from) from = date;
  });
  if (!found) return null;
  return from;
}

function pfPlanPerf_(meta, facts, today) {
  var state = meta || {};
  var stamp = facts && facts.stamp || '';
  var origin = (facts && facts.origin) || today || '';
  var digest = facts && facts.accountDigest || '';
  var through = state.through || '';
  if (state.pending_stamp && stamp && state.pending_stamp === stamp && through) {
    var pendingNext = pfAddDays_(through, 1);
    if (!pendingNext || pendingNext > today) return { action: 'commit', from: through };
    return { action: 'continue', from: pendingNext };
  }
  if (state.stamp && stamp && state.stamp === stamp && through && through >= today) {
    return { action: 'fresh', from: through };
  }
  if (state.stamp && stamp && state.stamp === stamp && through && through < today) {
    return { action: 'append', from: pfAddDays_(through, 1) };
  }
  if (state.account_digest && digest && state.account_digest !== digest) {
    return { action: 'rebuild', from: origin };
  }
  if (!state.built_at || !through) return { action: 'rebuild', from: origin };
  var changed = pfEarliestChange_(facts && facts.changes, state.built_at);
  if (changed === null || !changed) return { action: 'rebuild', from: origin };
  return { action: 'rebuild', from: changed < origin ? origin : changed };
}

function pfCoversYear_(rows, today) {
  var earliest = '';
  (rows || []).forEach(function (row) {
    if (!row || !row.date) return;
    if (!earliest || row.date < earliest) earliest = row.date;
  });
  if (!earliest || !today) return false;
  return earliest <= pfAddDays_(today, -365);
}

function pfSpanDays_(rows) {
  var earliest = '';
  var latest = '';
  (rows || []).forEach(function (row) {
    if (!row || !row.date) return;
    if (!earliest || row.date < earliest) earliest = row.date;
    if (!latest || row.date > latest) latest = row.date;
  });
  if (!earliest || !latest) return 0;
  return pfDaysBetween(earliest, latest);
}

function pfTwseKind_(symbol) {
  var stock = /^(\d{4,6})\.TW$/i.exec(String(symbol || ''));
  if (stock) return { kind: 'stock', stockNo: stock[1] };
  if (symbol === '^TWII' || symbol === 'TWII') return { kind: 'index', stockNo: '' };
  return null;
}

function pfBenchmarkStep_(symbols, cursor, today) {
  var list = symbols && symbols.length ? symbols.slice() : ['0050.TW', '^TWII', 'SPY'];
  var state = cursor || {};
  var index = Number(state.i);
  if (!isFinite(index) || index < 0) index = 0;
  if (state.op === 'done' || index >= list.length) {
    var maint = Number(state.maint);
    if (!isFinite(maint) || maint < 0) maint = 0;
    var current = list[maint % list.length];
    var kind = pfTwseKind_(current);
    return {
      done: true,
      maintenance: true,
      symbol: current,
      op: kind ? 'twse' : 'yahoo',
      month: 0,
      monthKey: kind ? pfMonthKey_(today, 0) : '',
      symbolIndex: maint % list.length,
      symbolCount: list.length,
      hasTwse: !!kind,
      stockNo: kind ? kind.stockNo : '',
      twseKind: kind ? kind.kind : '',
      yahooRange: '2y'
    };
  }
  var symbol = list[index];
  var tw = pfTwseKind_(symbol);
  var op = state.op === 'twse' && tw ? 'twse' : 'yahoo';
  var month = Number(state.month);
  if (!isFinite(month)) month = 12;
  if (month < 0) month = 0;
  if (month > 12) month = 12;
  return {
    done: false,
    maintenance: false,
    symbol: symbol,
    op: op,
    month: month,
    monthKey: op === 'twse' ? pfMonthKey_(today, month) : '',
    symbolIndex: index,
    symbolCount: list.length,
    hasTwse: !!tw,
    stockNo: tw ? tw.stockNo : '',
    twseKind: tw ? tw.kind : '',
    yahooRange: '2y'
  };
}

function pfNextBenchmark_(step, yahooCovered) {
  if (!step || step.maintenance || step.done) {
    var count = step ? step.symbolCount : 0;
    var maint = ((step && step.symbolIndex) || 0) + 1;
    return { i: count, op: 'done', month: 0, maint: maint, done: true };
  }
  if (step.op === 'yahoo') {
    if (yahooCovered || !step.hasTwse) {
      var nextIndex = step.symbolIndex + 1;
      if (nextIndex >= step.symbolCount) return { i: nextIndex, op: 'done', month: 0, maint: 0, done: true };
      return { i: nextIndex, op: 'yahoo', month: 12, maint: 0, done: false };
    }
    return { i: step.symbolIndex, op: 'twse', month: 12, maint: 0, done: false };
  }
  if (step.month > 0) return { i: step.symbolIndex, op: 'twse', month: step.month - 1, maint: 0, done: false };
  var after = step.symbolIndex + 1;
  if (after >= step.symbolCount) return { i: after, op: 'done', month: 0, maint: 0, done: true };
  return { i: after, op: 'yahoo', month: 12, maint: 0, done: false };
}
