/** Account groups, holdings join, and the open/closed state stored on this browser. */

const GROUP_KEY = 'pfpro.accountGroups';

const CLASS_LABEL = {
  stock: '股票',
  etf: '股票',
  bond: '債券',
  fund: '基金',
  cash: '現金',
  other: '其他',
};

const POLICY_LABEL = {
  equity_max: '股票上限',
  equity_min: '股票下限',
  bond_max: '債券上限',
  bond_target: '債券目標',
  cash_min: '現金下限',
  cash_max: '現金上限',
  other: '其他部位',
  sentiment_mode: '情緒調整',
  single_name_max: '個股上限',
};

const PCT_KEYS = new Set(['equity_max', 'equity_min', 'bond_max', 'bond_target', 'cash_min', 'cash_max', 'single_name_max']);

function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function part(obj, name) {
  if (!obj) return 0;
  const direct = finite(obj[name]);
  if (direct != null) return direct;
  const twd = finite(obj[`${name}_twd`]);
  return twd == null ? 0 : twd;
}

export function displayAmount(row) {
  if (!row) return null;
  if (row.is_group) return finite(row.rollup_twd);
  const total = finite(row.total_twd);
  if (total != null) return total;
  return finite(row.balance_twd);
}

export function isVisibleAccount(row) {
  if (!row || row.is_group) return false;
  if (row.status && row.status !== 'active') return false;
  return true;
}

export function accountKind(row) {
  if (row.type === 'loan' || row.type === 'credit_card') return 'loans';
  const investment = row.is_investment === true || String(row.is_investment).toUpperCase() === 'TRUE';
  if (investment || row.type === 'brokerage' || row.type === 'fund_platform' || (finite(row.holdings_twd) || 0) > 0) return 'investments';
  return 'cash';
}

export function defaultGroupState() {
  return { mode: 'bank', open: {} };
}

export function readGroupState(storage) {
  let raw = '';
  try { raw = storage && storage.getItem(GROUP_KEY); } catch { return defaultGroupState(); }
  if (!raw) return defaultGroupState();
  try {
    const data = JSON.parse(raw);
    const mode = data && data.mode === 'type' ? 'type' : 'bank';
    const open = {};
    const saved = data && data.open;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [key, value] of Object.entries(saved)) {
        if (value === true) open[key] = true;
      }
    }
    return { mode, open };
  } catch {
    return defaultGroupState();
  }
}

export function writeGroupState(storage, state) {
  const next = {
    mode: state && state.mode === 'type' ? 'type' : 'bank',
    open: {},
  };
  for (const [key, value] of Object.entries((state && state.open) || {})) {
    if (value === true) next.open[key] = true;
  }
  storage.setItem(GROUP_KEY, JSON.stringify(next));
  return next;
}

export function withMode(state, mode) {
  return { mode: mode === 'type' ? 'type' : 'bank', open: { ...(state && state.open) } };
}

export function toggleOpen(state, id) {
  const open = { ...(state && state.open) };
  if (open[id]) delete open[id];
  else open[id] = true;
  return { mode: state && state.mode === 'type' ? 'type' : 'bank', open };
}

export function isGroupOpen(state, id) {
  return !!(state && state.open && state.open[id] === true);
}

export function hydrateBalances(balances, accounts) {
  const byId = Object.fromEntries((accounts || []).map((account) => [account.account_id, account]));
  return (balances || []).map((row) => {
    const account = byId[row.account_id] || {};
    return {
      ...account,
      ...row,
      name: row.name || account.name || row.account_id,
      type: row.type || account.type || '',
      institution: row.institution || account.institution || '',
      is_investment: row.is_investment != null ? row.is_investment : account.is_investment,
    };
  });
}

function sumParts(rows) {
  let cash = 0;
  let holdings = 0;
  let liabilities = 0;
  let total = 0;
  for (const row of rows) {
    if (accountKind(row) === 'loans') liabilities += Math.abs(finite(row.balance_twd) || finite(row.total_twd) || 0);
    else cash += finite(row.balance_twd) || 0;
    holdings += finite(row.holdings_twd) || 0;
    const amount = displayAmount(row);
    if (amount != null) total += amount;
  }
  return { cash, holdings, liabilities, total };
}

function leavesIn(rows, ids) {
  const byId = Object.fromEntries(rows.map((row) => [row.account_id, row]));
  const ordered = (ids || []).map((id) => byId[id]).filter(Boolean);
  const source = ordered.length ? ordered : rows;
  return source.filter(isVisibleAccount);
}

export function buildGroups(mode, balances, institutions) {
  const rows = balances || [];
  if (mode === 'type') {
    const visible = rows.filter(isVisibleAccount);
    return [
      ['cash', '現金'],
      ['investments', '投資'],
      ['loans', '貸款'],
    ].map(([kind, label]) => {
      const accounts = visible.filter((row) => accountKind(row) === kind);
      const parts = sumParts(accounts);
      return { id: `type:${kind}`, label, ...parts, accounts };
    }).filter((group) => group.accounts.length);
  }
  const provided = institutions || [];
  const source = provided.length
    ? provided.map((group) => ({
      label: group.institution || group.name || '其他',
      ids: group.accounts || [],
      cash: part(group, 'cash'),
      holdings: part(group, 'holdings'),
      liabilities: part(group, 'liabilities'),
      total: part(group, 'total'),
      hasTotals: true,
    }))
    : [...rows.filter(isVisibleAccount).reduce((map, row) => {
      const label = row.institution || '其他';
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(row.account_id);
      return map;
    }, new Map())].map(([label, ids]) => ({ label, ids, hasTotals: false }));
  return source.map((group) => {
    const accounts = leavesIn(rows, group.ids);
    const parts = group.hasTotals
      ? { cash: group.cash, holdings: group.holdings, liabilities: group.liabilities, total: group.total }
      : sumParts(accounts);
    return { id: `bank:${group.label}`, label: group.label, ...parts, accounts };
  }).filter((group) => group.accounts.length || group.total);
}

export function joinHoldings(holdings, quotes) {
  const map = quotes && !Array.isArray(quotes) ? quotes : {};
  const rows = holdings || [];
  const total = rows.reduce((sum, row) => sum + (finite(row.market_value_twd) || 0), 0);
  return rows.map((row) => {
    const quote = map[row.asset_id] || {};
    const cost = finite(row.cost_basis_twd);
    const value = finite(row.market_value_twd);
    const pl = finite(row.unrealized_pl_twd);
    return {
      asset_id: row.asset_id,
      account_id: row.account_id,
      name: row.name || row.symbol || row.asset_id,
      symbol: row.symbol || '',
      asset_class: row.asset_class || 'other',
      currency: row.currency || '',
      quantity: row.quantity,
      price: quote.last != null ? quote.last : row.last_price,
      change_pct: finite(quote.change_pct),
      spark: Array.isArray(quote.spark) ? quote.spark.slice(-30) : [],
      source: quote.source || '',
      is_stale: quote.is_stale === true || quote.is_stale === 'true' || quote.is_stale === 'TRUE',
      price_date: quote.price_date || '',
      stale_limit_days: finite(quote.stale_limit_days),
      cost,
      value,
      pl,
      pl_pct: cost ? pl / cost : null,
      weight: total ? (value || 0) / total : 0,
    };
  });
}

export function quoteTone(change) {
  const n = Number(change);
  if (!Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

const SORTS = {
  value: (row) => row.value || 0,
  change: (row) => (row.change_pct == null ? null : row.change_pct),
  pl: (row) => (row.pl_pct == null ? null : row.pl_pct),
  name: (row) => row.name || '',
};

export function sortHoldings(rows, key) {
  const read = SORTS[key] || SORTS.value;
  return [...(rows || [])].sort((a, b) => {
    const av = read(a);
    const bv = read(b);
    if (key === 'name') return String(av).localeCompare(String(bv), 'zh-Hant');
    if (av == null && bv == null) return String(a.name).localeCompare(String(b.name), 'zh-Hant');
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
}

export function classLabel(assetClass) {
  return CLASS_LABEL[assetClass] || CLASS_LABEL.other;
}

export function groupHoldings(rows, mode, names) {
  const buckets = new Map();
  for (const row of rows || []) {
    const id = mode === 'class' ? (row.asset_class || 'other') : (row.account_id || '');
    const label = mode === 'class'
      ? classLabel(row.asset_class)
      : ((names && names[row.account_id]) || row.account_id || '未分帳戶');
    if (!buckets.has(id)) buckets.set(id, { id, label, rows: [] });
    buckets.get(id).rows.push(row);
  }
  return [...buckets.values()];
}

export function visibleAdvice(items) {
  return (items || []).filter((item) => item && item.tag !== 'employer');
}

export function adviceTone(item) {
  if (!item) return 'info';
  if (item.level === 'warn' || item.tag === 'stale' || item.tag === 'dca_pause') return 'warn';
  return 'info';
}

export function parsePolicy(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? value : null;
}

export function policyLines(policy, settings) {
  const data = parsePolicy(policy);
  if (!data) return [];
  const lines = Object.keys(POLICY_LABEL).filter((key) => data[key] != null && data[key] !== '').map((key) => {
    let text = String(data[key]);
    if (PCT_KEYS.has(key)) {
      const n = Number(data[key]);
      text = Number.isFinite(n) ? `${Math.round(n * 100)}%` : text;
    } else if (key === 'other') {
      text = data[key] === 'hold' ? '維持現況' : text;
    } else if (key === 'sentiment_mode') {
      if (data[key] === 'off') text = '不隨情緒調整';
      else if (data[key] === 'aggressive_when_hot') text = '過熱時提高股票';
      else text = '過熱時降低股票';
    }
    return { key, label: POLICY_LABEL[key], text };
  });
  lines.push(
    { key: 'dca_exempt_enabled', label: '定額豁免', text: onOff(data.dca_exempt_enabled) },
    { key: 'dca_core_assets', label: '核心定額標的', text: formatCore(data.dca_core_assets) },
    { key: 'dca_pause', label: '定額暫停', text: formatPause(data.dca_pause) },
    { key: 'stale_days_overrides', label: '過期天數覆寫', text: formatOverrides(overridesOf(data, settings)) },
  );
  return lines;
}

function onOff(value) {
  return value === true || String(value).toUpperCase() === 'TRUE' ? '開啟' : '關閉';
}

function formatCore(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,，\s]+/);
  const names = list.map((item) => String(item).trim()).filter(Boolean);
  return names.length ? names.join('、') : '尚未指定';
}

function formatPause(value) {
  const pause = asObject(value) || {};
  if (!onOff(pause.enabled).startsWith('開')) return '關閉';
  const cash = Number(pause.cash_pct_total);
  const net = Number(pause.net_cash_pct_nw);
  const cashText = Number.isFinite(cash) ? `${Math.round(cash * 100)}%` : '—';
  const netText = Number.isFinite(net) ? `${Math.round(net * 100)}%` : '—';
  return `開啟，現金低於總資產 ${cashText} 或淨現金低於淨值 ${netText} 時暫停`;
}

function overridesOf(policy, settings) {
  if (settings && settings.stale_days_overrides != null && settings.stale_days_overrides !== '') {
    return settings.stale_days_overrides;
  }
  return policy ? policy.stale_days_overrides : null;
}

function formatOverrides(value) {
  const data = typeof value === 'string' ? asObject(value) : asObject(value);
  if (!data || Array.isArray(data)) return '尚未設定';
  const keys = Object.keys(data);
  if (!keys.length) return '尚未設定';
  return keys.map((key) => `${key}：${data[key]} 天`).join('、');
}

function asObject(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? value : null;
}
