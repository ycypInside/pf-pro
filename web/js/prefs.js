/** Last cash entry and recent templates. Storage is injected so tests stay pure. */

const LAST_KEY = 'pfpro.lastCash';
const TEMPLATES_KEY = 'pfpro.templates';

export function parseLastCash(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return {
      account_id: String(data.account_id || ''),
      category: String(data.category || ''),
      income: data.income === true,
      income_type: String(data.income_type || 'income'),
      flow_class: String(data.flow_class || ''),
    };
  } catch {
    return null;
  }
}

export function serializeLastCash(entry) {
  return JSON.stringify({
    account_id: String((entry && entry.account_id) || ''),
    category: String((entry && entry.category) || ''),
    income: !!(entry && entry.income),
    income_type: String((entry && entry.income_type) || 'income'),
    flow_class: String((entry && entry.flow_class) || ''),
  });
}

export function usableLastCash(saved, accountIds) {
  if (!saved || !saved.account_id) return null;
  if (accountIds && !accountIds.includes(saved.account_id)) return null;
  return saved;
}

export function templateKey(item) {
  return `${item.kind || 'expense'}|${item.account_id || ''}|${item.category || ''}`;
}

export function rememberTemplate(list, item, limit = 6) {
  const next = {
    kind: String((item && item.kind) || 'expense'),
    account_id: String((item && item.account_id) || ''),
    category: String((item && item.category) || ''),
    label: String((item && (item.label || item.category)) || ''),
  };
  const cap = limit > 0 ? limit : 6;
  const prior = Array.isArray(list) ? list : [];
  if (!next.account_id || !next.category) return prior.slice(0, cap);
  const key = templateKey(next);
  return [next, ...prior.filter((row) => templateKey(row) !== key)].slice(0, cap);
}

export function entryQuery(item) {
  const kind = item.kind || (item.income ? 'income' : 'expense');
  const query = { tab: 'cash', mode: 'expense' };
  if (kind === 'income' || kind === 'dividend' || kind === 'interest') query.mode = 'income';
  if (kind === 'dividend' || kind === 'interest') query.kind = kind;
  if (item.account_id) query.account = item.account_id;
  if (item.category) query.category = item.category;
  return query;
}

export function mergeEntryPreset(saved, query, lists) {
  const incomeCats = (lists && lists.income) || [];
  const expenseCats = (lists && lists.expense) || [];
  const merged = saved ? { ...saved } : {};
  const kind = query.kind || '';
  if (query.mode === 'income' || kind === 'income' || kind === 'dividend' || kind === 'interest') {
    merged.income = true;
  } else if (query.mode === 'expense') {
    merged.income = false;
  }
  if (kind === 'dividend' || kind === 'interest') merged.income_type = kind;
  if (query.mode === 'income' || query.mode === 'expense') {
    if (!query.category) {
      const allowed = merged.income ? incomeCats : expenseCats;
      if (merged.category && allowed.length && !allowed.includes(merged.category)) delete merged.category;
    }
  }
  if (query.account) merged.account_id = query.account;
  if (query.category) merged.category = query.category;
  return merged;
}

export function readLastCash(storage) {
  return parseLastCash(storage.getItem(LAST_KEY));
}

export function writeLastCash(entry, storage) {
  storage.setItem(LAST_KEY, serializeLastCash(entry));
}

export function readTemplates(storage) {
  try {
    const data = JSON.parse(storage.getItem(TEMPLATES_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function writeTemplates(list, storage) {
  storage.setItem(TEMPLATES_KEY, JSON.stringify(list));
}
