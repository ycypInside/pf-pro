/**
 * P1: wealth plan, DCA schedule, holding cards (rules) and alerts.
 * Sheets are created by the ensure_p1_sheets action. Reads are GET (read-only token ok); writes are audited POST actions.
 */
var P1_SCHEMA = {
  Plan: ['plan_id', 'track', 'label', 'year', 'target_date', 'target_twd', 'baseline_date', 'baseline_twd', 'monthly_twd', 'cagr', 'status', 'note', 'updated_at'],
  DCA: ['dca_id', 'asset_id', 'symbol', 'name', 'account_id', 'currency', 'amount', 'debit_day', 'start_date', 'status', 'last_debit_date', 'core', 'note', 'updated_at'],
  Holding_Rules: ['rule_key', 'card_key', 'card_name', 'card_class', 'asset_ids', 'card_status', 'rule_id', 'type', 'level', 'pct', 'date', 'confirm_days', 'grp', 'tier', 'info', 'action', 'reason', 'seed_peak', 'events', 'card_note', 'status', 'updated_at']
};
var P1_KEY = { Plan: 'plan_id', DCA: 'dca_id', Holding_Rules: 'rule_key', Paper_Daily: 'row_id' };

function ensureP1Sheets_() {
  var ss = ss_(), out = [];
  Object.keys(P1_SCHEMA).forEach(function (name) {
    var hdr = P1_SCHEMA[name];
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, hdr.length).setValues([hdr]);
      sh.setFrozenRows(1);
      out.push({ sheet: name, created: true, headers_ok: true });
      return;
    }
    var have = sh.getRange(1, 1, 1, hdr.length).getValues()[0].map(String);
    out.push({ sheet: name, created: false, headers_ok: have.join('|') === hdr.join('|'), have: have });
  });
  return out;
}

function p1Clean_(table, row) {
  var hdr = P1_SCHEMA[table], rec = {};
  hdr.forEach(function (h) {
    var v = row[h];
    if (v === undefined || v === null) v = '';
    if (typeof v === 'object') v = JSON.stringify(v);
    rec[h] = v;
  });
  rec.updated_at = nowIso_();
  return rec;
}

/** Insert or update rows by key; returns counts. Each change is audited. */
function upsertP1_(table, rows, ctx) {
  if (table === 'Paper_Daily' && !P1_SCHEMA.Paper_Daily) P1_SCHEMA.Paper_Daily = PAPER_HDR;
  if (!P1_SCHEMA[table]) fail_('V1', 'unknown table');
  if (!rows || !rows.length) fail_('V1', 'rows required');
  var key = P1_KEY[table];
  var existing = {};
  readTable_(table).forEach(function (r) { existing[String(r[key])] = r; });
  var inserted = [], updated = 0, same = 0, audits = [];
  rows.forEach(function (row) {
    var id = String(row[key] || '').trim();
    if (!id) fail_('V1', 'missing ' + key);
    var rec = p1Clean_(table, row);
    var prev = existing[id];
    if (!prev) { inserted.push(rec); existing[id] = rec; audits.push({ id: id, before: null, after: rec }); return; }
    var patch = {};
    P1_SCHEMA[table].forEach(function (h) {
      if (h === 'updated_at' || row[h] === undefined) return;
      var a = prev[h], same0 = p1Norm_(a) === p1Norm_(rec[h]);
      if (!same0 && a instanceof Date) same0 = Utilities.formatDate(a, 'UTC', 'yyyy-MM-dd') === String(rec[h]) || Utilities.formatDate(new Date(a.getTime() + 12 * 3600000), 'UTC', 'yyyy-MM-dd') === String(rec[h]);
      if (!same0) patch[h] = rec[h];
    });
    if (!Object.keys(patch).length) { same++; return; }
    patch.updated_at = rec.updated_at;
    var before = {}; Object.keys(patch).forEach(function (k) { before[k] = prev[k]; });
    updateCells_(table, prev._row, patch);
    updated++; audits.push({ id: id, before: before, after: patch });
  });
  if (inserted.length) appendRecords_(table, inserted);
  auditRows_(ctx, 'config_change', table, audits);
  return { ids: audits.map(function (a) { return a.id; }), inserted: inserted.length, updated: updated, unchanged: same };
}

function p1Rows_(table) {
  try { return readTable_(table).map(strip_); } catch (e) { return null; }
}

// ---------- reads ----------
function planPayload_() {
  var rows = p1Rows_('Plan');
  if (rows === null) return { ok: false, error: 'Plan sheet missing' };
  var bal = balancesPayload_();
  var nw = bal.net_worth.net_worth_twd;
  var today = today_();
  var tracks = {};
  rows.forEach(function (r) {
    if (r.status && r.status !== 'active') return;
    var t = tracks[r.track] = tracks[r.track] || { track: r.track, label: '', baseline_date: '', baseline_twd: 0, monthly_twd: 0, cagr: 0, milestones: [] };
    if (r.baseline_twd !== '') { t.baseline_twd = Number(r.baseline_twd); t.baseline_date = fmtDate_(r.baseline_date); t.monthly_twd = Number(r.monthly_twd) || 0; t.cagr = Number(r.cagr) || 0; }
    if (r.label && Number(r.year) === 0) t.label = r.label;
    if (Number(r.year) > 0) t.milestones.push({ year: Number(r.year), target_date: fmtDate_(r.target_date), target_twd: Number(r.target_twd), note: r.note || '' });
  });
  var out = Object.keys(tracks).map(function (k) {
    var t = tracks[k];
    t.milestones.sort(function (a, b) { return a.year - b.year; });
    var months = t.baseline_date ? Math.max(0, daysBetween_(t.baseline_date, today) / 30.4375) : 0;
    var r = Math.pow(1 + t.cagr, 1 / 12) - 1;
    var planNow = t.baseline_twd * Math.pow(1 + r, months) + (r ? t.monthly_twd * (Math.pow(1 + r, months) - 1) / r : t.monthly_twd * months);
    var next = t.milestones.filter(function (m) { return m.target_date >= today; })[0] || null;
    t.plan_now_twd = round2_(planNow);
    t.actual_twd = nw;
    t.gap_twd = round2_(nw - planNow);
    t.gap_pct = planNow ? pfRound6(nw / planNow - 1) : null;
    t.months_elapsed = Math.round(months * 10) / 10;
    t.next_milestone = next;
    t.on_track = nw >= planNow;
    return t;
  });
  var main = out.filter(function (t) { return t.track === 'main'; })[0];
  var y1 = main ? main.milestones.filter(function (m) { return m.year === 1; })[0] : null;
  var start = main ? main.baseline_twd : 14020000, y1t = y1 ? y1.target_twd : 16540000;
  var pathD = { start_twd: start, start_date: main ? main.baseline_date : '2026-09-16', year1_target_twd: y1t, year1_date: y1 ? y1.target_date : '2027-09-16',
    actual_twd: nw, progress_pct: y1t > start ? pfRound6((nw - start) / (y1t - start)) : null, remaining_twd: round2_(y1t - nw) };
  return { ok: true, as_of: today, net_worth_twd: nw, path_d: pathD, nw_day_change: nwDayChange_(), tracks: out,
    note: '計畫值以基期淨值、月投入與年化報酬（月複利）推算；實際值為目前淨值（含非計畫內資產）。' };
}

function dcaPayload_() {
  var rows = p1Rows_('DCA');
  if (rows === null) return { ok: false, error: 'DCA sheet missing' };
  var pol = targetPolicy_();
  var bal = balancesPayload_();
  var brake = cashBrake_(pol, bal, null);
  var paused = brake.enabled && brake.triggered;
  var month = today_().slice(0, 7);
  var fx = latestFxMap_ ? latestFxMap_() : {};
  var totalTwd = 0;
  var items = rows.map(function (r) {
    var last = r.last_debit_date ? fmtDate_(r.last_debit_date) : '';
    var amt = Number(r.amount) || 0;
    var rate = r.currency === 'TWD' ? 1 : Number((fx[r.currency + 'TWD'] || {}).value || fx[r.currency + 'TWD'] || 0);
    if (r.status === 'active') totalTwd += amt * (rate || 0);
    var dueDay = Number(r.debit_day) || null;
    var state = r.status !== 'active' ? r.status
      : last.slice(0, 7) === month ? 'debited'
      : paused ? 'paused_by_brake' : 'pending';
    return { dca_id: r.dca_id, asset_id: r.asset_id, symbol: r.symbol, name: r.name, account_id: r.account_id, currency: r.currency,
      amount: amt, amount_twd: rate ? round2_(amt * rate) : null, debit_day: dueDay, last_debit_date: last, status: r.status,
      month_state: state, core: String(r.core).toUpperCase() === 'TRUE', note: r.note || '' };
  });
  return { ok: true, month: month, items: items, monthly_total_twd: round2_(totalTwd), brake: brake,
    note: '本月狀態依 last_debit_date 判斷；煞車只暫停裁量加碼與定額（依政策 dca_pause），核心定額豁免另見 dca_exempt_enabled。' };
}

function holdingCardsPayload_() {
  var rows = p1Rows_('Holding_Rules');
  if (rows === null) return { ok: false, error: 'Holding_Rules sheet missing' };
  var cards = {}, order = [];
  rows.forEach(function (r) {
    var c = cards[r.card_key];
    if (!c) {
      c = cards[r.card_key] = { card_key: r.card_key, name: r.card_name, cls: r.card_class, asset_ids: String(r.asset_ids || '').split(',').filter(Boolean),
        status: r.card_status, seed_peak: r.seed_peak === '' ? null : Number(r.seed_peak), events: p1Json_(r.events, []), note: r.card_note || '', rules: [] };
      order.push(r.card_key);
    }
    c.rules.push(ruleOf_(r));
  });
  return { ok: true, cards: order.map(function (k) { return cards[k]; }) };
}

function p1Json_(v, dflt) { try { return v === '' || v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } }

function ruleOf_(r) {
  return { rule_key: r.rule_key, id: r.rule_id, type: r.type, level: r.level === '' ? null : Number(r.level), pct: r.pct === '' ? null : Number(r.pct),
    date: r.date ? fmtDate_(r.date) : '', confirm_days: Number(r.confirm_days) || 1, group: r.grp, tier: Number(r.tier) || 1,
    info: String(r.info).toUpperCase() === 'TRUE', action: r.action, reason: r.reason, status: r.status || 'active' };
}

/** Evaluate every active rule against public prices (Yahoo) or stored NAV history. */
function alertsPayload_() {
  var cardsP = holdingCardsPayload_();
  if (!cardsP.ok) return cardsP;
  var assets = assetsById_();
  var holdings = computeHoldings_();
  var bal = balancesPayload_();
  var nw = bal.net_worth.net_worth_twd || 1;
  var mvBy = {}, staleBy = {};
  holdings.forEach(function (h) { mvBy[h.asset_id] = (mvBy[h.asset_id] || 0) + (Number(h.market_value_twd) || 0); if (h.is_stale) staleBy[h.asset_id] = h.price_date; });
  var ysyms = {}, list = [];
  cardsP.cards.forEach(function (c) { c.asset_ids.forEach(function (id) { var a = assets[id]; var y = a ? yahooSymbol_(a) : ''; if (y) { ysyms[id] = y; if (list.indexOf(y) < 0) list.push(y); } }); });
  var series = yahooSeriesMany_(list, '1y');
  var stored = storedHistory_();
  var today = today_();
  var alerts = [], evaluated = 0;
  cardsP.cards.forEach(function (c) {
    if (c.status !== 'active') return;
    var id0 = c.asset_ids[0];
    var rows = id0 && ysyms[id0] ? series[ysyms[id0]] : null;
    var closes = rows ? rows.map(function (r) { return r.c; }) : (id0 && stored[id0] ? stored[id0].map(function (r) { return r.v; }) : []);
    var last = closes.length ? closes[closes.length - 1] : null;
    var mv = c.asset_ids.reduce(function (s, id) { return s + (mvBy[id] || 0); }, 0);
    c.rules.forEach(function (r) {
      if (r.status !== 'active') return;
      evaluated++;
      var hit = false, detail = '';
      if ((r.type === 'close_below' || r.type === 'close_above') && r.level != null && closes.length) {
        var n = Math.max(1, r.confirm_days), tail = closes.slice(-n);
        var cnt = 0; for (var i = closes.length - 1; i >= 0; i--) { if (r.type === 'close_below' ? closes[i] < r.level : closes[i] > r.level) cnt++; else break; }
        hit = tail.length >= n && cnt >= n;
        detail = '收盤 ' + round4_(last) + (r.type === 'close_below' ? ' / 線 ' : ' / 目標 ') + r.level + '，連續 ' + cnt + '/' + n + ' 日';
        if (!hit && cnt > 0) alerts.push(alertOf_(c, r, 'watch', detail));
      } else if (r.type === 'dd_from_peak' && r.pct != null && closes.length) {
        var peak = Math.max.apply(null, closes.slice(-250).concat(c.seed_peak ? [c.seed_peak] : []));
        var dd = last / peak - 1;
        hit = -dd * 100 >= r.pct;
        detail = '自高點 ' + round4_(peak) + ' 回檔 ' + (dd * 100).toFixed(1) + '%（門檻 ' + r.pct + '%）';
      } else if (r.type === 'pct_nw_above' && r.pct != null) {
        var w = mv / nw * 100;
        hit = w > r.pct;
        detail = '佔淨值 ' + w.toFixed(1) + '%（門檻 ' + r.pct + '%）';
      } else if (r.type === 'date_reached' && r.date) {
        var dleft = daysBetween_(today, r.date);
        hit = dleft <= 0 && dleft > -14;
        if (!hit && dleft > 0 && dleft <= 7) alerts.push(alertOf_(c, r, 'upcoming', r.date + '（' + dleft + ' 天後）'));
        detail = r.date;
      } else if (r.type === 'stale_quote') {
        var sd = c.asset_ids.map(function (id) { return staleBy[id]; }).filter(Boolean);
        hit = sd.length > 0;
        detail = hit ? '報價日 ' + sd.join('、') : '';
      }
      if (hit) alerts.push(alertOf_(c, r, r.info ? 'info' : (r.tier >= 2 ? 'red' : 'amber'), detail));
    });
  });
  var rank = { red: 0, amber: 1, watch: 2, upcoming: 3, info: 4 };
  alerts.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
  return { ok: true, at: nowIso_(), evaluated: evaluated, alerts: alerts,
    disclaimer: '依持股卡規則與公開價格自動比對；僅為檢討提醒，不是操作單。' };
}

function alertOf_(c, r, level, detail) {
  return { level: level, card_key: c.card_key, name: c.name, rule_key: r.rule_key, rule_id: r.id, type: r.type,
    action: r.action, reason: r.reason, detail: detail, asset_ids: c.asset_ids };
}

function p1Norm_(v) {
  if (v instanceof Date) return fmtDate_(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  var s = String(v == null ? '' : v);
  if (/^(true|false)$/i.test(s)) return s.toUpperCase();
  if (s !== '' && !isNaN(Number(s))) return String(Number(s));
  return s;
}
