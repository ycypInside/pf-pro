/** Pure ledger helpers. Trade cash formulas match apps-script/Market.gs cashNetForSide_. */

export const CURRENCIES = ['TWD', 'USD', 'JPY', 'EUR', 'CNY', 'HKD', 'AUD', 'GBP'];

function roundDigits(x, digits) {
  const n = Number(x);
  if (!Number.isFinite(n) || n === 0) return n === 0 ? 0 : NaN;
  const sign = n < 0 ? -1 : 1;
  const factor = 10 ** digits;
  // 1e-6 corrects products that land just below a half step, such as 1186.5 × 32.15.
  const rounded = sign * Math.round(Math.abs(n) * factor + 1e-6) / factor;
  return rounded === 0 ? 0 : rounded;
}

export function round2(x) {
  return roundDigits(x, 2);
}

export function round4(x) {
  return roundDigits(x, 4);
}

export function isYes(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

export function stableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableString(item)).join(',')}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`)
    .join(',')}}`;
}

export function nextRequest(prev, payload, newId = () => crypto.randomUUID()) {
  const hash = stableString(payload);
  if (prev && prev.hash === hash) {
    return { id: prev.id, hash, payload: prev.payload, reused: true };
  }
  return { id: newId(), hash, payload: structuredClone(payload), reused: false };
}

export function daysBetween(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00+08:00`);
  const b = Date.parse(`${toDate}T00:00:00+08:00`);
  return Math.floor((b - a) / 86400000);
}

export function isStale(kind, dateStr, todayStr, days) {
  const limit = kind === 'nav' ? days.fund : kind === 'bond_valuation' ? days.bond : days.price;
  return daysBetween(dateStr, todayStr) > Number(limit);
}

export function taipeiMonth(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return {
    iso: `${parts.year}-${mm}-${parts.day}`,
    from: `${parts.year}-${mm}-01`,
    to: `${parts.year}-${mm}-${String(last).padStart(2, '0')}`,
    label: `${parts.year}年${month}月`,
  };
}

export function indexBy(rows, key) {
  const map = {};
  for (const row of rows || []) map[row[key]] = row;
  return map;
}

export function activeAccounts(accounts) {
  return (accounts || []).filter((account) => !account.status || account.status === 'active');
}

export function parseList(raw, fallback) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      } catch {
        /* keep fallback */
      }
    }
    if (text.includes(',') || text.includes('、')) {
      return text.split(/[,、]/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return fallback.slice();
}

export function buildCashTxn({
  date,
  accountId,
  txnType,
  category,
  amountAbs,
  currency,
  fxRate,
  fxSource,
  flowClass,
  description,
}) {
  const negative = ['expense', 'fee', 'tax', 'loan_repay_principal', 'loan_interest'].includes(txnType);
  const magnitude = round4(Math.abs(Number(amountAbs)));
  const fx = currency === 'TWD' ? 1 : Number(fxRate);
  return {
    date,
    account_id: accountId,
    txn_type: txnType,
    category,
    amount: negative ? -magnitude : magnitude,
    currency,
    fx_rate: fx,
    fx_source: fxSource,
    flow_class: flowClass,
    description: description || '',
  };
}

export function buildTransfer({
  date,
  fromAccount,
  toAccount,
  fromAmount,
  toAmount,
  fromCurrency,
  toCurrency,
  fromFx,
  toFx,
  fxSourceFrom,
  fxSourceTo,
  flowClass,
  description,
  fee,
}) {
  const data = {
    date,
    from: {
      account_id: fromAccount,
      amount: -Math.abs(round4(fromAmount)),
      currency: fromCurrency,
      fx_rate: fromCurrency === 'TWD' ? 1 : Number(fromFx),
      fx_source: fxSourceFrom,
    },
    to: {
      account_id: toAccount,
      amount: Math.abs(round4(toAmount)),
      currency: toCurrency,
      fx_rate: toCurrency === 'TWD' ? 1 : Number(toFx),
      fx_source: fxSourceTo,
    },
    flow_class: flowClass || 'internal',
    description: description || '',
  };
  if (fee && Number(fee.amount) > 0) {
    data.fee = {
      account_id: fee.account_id,
      amount: -Math.abs(round4(fee.amount)),
      currency: fee.currency,
      fx_rate: fee.currency === 'TWD' ? 1 : Number(fee.fx_rate),
      fx_source: fee.fx_source,
    };
  }
  return data;
}

export function buildTrade(input) {
  const data = {
    trade_date: input.tradeDate,
    account_id: input.accountId,
    asset_id: input.assetId,
    side: input.side,
    quantity: round4(input.quantity),
    price: round4(input.price),
    fee: round4(input.fee || 0),
    tax: round4(input.tax || 0),
    fx_rate: input.currency === 'TWD' ? 1 : Number(input.fxRate),
    fx_source: input.fxSource,
  };
  if (input.settleDate) data.settle_date = input.settleDate;
  if (input.accrued !== undefined && input.accrued !== '' && Number(input.accrued) !== 0) {
    data.accrued_interest = round4(input.accrued);
  }
  if (input.description) data.description = input.description;
  return data;
}

export function tradeEconomics({ side, quantity, price, fee = 0, tax = 0, accrued = 0, fxRate = 1 }) {
  const gross = round4(round4(quantity) * round4(price));
  const costs = round4(fee || 0) + round4(tax || 0);
  let net;
  if (side === 'buy' || side === 'dividend_reinvest') net = round4(-(gross + costs));
  else if (side === 'sell' || side === 'maturity') net = round4(gross - costs);
  else net = round4(-costs);
  const extra = Number(accrued || 0);
  if (extra) {
    if (side === 'buy' || side === 'dividend_reinvest') net = round4(net - extra);
    else if (side === 'sell' || side === 'maturity') net = round4(net + extra);
  }
  return { gross, net, netTwd: round2(net * Number(fxRate)) };
}

export function buildPrice(input) {
  return {
    symbol: String(input.symbol || '').trim(),
    kind: input.kind,
    date: input.date,
    value: Number(input.value),
    currency: input.currency,
    source: input.source || 'manual',
    note: input.note || '',
  };
}

export function problemsForCash(txn) {
  const problems = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(txn.date || '')) problems.push('請填日期');
  if (!txn.account_id) problems.push('請選擇帳戶');
  if (!txn.category) problems.push('請填分類');
  if (!Number.isFinite(txn.amount) || txn.amount === 0) problems.push('金額須大於 0');
  if (txn.currency === 'TWD' && txn.fx_rate !== 1) problems.push('台幣匯率必須是 1');
  if (!(txn.fx_rate > 0)) problems.push('請填匯率');
  if (!txn.fx_source) problems.push('請選擇匯率來源');
  if (!txn.flow_class) problems.push('請選擇資金分類');
  if (txn.txn_type === 'income' && txn.investmentAccount && !['external', 'internal'].includes(txn.flow_class)) {
    problems.push('投資帳戶的一般收入須標成外部或內部');
  }
  return problems;
}

export function problemsForTransfer(data, accountsById = {}) {
  const problems = [];
  const from = data.from || {};
  const to = data.to || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) problems.push('請填日期');
  if (!from.account_id || !to.account_id) problems.push('請選擇轉出與轉入帳戶');
  if (from.account_id && from.account_id === to.account_id) problems.push('轉出與轉入帳戶不能相同');
  if (!(from.amount < 0) || !(to.amount > 0)) problems.push('轉出金額與轉入金額須大於 0');
  if (from.currency && from.currency === to.currency && round4(from.amount + to.amount) !== 0) {
    problems.push('同幣別轉帳兩邊金額必須相同');
  }
  if (from.currency === 'TWD' && from.fx_rate !== 1) problems.push('轉出台幣匯率必須是 1');
  if (to.currency === 'TWD' && to.fx_rate !== 1) problems.push('轉入台幣匯率必須是 1');
  if (!(from.fx_rate > 0) || !(to.fx_rate > 0)) problems.push('請填匯率');
  const toAccount = accountsById[to.account_id];
  if (toAccount && isYes(toAccount.is_investment) && !['external', 'internal'].includes(data.flow_class)) {
    problems.push('轉入投資帳戶時，資金分類須為外部或內部');
  }
  if (data.fee) {
    if (!(data.fee.amount < 0)) problems.push('手續費須大於 0');
    if (!data.fee.account_id) problems.push('請選擇手續費帳戶');
    if (data.fee.currency === 'TWD' && data.fee.fx_rate !== 1) problems.push('手續費台幣匯率必須是 1');
  }
  return problems;
}

export function problemsForTrade(data, account, asset) {
  const problems = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.trade_date || '')) problems.push('請填交易日');
  if (!data.account_id) problems.push('請選擇帳戶');
  if (!data.asset_id) problems.push('請選擇標的');
  if (account && asset && account.currency !== asset.currency) problems.push('帳戶幣別須與標的相同');
  if (!(data.quantity > 0)) problems.push('數量須大於 0');
  const freePrice = ['split', 'transfer_in', 'transfer_out'].includes(data.side);
  if (freePrice ? !(data.price >= 0) : !(data.price > 0)) problems.push(freePrice ? '價格不可為負' : '價格須大於 0');
  if (data.fee < 0 || data.tax < 0) problems.push('手續費與稅額不可為負');
  if (asset && asset.currency === 'TWD' && data.fx_rate !== 1) problems.push('台幣匯率必須是 1');
  if (!(data.fx_rate > 0)) problems.push('請填匯率');
  if (!data.fx_source) problems.push('請選擇匯率來源');
  return problems;
}

export function problemsForPrice(data) {
  const problems = [];
  if (!data.symbol) problems.push('請填代號');
  if (!data.kind) problems.push('請選擇種類');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) problems.push('請填日期');
  if (!(Number(data.value) > 0)) problems.push('價格須大於 0');
  if (!data.currency) problems.push('請選擇幣別');
  return problems;
}

export function fxMap(quotes) {
  const map = {};
  for (const quote of quotes || []) {
    if (quote.kind !== 'fx') continue;
    const match = /^([A-Z]{3})TWD$/.exec(String(quote.symbol || ''));
    if (!match) continue;
    const prev = map[match[1]];
    if (!prev || String(quote.date) > String(prev.date)) map[match[1]] = quote;
  }
  return map;
}

export function withTwd(balances, quotes) {
  const rates = fxMap(quotes);
  return (balances || []).map((row) => {
    if (row.balance_twd !== undefined && row.balance_twd !== null && row.fx_missing === false) return row;
    if (row.currency === 'TWD') {
      return { ...row, fx_rate: 1, fx_missing: false, balance_twd: round2(row.balance) };
    }
    const quote = rates[row.currency];
    if (!quote) return { ...row, fx_rate: null, fx_missing: true, balance_twd: null };
    return {
      ...row,
      fx_rate: Number(quote.value),
      fx_date: quote.date,
      fx_stale: !!quote.is_stale,
      fx_missing: false,
      balance_twd: round2(Number(row.balance) * Number(quote.value)),
    };
  });
}

export function netWorth({ balances, holdings = [] }) {
  let assets = 0;
  let liabilities = 0;
  let cash = 0;
  let investCash = 0;
  const missing = [];
  for (const row of balances || []) {
    if (row.status && row.status !== 'active') continue;
    if (row.balance_twd === null || row.balance_twd === undefined || row.balance_twd === '') {
      if (row.fx_missing) missing.push(row.account_id);
      continue;
    }
    const twd = round2(row.balance_twd);
    if (row.type === 'loan' || row.type === 'credit_card') liabilities += Math.abs(twd);
    else if (isYes(row.is_investment)) {
      assets += twd;
      investCash += twd;
    } else {
      assets += twd;
      cash += twd;
    }
  }
  let holdingsTwd = 0;
  for (const holding of holdings) {
    if (holding.market_value_twd === '' || holding.market_value_twd === null || holding.market_value_twd === undefined) continue;
    holdingsTwd += Number(holding.market_value_twd);
  }
  holdingsTwd = round2(holdingsTwd);
  assets = round2(assets + holdingsTwd);
  liabilities = round2(liabilities);
  return {
    total_assets_twd: assets,
    total_liabilities_twd: liabilities,
    net_worth_twd: round2(assets - liabilities),
    cash_twd: round2(cash),
    investments_twd: round2(investCash + holdingsTwd),
    holdings_twd: holdingsTwd,
    missing_fx: missing,
  };
}

export function splitCategories(byCategory) {
  const income = [];
  const expense = [];
  for (const [name, value] of Object.entries(byCategory || {})) {
    const amount = Number(value);
    if (amount > 0) income.push({ name, amount: round2(amount) });
    else if (amount < 0) expense.push({ name, amount: round2(-amount) });
  }
  income.sort((a, b) => b.amount - a.amount);
  expense.sort((a, b) => b.amount - a.amount);
  return { income, expense };
}

const TRANSIENT_ERRORS = new Set(['auth_unavailable', 'busy', 'server', 'not_found']);

export function isTransientError(message) {
  return TRANSIENT_ERRORS.has(String(message || '').trim());
}

export function shouldRetryGet(error, attempt, limit = 3) {
  if (!error || attempt >= limit - 1) return false;
  if (error.offline || error.config) return false;
  return error.transient === true;
}

/** Keep looping benchmark chunks while either the envelope or the result says not done. */
export function benchmarkChunkOpen(res) {
  if (!res) return false;
  if (res.done === false) return true;
  const chunk = res.result || {};
  return chunk.done === false;
}

/**
 * POST token on the query string. searchParams is the normal path. If that
 * string does not actually contain the token, append it so the request cannot leave without one.
 */
export function withQueryToken(apiUrl, token) {
  const url = new URL(apiUrl);
  const value = String(token == null ? '' : token);
  url.searchParams.set('token', value);
  const encoded = encodeURIComponent(value);
  const text = url.toString();
  if (encoded && (text.includes(encoded) || text.includes(value))) return text;
  return `${text}${text.includes('?') ? '&' : '?'}token=${encoded}`;
}

/** POST query string: token plus m=post, so a redirected GET is recognizable. */
export function withPostQuery(apiUrl, token) {
  const url = new URL(withQueryToken(apiUrl, token));
  url.searchParams.set('m', 'post');
  const text = url.toString();
  if (text.includes('m=post')) return text;
  return `${text}${text.includes('?') ? '&' : '?'}m=post`;
}

/**
 * Two automatic POST retries on the same request_id. A dropped body comes back
 * as lost_body, parse_error, missing_token, or a legacy unknown q. A mismatch is not retried.
 */
export function shouldRetryPost(payload, attempt) {
  if (attempt >= 2) return false;
  if (!payload || payload.ok) return false;
  const reason = String(payload.reason || '');
  if (reason === 'mismatch' || reason === 'missing_secret') return false;
  if (reason === 'missing_token' || reason === 'parse_error' || reason === 'lost_body') return true;
  if (reason) return false;
  const error = String(payload.error || '');
  return error === 'unauthorized' || error === 'bad json' || error === 'unknown q' || error === 'parse_error';
}

export function explainError(message, reason) {
  const text = String(message || '').trim();
  const why = String(reason || '').trim();
  if (!text) return '發生錯誤';
  if (text === 'offline') return '目前沒有網路。恢復連線後再試。';
  if (text === '連線失敗') return '連線失敗。請檢查網路後重試。';
  if (text === 'unauthorized' && why === 'missing_token') return '這次送出沒有帶到權杖。已自動重試。';
  if (text === 'unauthorized' && why === 'mismatch') return '權杖與帳簿不一致。請到設定核對權杖。';
  if (text === 'unauthorized') return '權杖不正確，連線被拒絕。';
  if (text === 'auth_unavailable') return '暫時讀不到權杖。這不是密碼錯誤，請再試一次。';
  if (text === 'busy') return '帳簿正在寫入，請稍後再試。';
  if (text === 'server') return '伺服器暫時沒有回應。請再試一次。';
  if (text === 'not_found') return '帳簿暫時連不上。請再試一次。';
  if (text === 'unknown action') return '後端還沒有這個動作。請重新部署 Apps Script 後再試。';
  if (text === 'unknown q') return '後端還沒有這個查詢。請重新部署 Apps Script 後再試。';
  if (why === 'lost_body' || text === 'parse_error' || (text === 'bad json' && why === 'parse_error')) return '送出的內容在轉址時遺失。已自動重試。';
  if (text === 'bad json') return '送出的內容不是合法的 JSON。';
  if (text === 'request_id required') return '缺少 request_id。';
  return text;
}

export function validateEndpoint(apiUrl, token) {
  if (!apiUrl || !token) return '請填入 API 網址與權杖。';
  let url;
  try {
    url = new URL(apiUrl);
  } catch {
    return 'API 網址格式不正確。';
  }
  if (url.protocol !== 'https:') return 'API 網址必須是 https。';
  if (url.username || url.password) return '請不要把帳號密碼放在網址裡。';
  if (token.length < 8) return '權杖長度過短。';
  return '';
}
