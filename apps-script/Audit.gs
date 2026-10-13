/** Append-only audit trail (spec 3.12). */
function auditRecord_(ctx, action, sheetName, recordId, before, after) {
  return {
    audit_id: newId_('AU'), at: nowIso_(), actor: ctx.actor, action: action,
    sheet: sheetName, record_id: recordId,
    before_json: before ? JSON.stringify(before) : '',
    after_json: after ? JSON.stringify(after) : '',
    request_id: ctx.request_id, client: ctx.client || CONFIG.CLIENT_DEFAULT
  };
}
function audit_(ctx, action, sheetName, recordId, before, after) {
  appendRecord_('Audit_Log', auditRecord_(ctx, action, sheetName, recordId, before, after));
}
function auditRows_(ctx, action, sheetName, items) {
  if (!items || !items.length) return;
  appendRecords_('Audit_Log', items.map(function (item) {
    return auditRecord_(ctx, action, sheetName, item.id, item.before, item.after);
  }));
}
