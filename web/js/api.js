import { isTransientError, shouldRetryGet, shouldRetryPost, validateEndpoint, withPostQuery } from './money.js';
import { afterWrite, clearCache } from './swr.js';

const URL_KEY = 'pfpro.apiUrl';
const TOKEN_KEY = 'pfpro.token';

export function loadConfig() {
  return {
    apiUrl: (localStorage.getItem(URL_KEY) || '').trim(),
    token: localStorage.getItem(TOKEN_KEY) || '',
  };
}

export function saveConfig(apiUrl, token) {
  const nextUrl = apiUrl.trim();
  const nextToken = token.trim();
  const prev = loadConfig();
  localStorage.setItem(URL_KEY, nextUrl);
  localStorage.setItem(TOKEN_KEY, nextToken);
  if (prev.apiUrl !== nextUrl || prev.token !== nextToken) clearCache();
}

export function clearConfig() {
  localStorage.removeItem(URL_KEY);
  localStorage.removeItem(TOKEN_KEY);
  clearCache();
}

export function hasConfig() {
  const { apiUrl, token } = loadConfig();
  return !validateEndpoint(apiUrl, token);
}

function endpoint(config = loadConfig()) {
  const problem = validateEndpoint(config.apiUrl, config.token);
  if (problem) {
    const error = new Error(problem);
    error.config = true;
    throw error;
  }
  return { apiUrl: config.apiUrl.trim(), token: config.token.trim() };
}

function throwIfOffline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const error = new Error('offline');
    error.offline = true;
    error.network = true;
    throw error;
  }
}

async function readJson(res) {
  if (res.status === 404) {
    const error = new Error('not_found');
    error.transient = true;
    error.network = true;
    error.status = res.status;
    throw error;
  }
  if (res.status === 429 || res.status >= 500) {
    const error = new Error('server');
    error.transient = true;
    error.network = true;
    error.status = res.status;
    throw error;
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('伺服器沒有回傳 JSON');
    error.network = true;
    error.transient = true;
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const GET_WAITS = [0, 400, 1200];

async function apiGetOnce(q, params = {}, config) {
  const { apiUrl, token } = endpoint(config);
  const url = new URL(apiUrl);
  url.searchParams.set('q', q);
  url.searchParams.set('token', token);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  throwIfOffline();
  let res;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch (cause) {
    const error = new Error('連線失敗');
    error.network = true;
    error.transient = true;
    error.cause = cause;
    throw error;
  }
  const json = await readJson(res);
  if (!json.ok) {
    const error = new Error(json.error || '讀取失敗');
    error.payload = json;
    if (isTransientError(json.error)) error.transient = true;
    throw error;
  }
  return json;
}

export async function apiGet(q, params = {}, config) {
  let last;
  for (let attempt = 0; attempt < GET_WAITS.length; attempt += 1) {
    if (GET_WAITS[attempt]) await sleep(GET_WAITS[attempt]);
    try {
      return await apiGetOnce(q, params, config);
    } catch (error) {
      last = error;
      if (!shouldRetryGet(error, attempt, GET_WAITS.length)) throw error;
    }
  }
  throw last;
}

/**
 * Apps Script web apps reject CORS preflight. text/plain is a simple request.
 * The deployment 302s to googleusercontent. Fetch turns that POST into a GET and
 * drops the body, so the token and m=post stay on the query string. A lost body,
 * parse error, or missing token is retried twice on the same request_id.
 */
export async function apiPost(action, data, requestId, config) {
  const { apiUrl, token } = endpoint(config);
  const url = withPostQuery(apiUrl, token);
  const body = JSON.stringify({
    token,
    request_id: requestId,
    action,
    client: 'web',
    data,
  });
  const waits = [0, 300, 800];
  let last;
  for (let attempt = 0; attempt < waits.length; attempt += 1) {
    if (waits[attempt]) await sleep(waits[attempt]);
    last = await apiPostOnce(url, body);
    if (!shouldRetryPost(last, attempt)) return afterWrite(last);
  }
  return afterWrite(last);
}

async function apiPostOnce(url, body) {
  throwIfOffline();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
  } catch (cause) {
    const error = new Error('連線失敗');
    error.network = true;
    error.cause = cause;
    throw error;
  }
  return readJson(res);
}

export async function tryGet(q, params, config) {
  try {
    return { ok: true, data: await apiGet(q, params, config) };
  } catch (error) {
    return { ok: false, error };
  }
}
