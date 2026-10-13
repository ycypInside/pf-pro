/** Configuration. Secrets live in Script Properties, never in code. */
var CONFIG = {
  // Script Properties keys:
  //   SPREADSHEET_ID  - id of "PF Pro v0.1"
  //   API_TOKEN       - long random string; clients send it as payload.token
  //   ALLOWED_EMAILS  - optional, comma-separated, for doGet when deployed as "only myself"
  TZ: 'Asia/Taipei',
  CLIENT_DEFAULT: 'web'
};
function props_() {
  var bag = req_();
  if (!bag.props) bag.props = PropertiesService.getScriptProperties();
  return bag.props;
}

/**
 * Warm isolates keep the API token here. beginRequest_ clears sheet memos only,
 * so a Properties blip cannot forget a token this process already read.
 */
var API_TOKEN_MEMO_ = '';

/** Script Properties can return blank under concurrent reads. Cache a non-empty value and retry once. */
function scriptProp_(key) {
  if (key === 'API_TOKEN' && API_TOKEN_MEMO_) return API_TOKEN_MEMO_;
  var cacheKey = 'pf:prop:' + key;
  try {
    var hit = CacheService.getScriptCache().get(cacheKey);
    if (hit) {
      if (key === 'API_TOKEN') API_TOKEN_MEMO_ = hit;
      return hit;
    }
  } catch (err) { /* cache miss */ }
  var value = '';
  try { value = props_().getProperty(key) || ''; } catch (err2) { value = ''; }
  if (!value) {
    Utilities.sleep(120);
    try { value = props_().getProperty(key) || ''; } catch (err3) { value = ''; }
  }
  if (value) {
    if (key === 'API_TOKEN') API_TOKEN_MEMO_ = value;
    try { CacheService.getScriptCache().put(cacheKey, value, 21600); } catch (err4) { /* still return the value */ }
  }
  return value;
}

function ss_() {
  var bag = req_();
  if (bag.ss) return bag.ss;
  var id = scriptProp_('SPREADSHEET_ID');
  bag.ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
  return bag.ss;
}
function ssId_() { return scriptProp_('SPREADSHEET_ID') || SpreadsheetApp.getActive().getId(); }
function sheet_(name) {
  var bag = req_();
  if (bag.sheets[name]) return bag.sheets[name];
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('missing sheet ' + name);
  bag.sheets[name] = sh;
  return sh;
}
function settings_() {
  var bag = req_();
  if (bag.settings) return bag.settings;
  var out = {};
  readTable_('Settings').forEach(function (row) { if (row.key) out[row.key] = row.value; });
  bag.settings = out;
  return out;
}

/** One-time setup via `clasp run setApiToken --params '["<token>"]'`. Token is never stored in code. */
function setApiToken(token) {
  if (!token || String(token).length < 32) throw new Error('token too short');
  props_().setProperty('API_TOKEN', String(token));
  API_TOKEN_MEMO_ = String(token);
  try {
    CacheService.getScriptCache().put('pf:prop:API_TOKEN', String(token), 21600);
  } catch (err) { /* the next read will load it from properties */ }
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
