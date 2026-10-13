/** Spec 3.13 / V9. Same request_id + same hash => replay stored result; different hash => reject. */
function idemIndex_() {
  var bag = req_();
  if (bag.idem) return bag.idem;
  var map = {};
  readTable_('Idempotency').forEach(function (row) { if (row.request_id) map[row.request_id] = row; });
  bag.idem = map;
  return map;
}
function idemCheck_(requestId, hash) {
  var row = idemIndex_()[requestId];
  if (!row) return null;
  if (row.payload_hash !== hash) return { conflict: true };
  return { replay: true, status: row.result_status, ref: row.result_ref };
}
function idemRecord_(requestId, endpoint, hash, status, ref) {
  appendRecord_('Idempotency', {
    request_id: requestId, received_at: nowIso_(), endpoint: endpoint,
    payload_hash: hash, result_status: status, result_ref: ref || ''
  });
}
/** Daily trigger: drop entries older than retention (default 90 days). */
function purgeIdempotency() {
  beginRequest_();
  var days = Number(settings_().idempotency_retention_days || 90);
  var cutoff = new Date(Date.now() - days * 864e5);
  var sh = sheet_('Idempotency');
  var last = sh.getLastRow();
  if (last < 2) return;
  var vals = sh.getRange(1, 1, last, 2).getValues();
  for (var i = vals.length - 1; i >= 1; i--) {
    var t = new Date(String(vals[i][1]));
    if (t < cutoff) sh.deleteRow(i + 1);
  }
}
