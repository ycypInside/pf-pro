/** Configuration. Secrets live in Script Properties, never in code. */
var CONFIG = {
  // Script Properties keys:
  //   SPREADSHEET_ID  - id of "PF Pro v0.1"
  //   API_TOKEN       - long random string; clients send it as payload.token
  //   ALLOWED_EMAILS  - optional, comma-separated, for doGet when deployed as "only myself"
  TZ: 'Asia/Taipei',
  CLIENT_DEFAULT: 'web'
};
function props_() { return PropertiesService.getScriptProperties(); }
function ss_() {
  var id = props_().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive(); // bound-script fallback
}
function ssId_() { return props_().getProperty('SPREADSHEET_ID') || SpreadsheetApp.getActive().getId(); }
function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('missing sheet ' + name);
  return sh;
}
function settings_() {
  var rows = sheet_('Settings').getDataRange().getValues(), out = {};
  for (var i = 1; i < rows.length; i++) if (rows[i][0]) out[rows[i][0]] = rows[i][1];
  return out;
}

/** One-time setup via `clasp run setApiToken --params '["<token>"]'`. Token is never stored in code. */
function setApiToken(token) {
  if (!token || String(token).length < 32) throw new Error('token too short');
  props_().setProperty('API_TOKEN', String(token));
  if (!props_().getProperty('SPREADSHEET_ID')) props_().setProperty('SPREADSHEET_ID', SpreadsheetApp.getActive().getId());
  return 'API_TOKEN set (' + String(token).length + ' chars)';
}
/** Editor fallback: generates a token in Script Properties and logs it once; copy it into secrets/api_token. */
function setupGenerateApiToken() {
  if (props_().getProperty('API_TOKEN')) { Logger.log('API_TOKEN already set; not overwriting'); return; }
  var t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  setApiToken(t);
  Logger.log('New API_TOKEN (copy now, shown once): ' + t);
}
