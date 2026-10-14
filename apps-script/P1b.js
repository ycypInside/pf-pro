/** Paper sleeves (isolated from real holdings), net-worth day change, pending decisions. */
var PAPER_HDR = ['row_id', 'date', 'sleeve', 'kind', 'label', 'capital_twd', 'equity_twd', 'cash_twd', 'return_pct', 'drawdown_pct', 'max_dd_pct',
  'trading_days', 'cash_pct', 'n_positions', 'vs_0050_pp', 'vs_00631L_pp', 'gate_target_pct', 'gate_json', 'flags', 'positions_json', 'status', 'updated_at'];

function ensurePaperSheet_() {
  var ss = ss_(), sh = ss.getSheetByName('Paper_Daily');
  if (!sh) {
    sh = ss.insertSheet('Paper_Daily');
    sh.getRange(1, 1, 1, PAPER_HDR.length).setValues([PAPER_HDR]);
    sh.setFrozenRows(1);
    return { sheet: 'Paper_Daily', created: true, headers_ok: true };
  }
  var have = sh.getRange(1, 1, 1, PAPER_HDR.length).getValues()[0].map(String);
  return { sheet: 'Paper_Daily', created: false, headers_ok: have.join('|') === PAPER_HDR.join('|') };
}

function annualized_(retPct, days) {
  if (retPct === '' || retPct == null || !(Number(days) > 0)) return null;
  var r = Number(retPct) / 100;
  if (r <= -1) return -100;
  return Math.round((Math.pow(1 + r, 252 / Number(days)) - 1) * 10000) / 100;
}

function paperPayload_() {
  var rows;
  try { rows = readTable_('Paper_Daily').map(strip_); } catch (e) { return { ok: false, error: 'Paper_Daily sheet missing' }; }
  var by = {};
  rows.forEach(function (r) {
    var d = fmtDate_(r.date), s = String(r.sleeve);
    if (/^\d{1,3}$/.test(s)) s = ('0000' + s).slice(-4);
    (by[s] = by[s] || []).push({ date: d, row: r });
  });
  var sleeves = [], bench = {};
  Object.keys(by).sort().forEach(function (s) {
    var list = by[s].sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var last = list[list.length - 1].row;
    var series = list.map(function (x) { return { date: x.date, return_pct: num_(x.row.return_pct), equity_twd: x.row.equity_twd === '' ? null : num_(x.row.equity_twd), drawdown_pct: x.row.drawdown_pct === '' ? null : num_(x.row.drawdown_pct) }; });
    if (last.kind === 'benchmark') {
      bench[s] = { symbol: s, as_of: fmtDate_(last.date), return_pct: num_(last.return_pct), max_dd_pct: num_(last.max_dd_pct), series: series };
      return;
    }
    var days = Number(last.trading_days) || 0;
    var gate = p1Json_(last.gate_json, null);
    var target = last.gate_target_pct === '' ? 21.71 : Number(last.gate_target_pct);
    var ann = annualized_(last.return_pct, days);
    sleeves.push({
      sleeve: s, label: last.label, status: last.status, as_of: fmtDate_(last.date),
      capital_twd: num_(last.capital_twd), equity_twd: last.equity_twd === '' ? null : num_(last.equity_twd), cash_twd: last.cash_twd === '' ? null : num_(last.cash_twd),
      return_pct: num_(last.return_pct), drawdown_pct: last.drawdown_pct === '' ? null : num_(last.drawdown_pct), max_dd_pct: num_(last.max_dd_pct),
      trading_days: days, trading_days_required: gate && gate.min_trading_days ? gate.min_trading_days : 20,
      trading_days_label: days + '/' + (gate && gate.min_trading_days ? gate.min_trading_days : 20),
      annualized_pct: ann, annualized_target_pct: target, annualized_ok: ann != null && days >= 20 && ann >= target,
      vs_0050_pp: last.vs_0050_pp === '' ? null : num_(last.vs_0050_pp), vs_00631L_pp: last.vs_00631L_pp === '' ? null : num_(last.vs_00631L_pp),
      cash_pct: last.cash_pct === '' ? null : num_(last.cash_pct), n_positions: num_(last.n_positions),
      flags: p1Json_(last.flags, []), gate: gate, positions: p1Json_(last.positions_json, []), series: series
    });
  });
  return { ok: true, mode: 'paper', sleeves: sleeves, benchmarks: bench,
    note: '模擬倉，與實際持倉完全分開，不計入淨值與配置。年化以 252 交易日換算，交易日不足 20 日時僅供參考。' };
}

/** Day-over-day net worth change from Perf_Daily (null when fewer than two points). */
function nwDayChange_() {
  var rows = [];
  try { rows = readPerfRows_().filter(function (r) { return r.nav; }); } catch (e) { rows = []; }
  rows.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  if (rows.length < 2) return { change_twd: null, change_pct: null, date: rows.length ? rows[0].date : null, prev_date: null, points: rows.length };
  var a = rows[rows.length - 2], b = rows[rows.length - 1];
  return { change_twd: round2_(b.nav - a.nav), change_pct: a.nav ? pfRound6(b.nav / a.nav - 1) : null, date: b.date, prev_date: a.date,
    nav: b.nav, prev_nav: a.nav, points: rows.length, basis: 'Perf_Daily.nav' };
}

/** Items waiting on a human decision. Trade tickets: none yet (Orders table is P2). */
function decisionsPayload_() {
  var al = alertsPayload_();
  var pol = targetPolicy_();
  var bal = balancesPayload_();
  var brake = cashBrake_(pol, bal, null);
  var holdings = computeHoldings_();
  var exits = (al.alerts || []).filter(function (a) { return a.level === 'red' || a.level === 'amber'; });
  var dca = null; try { dca = dcaPayload_(); } catch (e) { dca = null; }
  var paused = dca && dca.items ? dca.items.filter(function (i) { return i.month_state === 'paused_by_brake'; }) : [];
  var stale = staleHoldings_(holdings);
  var items = [];
  exits.forEach(function (a) { items.push({ kind: 'exit_line', level: a.level, title: a.name + '：' + a.action, detail: a.detail, ref: a.rule_key }); });
  if (brake.enabled && brake.triggered) items.push({ kind: 'dca_paused', level: 'amber', title: '現金煞車：暫停定額', detail: brake.reason, ref: paused.map(function (p) { return p.dca_id; }).join(',') });
  stale.forEach(function (s) { items.push({ kind: 'stale_quote', level: 'info', title: s.name + ' 報價過期', detail: '報價日 ' + s.price_date + '，上限 ' + s.limit + ' 天', ref: s.asset_id }); });
  return { ok: true, at: nowIso_(), count: items.length, items: items,
    exit_lines: exits, dca_paused: brake.enabled && brake.triggered, dca_paused_items: paused, cash_brake: brake,
    stale_quotes: stale, trade_tickets: [], nw_day_change: nwDayChange_(),
    disclaimer: '待決事項僅為提醒，不是操作單。' };
}
