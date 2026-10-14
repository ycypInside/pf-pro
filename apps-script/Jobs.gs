/** Scheduled jobs. Install with installTriggers() once. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailySnapshot').timeBased().atHour(23).everyDays(1).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('fetchBenchmarks').timeBased().atHour(22).everyDays(1).inTimezone(CONFIG.TZ).create();
  // BOT publishes the board in the afternoon. nearMinute(30) aims at 16:30 Taipei, within a quarter hour.
  ScriptApp.newTrigger('fetchBotFx').timeBased().everyDays(1).atHour(16).nearMinute(30).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('purgeIdempotency').timeBased().atHour(3).everyDays(1).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).inTimezone(CONFIG.TZ).create();
}

/** Phase-1 basic snapshot (spec 3.9). Never overwrites an existing date; V11 + V13. */
function dailySnapshot() {
  beginRequest_();
  if (fxNeedsFetch_(fxDate_('USDTWD'), today_())) fetchBotFxBody_();
  try { syncMarketPrices_(); } catch (pErr) { Logger.log('price sync skipped: ' + pErr); }
  var wrote = writeSnapshot_();
  try { refreshPerfCache_(90000); }
  catch (err) { Logger.log('perf cache skipped: ' + err); }
  return wrote;
}

function writeSnapshot_() {
  var date = today_();
  var existing = readTable_('Snapshots').some(function (s) { return fmtDate_(s.snapshot_date) === date; });
  if (existing) return false;
  var accounts = accountsById_(), fx = latestFx_('USDTWD');
  var assets = 0, liabs = 0, cash = 0, inv = 0;
  Object.keys(accounts).forEach(function (id) {
    var a = accounts[id];
    if (a.status !== 'active' || a.type === 'other' && !a.parent_account_id) return;
    var rate = a.currency === 'TWD' ? 1 : latestFx_(a.currency + 'TWD');
    if (!rate) return;
    var twd = round2_(balanceOf_(id, accounts) * rate);
    if (['loan', 'credit_card'].indexOf(a.type) >= 0) liabs += Math.abs(twd);
    else { assets += twd; if (String(a.is_investment).toUpperCase() === 'TRUE') inv += twd; else cash += twd; }
  });
  try {
    computeHoldings_().forEach(function (h) {
      if (h.market_value_twd === '' || h.market_value_twd === null || isNaN(Number(h.market_value_twd))) return;
      var hv = Number(h.market_value_twd);
      assets += hv;
      inv += hv;
    });
  } catch (err) { Logger.log('holdings snapshot skipped: ' + err); }
  var m = date.slice(0, 7), ie = incomeExpense_(m + '-01', date);
  var ext = 0;
  readTable_('Transactions').forEach(function (t) {
    if (t.status === 'active' && fmtDate_(t.date).slice(0, 7) === m && t.flow_class === 'external' && String((accounts[t.account_id] || {}).is_investment).toUpperCase() === 'TRUE') ext += Number(t.amount_twd);
  });
  var stale = 0;
  try { stale = pricesPayload_().stale.length; } // V13, age vs Settings thresholds
  catch (err) { Logger.log('stale count failed: ' + err); }
  var nw = round2_(assets - liabs);
  if (Math.abs(nw - (round2_(assets) - round2_(liabs))) > 1) Logger.log('V11 mismatch'); // V11
  appendRecord_('Snapshots', {
    snapshot_date: date, total_assets_twd: round2_(assets), total_liabilities_twd: round2_(liabs), net_worth_twd: nw,
    cash_twd: round2_(cash), investments_twd: round2_(inv), fx_usdtwd: fx || '', month_income_twd: ie.income_twd,
    month_expense_twd: ie.expense_twd, savings_rate: ie.income_twd ? round2_((ie.income_twd - ie.expense_twd) / ie.income_twd) : '',
    external_flow_twd: round2_(ext), stale_price_count: stale, calc_version: 'p2-0.2', created_at: nowIso_()
  });
  var w = dailyChecks_();
  if (w.length) audit_({ actor: 'system', request_id: 'job-' + date, client: 'script' }, 'config_change', 'Snapshots', date, null, { warnings: w });
  return true;
}

/** Latest fx (Bank of Taiwan spot mid) from Prices_FX; append-only table, newest date wins. */
function latestFxMap_() {
  var bag = req_();
  if (bag.fx) return bag.fx;
  var best = {};
  readTable_('Prices_FX').forEach(function (p) {
    if (p.kind !== 'fx' || !p.symbol) return;
    var date = fmtDate_(p.date);
    var prev = best[p.symbol];
    if (!prev || date > prev.date) best[p.symbol] = { date: date, value: Number(p.value) };
  });
  bag.fx = best;
  return best;
}
function latestFx_(pair) {
  var row = latestFxMap_()[pair];
  return row ? row.value : null;
}
function fxDate_(pair) {
  var row = latestFxMap_()[pair];
  return row ? row.date : '';
}

/**
 * Semi-auto FX: Bank of Taiwan publishes a public CSV of spot rates.
 * mid = (spot buy + spot sell) / 2. Appends; never overwrites; on failure writes nothing.
 * Verify column positions against the live CSV before enabling a trigger.
 */
function fetchBotFx() {
  beginRequest_();
  return fetchBotFxBody_();
}

function fetchBotFxBody_() {
  var url = 'https://rate.bot.com.tw/xrt/flcsv/0/day';
  var date = today_();
  var added = [];
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
    var csv = Utilities.parseCsv(res.getContentText('UTF-8'));
    var have = {};
    readTable_('Prices_FX').forEach(function (p) {
      if (p.source === 'bank' && fmtDate_(p.date) === date) have[p.symbol] = true;
    });
    csv.slice(1).forEach(function (r) {
      var ccy = String(r[0]).trim();
      if (['USD', 'JPY', 'EUR', 'CNY', 'HKD', 'AUD', 'GBP'].indexOf(ccy) < 0) return;
      var spotBuy = Number(r[3]), spotSell = Number(r[13]);
      if (!(spotBuy > 0 && spotSell > 0)) return;
      var sym = ccy + 'TWD';
      if (have[sym]) return;
      have[sym] = true;
      added.push({
        symbol: sym, kind: 'fx', date: date, value: Math.round((spotBuy + spotSell) / 2 * 10000) / 10000, currency: 'TWD',
        source: 'bank', fetched_at: nowIso_(), is_stale: false, note: 'BOT spot mid'
      });
    });
    if (added.length) {
      appendRecords_('Prices_FX', added);
      auditRows_({ actor: 'system', request_id: 'fx-' + date, client: 'script' }, 'price_import', 'Prices_FX', added.map(function (rec) {
        return { id: rec.symbol + '@' + date, before: null, after: rec };
      }));
    }
  } catch (err) { Logger.log('fx fetch failed, keeping last value: ' + err); }
  return added.length;
}
