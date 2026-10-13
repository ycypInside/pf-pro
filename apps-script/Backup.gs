/** Backups: weekly Drive copy of the whole spreadsheet; restore test verifies headers + row counts. */
function weeklyBackup() {
  var src = DriveApp.getFileById(ssId_());
  var folderId = props_().getProperty('BACKUP_FOLDER_ID');
  var name = 'PF Pro backup ' + nowIso_().slice(0, 16);
  var copy = folderId ? src.makeCopy(name, DriveApp.getFolderById(folderId)) : src.makeCopy(name);
  audit_({ actor: 'system', request_id: 'backup-' + today_(), client: 'script' }, 'config_change', '*', copy.getId(), null, { backup: name });
  return copy.getId();
}

/** Restore test: open a backup, check every SCHEMA header and that row counts are <= live. Read-only. */
function restoreTest(backupId) {
  var b = SpreadsheetApp.openById(backupId), live = ss_(), report = [];
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = b.getSheetByName(name);
    if (!sh) { report.push(name + ': MISSING'); return; }
    var hdr = sh.getRange(1, 1, 1, SCHEMA[name].length).getValues()[0];
    var okHdr = hdr.join('|') === SCHEMA[name].join('|');
    report.push(name + ': header ' + (okHdr ? 'ok' : 'MISMATCH') + ', rows backup=' + (sh.getLastRow() - 1) + ' live=' + (live.getSheetByName(name).getLastRow() - 1));
  });
  Logger.log(report.join('\n'));
  audit_({ actor: 'system', request_id: 'restoretest-' + today_(), client: 'script' }, 'restore', '*', backupId, null, { report: report });
  return report;
}

/** Header guard: run after any manual edit to the sheet structure. */
function verifySchema() {
  var bad = [];
  Object.keys(SCHEMA).forEach(function (name) {
    var hdr = sheet_(name).getRange(1, 1, 1, SCHEMA[name].length).getValues()[0];
    if (hdr.join('|') !== SCHEMA[name].join('|')) bad.push(name);
  });
  Logger.log(bad.length ? 'Header mismatch: ' + bad.join(', ') : 'All 13 headers match');
  return bad;
}
