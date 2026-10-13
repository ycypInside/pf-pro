/** Spec 3.13 / V9. Same request_id + same hash => replay stored result; different hash => reject. */
function idemCheck_(requestId, hash) {
  var rows = readTable_('Idempotency');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].request_id === requestId) {
      if (rows[i].payload_hash !== hash) return { conflict: true };
      return { replay: true, status: rows[i].result_status, ref: rows[i].result_ref };
    }
  }
  return null;
}
function idemRecord_(requestId, endpoint, hash, status, ref) {
  appendRecord_('Idempotency', {
    request_id: requestId, received_at: nowIso_(), endpoint: endpoint,
    payload_hash: hash, result_status: status, result_ref: ref || ''
  });
}
/** Daily trigger: drop entries older than retention (default 90 days). */
function purgeIdempotency() {
  var days = Number(settings_().idempotency_retention_days || 90);
  var cutoff = new Date(Date.now() - days * 864e5);
  var sh = sheet_('Idempotency'), vals = sh.getDataRange().getValues();
  for (var i = vals.length - 1; i >= 1; i--) {
    var t = new Date(String(vals[i][1]));
    if (t < cutoff) sh.deleteRow(i + 1);
  }
}
