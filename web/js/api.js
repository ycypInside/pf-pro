import { validateEndpoint } from './money.js';

const URL_KEY = 'pfpro.apiUrl';
const TOKEN_KEY = 'pfpro.token';

export function loadConfig() {
  return {
    apiUrl: (localStorage.getItem(URL_KEY) || '').trim(),
    token: localStorage.getItem(TOKEN_KEY) || '',
  };
}

export function saveConfig(apiUrl, token) {
  localStorage.setItem(URL_KEY, apiUrl.trim());
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearConfig() {
  localStorage.removeItem(URL_KEY);
  localStorage.removeItem(TOKEN_KEY);
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
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('伺服器沒有回傳 JSON');
    error.network = true;
    throw error;
  }
}

export async function apiGet(q, params = {}, config) {
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
    error.cause = cause;
    throw error;
  }
  const json = await readJson(res);
  if (!json.ok) {
    const error = new Error(json.error || '讀取失敗');
    error.payload = json;
    throw error;
  }
  return json;
}

/**
 * Apps Script web apps reject CORS preflight. text/plain is a simple request.
 * The deployment answers with a redirect; follow is the fetch default and keeps the body path working.
 */
export async function apiPost(action, data, requestId, config) {
  const { apiUrl, token } = endpoint(config);
  const body = JSON.stringify({
    token,
    request_id: requestId,
    action,
    client: 'web',
    data,
  });
  throwIfOffline();
  let res;
  try {
    res = await fetch(apiUrl, {
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
