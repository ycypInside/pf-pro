const PREFIX = 'pfpro.swr.';
export const STALE_MS = 10 * 60 * 1000;

export function cacheKey(q, parts, month) {
  const list = (parts || []).map(String).slice().sort().join(',');
  const from = month && month.from ? month.from : '';
  const to = month && month.to ? month.to : '';
  return `${PREFIX}${q}.${list}.${from}.${to}`;
}

export function taipeiClock(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ms))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.hour}:${parts.minute}`;
}

export function staleView(savedAt, now = Date.now()) {
  const at = Number(savedAt);
  if (!Number.isFinite(at)) return { stale: false, savedAt: null, label: '' };
  const stale = now - at > STALE_MS;
  return {
    stale,
    savedAt: at,
    label: stale ? `估 updated ${taipeiClock(at)}` : '',
  };
}

function storageOf(storage) {
  if (storage) return storage;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function quotaError(error) {
  const name = error && (error.name || '');
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22;
}

function listKeys(box) {
  const keys = [];
  try {
    for (let i = 0; i < box.length; i += 1) {
      const key = box.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
  } catch {
    return keys;
  }
  return keys;
}

function savedAtOf(box, key) {
  try {
    const parsed = JSON.parse(box.getItem(key) || '');
    return parsed && Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0;
  } catch {
    return 0;
  }
}

export function readCache(key, storage) {
  const box = storageOf(storage);
  if (!box) return null;
  try {
    const raw = box.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.savedAt !== 'number' || parsed.body == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache(key, body, storage, token, now = Date.now()) {
  const box = storageOf(storage);
  if (!box || body == null) return false;
  let text;
  try {
    text = JSON.stringify({ savedAt: now, body });
  } catch {
    return false;
  }
  if (token && text.includes(token)) return false;
  const put = () => box.setItem(key, text);
  try {
    put();
    return true;
  } catch (error) {
    if (!quotaError(error)) return false;
    const ranked = listKeys(box)
      .filter((item) => item !== key)
      .map((item) => ({ item, savedAt: savedAtOf(box, item) }))
      .sort((a, b) => a.savedAt - b.savedAt);
    for (const row of ranked) {
      try { box.removeItem(row.item); } catch { /* the next write may still fit */ }
      try {
        put();
        return true;
      } catch (again) {
        if (!quotaError(again)) return false;
      }
    }
    return false;
  }
}

export function clearCache(storage) {
  const box = storageOf(storage);
  if (!box) return;
  for (const key of listKeys(box)) {
    try { box.removeItem(key); } catch { /* ignore a locked key */ }
  }
}

export function afterWrite(result, storage) {
  if (result && result.ok) clearCache(storage);
  return result;
}
