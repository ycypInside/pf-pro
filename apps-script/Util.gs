function nowIso_() { return Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd'T'HH:mm:ss") + '+08:00'; }
function today_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'); }
function newId_(prefix, date) {
  var d = (date || today_()).replace(/-/g, '');
  var r = Utilities.getUuid().replace(/-/g, '').slice(0, 6);
  return prefix + '-' + d + '-' + r;
}
function sha256_(str) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}
/** Stable JSON (sorted keys) so the same payload always hashes the same. */
function stableJson_(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(stableJson_).join(',') + ']';
  return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stableJson_(o[k]); }).join(',') + '}';
}
/** Half-up after a tiny epsilon so values like 1186.5 * 32.15 become 38145.98, matching the spec. */
function roundDigits_(x, digits) {
  var n = Number(x);
  if (isNaN(n) || n === 0) return n === 0 ? 0 : n;
  var sign = n < 0 ? -1 : 1;
  var factor = Math.pow(10, digits);
  var rounded = sign * Math.round(Math.abs(n) * factor + 1e-6) / factor;
  return rounded === 0 ? 0 : rounded;
}
function round2_(x) { return roundDigits_(x, 2); }
function round4_(x) { return roundDigits_(x, 4); }
function num_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function daysBetween_(fromDate, toDate) {
  var a = Date.parse(fmtDate_(fromDate) + 'T00:00:00+08:00');
  var b = Date.parse(fmtDate_(toDate) + 'T00:00:00+08:00');
  return Math.floor((b - a) / 86400000);
}
function isDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)); }
function fmtDate_(v) { return v instanceof Date ? Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd') : String(v); }

/** Per-execution memo. Cleared at each web request and trigger so a warm isolate cannot leak rows. */
var REQ_ = null;
function beginRequest_() { REQ_ = { tables: {}, sheets: {} }; }
function req_() {
  if (!REQ_) REQ_ = { tables: {}, sheets: {} };
  return REQ_;
}
function clearDerived_() {
  var bag = req_();
  bag.accounts = null;
  bag.settings = null;
  bag.fx = null;
  bag.holdings = null;
  bag.pricesPayload = null;
  bag.balanceSums = null;
  bag.idem = null;
}

function rowFromRec_(hdr, rec) {
  return hdr.map(function (h) {
    var value = rec[h];
    return value === undefined || value === null ? '' : value;
  });
}

/** One getValues per sheet per request. Blank rows left by a rebuild are ignored. */
function readTable_(name) {
  var bag = req_();
  if (bag.tables[name]) return bag.tables[name];
  var sh = sheet_(name);
  var width = (SCHEMA[name] && SCHEMA[name].length) || 1;
  var lastCol = sh.getLastColumn();
  if (lastCol > 0 && lastCol < width) width = lastCol;
  var last = sh.getLastRow();
  if (last < 2 || width < 1) {
    bag.tables[name] = [];
    return bag.tables[name];
  }
  var vals = sh.getRange(1, 1, last, width).getValues();
  var hdr = vals[0];
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var any = false;
    var o = { _row: i + 1 };
    for (var j = 0; j < hdr.length; j++) {
      var cell = vals[i][j];
      if (cell !== '' && cell !== null) any = true;
      if (hdr[j]) o[hdr[j]] = cell;
    }
    if (any) out.push(o);
  }
  bag.tables[name] = out;
  return out;
}

function rememberRows_(name, start, recs) {
  var bag = req_();
  if (!bag.tables[name]) return;
  var hdr = SCHEMA[name];
  recs.forEach(function (rec, i) {
    var o = { _row: start + i };
    hdr.forEach(function (h) {
      var value = rec[h];
      o[h] = value === undefined || value === null ? '' : value;
    });
    bag.tables[name].push(o);
  });
}

function appendRecords_(name, recs) {
  if (!recs || !recs.length) return [];
  var hdr = SCHEMA[name];
  var sh = sheet_(name);
  var start = Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(start, 1, recs.length, hdr.length).setValues(recs.map(function (rec) { return rowFromRec_(hdr, rec); }));
  rememberRows_(name, start, recs);
  clearDerived_();
  return recs;
}
function appendRecord_(name, rec) {
  appendRecords_(name, [rec]);
  return rec;
}

/** Replace every data row in one setValues. Used by holdings and cashflows rebuilds. */
function replaceBody_(name, recs) {
  var hdr = SCHEMA[name];
  var sh = sheet_(name);
  var width = hdr.length;
  var list = recs || [];
  if (list.length) {
    sh.getRange(2, 1, list.length, width).setValues(list.map(function (rec) { return rowFromRec_(hdr, rec); }));
  }
  var last = sh.getLastRow();
  var firstClear = list.length + 2;
  if (last >= firstClear) sh.getRange(firstClear, 1, last - firstClear + 1, width).clearContent();
  var bag = req_();
  bag.tables[name] = list.map(function (rec, i) {
    var o = { _row: i + 2 };
    hdr.forEach(function (h) {
      var value = rec[h];
      o[h] = value === undefined || value === null ? '' : value;
    });
    return o;
  });
  clearDerived_();
  return list;
}

function updateCells_(name, rowNum, patch) {
  var hdr = SCHEMA[name];
  var sh = sheet_(name);
  var rows = req_().tables[name];
  var obj = null;
  if (rows) {
    for (var i = 0; i < rows.length; i++) if (rows[i]._row === rowNum) { obj = rows[i]; break; }
  }
  var line;
  if (obj) {
    Object.keys(patch).forEach(function (k) {
      if (hdr.indexOf(k) < 0) throw new Error('unknown column ' + k);
      obj[k] = patch[k];
    });
    line = rowFromRec_(hdr, obj);
  } else {
    line = sh.getRange(rowNum, 1, 1, hdr.length).getValues()[0];
    Object.keys(patch).forEach(function (k) {
      var c = hdr.indexOf(k);
      if (c < 0) throw new Error('unknown column ' + k);
      line[c] = patch[k];
    });
  }
  sh.getRange(rowNum, 1, 1, hdr.length).setValues([line]);
  clearDerived_();
}

function cachedGet_(key, build) {
  var cache = CacheService.getScriptCache();
  var gen = '0';
  try { gen = cache.get('pf:gen') || '0'; } catch (err) { gen = '0'; }
  var full = 'pf:r:' + gen + ':' + key;
  try {
    var hit = cache.get(full);
    if (hit) return JSON.parse(hit);
  } catch (err2) { /* miss */ }
  var payload = build();
  if (!payload || payload.ok !== true) return payload;
  var nowGen = gen;
  try { nowGen = cache.get('pf:gen') || '0'; } catch (err3) { nowGen = gen; }
  if (nowGen !== gen) return payload;
  try {
    var text = JSON.stringify(payload);
    if (text.length < 90000) cache.put(full, text, 60);
  } catch (err4) { /* payload larger than the cache slot, or cache unavailable */ }
  return payload;
}

function bumpCache_() {
  try { CacheService.getScriptCache().put('pf:gen', String(Date.now()), 21600); } catch (err) { /* next read rebuilds */ }
}
