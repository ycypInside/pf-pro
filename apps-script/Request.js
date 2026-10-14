/** Pure request helpers. Apps Script loads this as globals; Node tests load the same file. */

function decodeParam_(text) {
  var raw = String(text == null ? '' : text).replace(/\+/g, ' ');
  try { return decodeURIComponent(raw); }
  catch (err) { return raw; }
}

/**
 * Merge Apps Script GET inputs.
 * e.parameter wins when it is non-empty. e.parameters uses the last non-empty
 * value. The raw query string fills anything still missing, last occurrence wins.
 */
function mergeRequestParams_(parameter, parameters, queryString) {
  var out = {};
  if (queryString) {
    String(queryString).split('&').forEach(function (part) {
      if (!part) return;
      var i = part.indexOf('=');
      var key = decodeParam_(i < 0 ? part : part.slice(0, i));
      var val = decodeParam_(i < 0 ? '' : part.slice(i + 1));
      if (key) out[key] = val;
    });
  }
  if (parameters) {
    Object.keys(parameters).forEach(function (key) {
      var vals = parameters[key];
      if (Object.prototype.toString.call(vals) === '[object Array]') {
        for (var n = vals.length - 1; n >= 0; n--) {
          if (vals[n] !== undefined && vals[n] !== null && String(vals[n]) !== '') {
            out[key] = String(vals[n]);
            break;
          }
        }
      } else if (vals !== undefined && vals !== null && String(vals) !== '') {
        out[key] = String(vals);
      }
    });
  }
  if (parameter) {
    Object.keys(parameter).forEach(function (key) {
      if (parameter[key] !== undefined && parameter[key] !== null && String(parameter[key]) !== '') {
        out[key] = String(parameter[key]);
      }
    });
  }
  return out;
}

/**
 * null means accept.
 * auth_unavailable / missing_secret: the script has no token to compare.
 * unauthorized / missing_token: the client sent nothing (a 302 can drop the POST body).
 * unauthorized / mismatch: a token arrived and it is not the stored one.
 */
function decideAuth_(presented, stored) {
  var expected = stored == null ? '' : String(stored).trim();
  if (!expected) return { error: 'auth_unavailable', reason: 'missing_secret' };
  var given = presented == null ? '' : String(presented).trim();
  if (!given) return { error: 'unauthorized', reason: 'missing_token' };
  if (given !== expected) return { error: 'unauthorized', reason: 'mismatch' };
  return null;
}

/**
 * A 302 turns the POST into a GET and drops the body. The query still has the
 * token, and either no q or the m=post marker the client adds to POST URLs.
 */
function lostPostBody_(params) {
  var token = params && params.token != null ? String(params.token).trim() : '';
  if (!token) return false;
  if (String(params.m || '') === 'post') return true;
  var q = params.q == null ? '' : String(params.q).trim();
  return !q;
}

/**
 * Body token wins when it has text. A blank or whitespace body token is missing,
 * so the query token is used. A 302 can drop the POST body and leave only the query.
 */
function presentedToken_(bodyToken, queryToken) {
  var body = bodyToken == null ? '' : String(bodyToken).trim();
  var query = queryToken == null ? '' : String(queryToken).trim();
  if (!body) return query;
  return body;
}

/**
 * Success envelope. run_snapshot and refresh_benchmarks also publish the fields
 * callers check without opening result.
 */
function publicWrite_(action, res) {
  var result = res || {};
  var out = { ok: true, result: result };
  if (action === 'run_snapshot') {
    out.created = result.created === true;
    out.snapshot_date = result.snapshot_date || '';
  }
  if (action === 'refresh_benchmarks') out.done = result.done === true;
  return out;
}

/** JSON.stringify can return undefined or throw. Either becomes an HTML error page on Apps Script. */
function safeJsonText_(value) {
  try {
    var text = JSON.stringify(value);
    if (typeof text === 'string' && text) return text;
  } catch (err) { /* circular or otherwise unusable */ }
  return '{"ok":false,"error":"server"}';
}

/** True when today's BOT board rate is not in Prices_FX yet. */
function fxNeedsFetch_(latestDate, today) {
  if (!latestDate) return true;
  return String(latestDate) < String(today);
}

/** Read-only token: only its SHA-256 hex is stored (script property API_TOKEN_RO_SHA256). GET only. */
function decideReadAuth_(presented) {
  var full = decideAuth_(presented, scriptProp_('API_TOKEN'));
  if (!full) return { auth: null, role: 'full' };
  var given = presented == null ? '' : String(presented).trim();
  var roHash = scriptProp_('API_TOKEN_RO_SHA256');
  if (given && roHash && sha256_(given) === String(roHash).trim()) return { auth: null, role: 'readonly' };
  return { auth: full, role: '' };
}
