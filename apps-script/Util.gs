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
  return sign * Math.round(Math.abs(n) * factor + 1e-6) / factor;
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

/** Read a sheet as array of objects keyed by header. Row number kept in _row. */
function readTable_(name) {
  var sh = sheet_(name), vals = sh.getDataRange().getValues(), hdr = vals[0], out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _row: i + 1 };
    for (var j = 0; j < hdr.length; j++) o[hdr[j]] = vals[i][j];
    out.push(o);
  }
  return out;
}
function appendRecord_(name, rec) {
  var hdr = SCHEMA[name];
  var row = hdr.map(function (h) { return rec[h] === undefined ? '' : rec[h]; });
  sheet_(name).appendRow(row);
  return rec;
}
function updateCells_(name, rowNum, patch) {
  var sh = sheet_(name), hdr = SCHEMA[name];
  Object.keys(patch).forEach(function (k) {
    var c = hdr.indexOf(k);
    if (c < 0) throw new Error('unknown column ' + k);
    sh.getRange(rowNum, c + 1).setValue(patch[k]);
  });
}
