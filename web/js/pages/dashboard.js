import { hasConfig, tryGet } from '../api.js';
import { h } from '../dom.js';
import { formatMoney, formatQty, formatRate, formatTwd } from '../format.js';
import { ACCOUNT_TYPE, kindLabel } from '../labels.js';
import { explainError, netWorth, splitCategories, taipeiMonth, withTwd } from '../money.js';

export async function renderDashboard(main, ctx) {
  if (!hasConfig()) {
    main.append(needConfig(ctx));
    return;
  }
  main.append(h('p', { class: 'muted' }, '讀取中…'));
  const month = taipeiMonth();
  const [accountsR, balancesR, incomeR, checksR, pricesR, holdingsR] = await Promise.all([
    tryGet('accounts'),
    tryGet('balances'),
    tryGet('income_expense', { from: month.from, to: month.to }),
    tryGet('checks'),
    tryGet('prices'),
    tryGet('holdings'),
  ]);
  if (!ctx.alive()) return;
  main.replaceChildren();
  const fatal = [accountsR, balancesR, incomeR, checksR].find((item) => !item.ok);
  if (fatal && fatal.error && fatal.error.payload && fatal.error.payload.error === 'unauthorized') {
    main.append(h('div', { class: 'banner err', role: 'alert' },
      h('strong', {}, '權杖被拒絕'),
      h('p', {}, explainError('unauthorized'))),
    h('button', { type: 'button', class: 'btn', onClick: () => ctx.go('settings') }, '前往設定'));
    return;
  }

  const accounts = accountsR.ok ? accountsR.data.accounts : [];
  const names = Object.fromEntries(accounts.map((account) => [account.account_id, account.name]));
  const quotes = pricesR.ok ? pricesR.data.quotes : [];
  const rawBalances = balancesR.ok ? balancesR.data.balances : [];
  const balances = withTwd(rawBalances, quotes);
  const holdings = holdingsR.ok ? holdingsR.data.holdings : [];
  const summary = balancesR.ok && balancesR.data.net_worth
    ? balancesR.data.net_worth
    : netWorth({ balances, holdings });
  const report = incomeR.ok ? incomeR.data.report : null;
  const categories = report ? splitCategories(report.by_category) : { income: [], expense: [] };

  main.append(
    h('section', { class: 'hero' },
      h('div', { class: 'hero-top' },
        h('p', { class: 'eyebrow' }, '淨資產 · 台幣'),
        h('button', { type: 'button', class: 'text-btn', onClick: () => ctx.go('overview') }, '重新整理')),
      h('p', { class: 'net num' }, formatTwd(summary.net_worth_twd)),
      h('dl', { class: 'split' },
        stat('資產', formatTwd(summary.total_assets_twd)),
        stat('負債', formatTwd(summary.total_liabilities_twd)),
        stat('現金', formatTwd(summary.cash_twd)),
        stat('投資', formatTwd(summary.investments_twd)))),
    missingFx(summary),
    section('帳戶餘額', balancesR.ok ? balanceList(balances, names) : failNote(balancesR)),
    section(`${month.label}收支`, incomeR.ok ? incomeBlock(report, categories) : failNote(incomeR)),
    holdings.length ? section('持倉', holdingList(holdings, names)) : null,
    section('報價與最後估值日', pricesR.ok ? priceBlock(pricesR.data) : failNote(pricesR, '報價')),
    section('資料檢查', checksR.ok ? checkBlock(checksR.data.warnings || []) : failNote(checksR)));
}

function needConfig(ctx) {
  return h('div', { class: 'stack' },
    h('p', { class: 'lede' }, '尚未設定連線。網址與權杖只會留在這台瀏覽器。'),
    h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.go('settings') }, '前往設定'));
}

function stat(label, value) {
  return h('div', {}, h('dt', {}, label), h('dd', { class: 'num' }, value));
}

function section(title, body) {
  return h('section', { class: 'card' }, h('h2', {}, title), body);
}

function failNote(result, label = '這一段') {
  const message = result && result.error ? explainError(result.error.message) : `${label}讀不到。`;
  return h('p', { class: 'muted' }, message);
}

function missingFx(summary) {
  const ids = summary.missing_fx || [];
  if (!ids.length) return null;
  return h('div', { class: 'banner dup', role: 'status' },
    h('strong', {}, '有帳戶缺少匯率'),
    h('p', {}, `${ids.join('、')} 未計入淨資產。請到記帳頁補一筆匯率。`));
}

function balanceList(balances, names) {
  const rows = balances.filter((row) => !row.status || row.status === 'active');
  if (!rows.length) return h('p', { class: 'muted' }, '還沒有帳戶。');
  return h('div', {}, rows.map((row) => h('article', { class: 'acct' },
    h('div', {},
      h('p', { class: 'acct-name' }, names[row.account_id] || row.name || row.account_id),
      h('p', { class: 'muted' }, `${ACCOUNT_TYPE[row.type] || row.type || ''} · ${row.currency}${row.fx_stale ? ' · 匯率過期' : ''}`)),
    h('div', { class: 'acct-amt' },
      h('p', { class: 'num' }, formatMoney(row.balance, row.currency, row.currency === 'TWD' || row.currency === 'JPY' ? 0 : 2)),
      h('p', { class: 'num muted' }, row.fx_missing ? '缺匯率' : formatTwd(row.balance_twd))))));
}

function incomeBlock(report, categories) {
  return h('div', { class: 'stack' },
    h('dl', { class: 'split' },
      stat('收入', formatTwd(report.income_twd)),
      stat('支出', formatTwd(report.expense_twd))),
    h('h3', {}, '支出分類'),
    bars(categories.expense, 'expense'),
    h('h3', {}, '收入分類'),
    bars(categories.income, 'income'));
}

function bars(rows, tone) {
  if (!rows.length) return h('p', { class: 'muted' }, '這個月還沒有。');
  const max = Math.max(...rows.map((row) => row.amount), 1);
  return h('div', { class: 'bars' }, rows.map((row) => h('div', { class: 'bar-row' },
    h('span', {}, row.name),
    h('span', { class: 'track' }, h('span', { class: `fill ${tone}`, style: `width:${Math.max(6, (row.amount / max) * 100)}%` })),
    h('span', { class: 'num' }, formatTwd(row.amount)))));
}

function holdingList(holdings, names) {
  return h('div', {}, holdings.map((row) => h('article', { class: 'acct' },
    h('div', {},
      h('p', { class: 'acct-name' }, `${row.name || row.symbol || row.asset_id}`),
      h('p', { class: 'muted' }, `${names[row.account_id] || row.account_id} · ${formatQty(row.quantity)} 股${row.is_stale ? ' · 價格過期' : ''}`)),
    h('div', { class: 'acct-amt' },
      h('p', { class: 'num' }, formatTwd(row.market_value_twd)),
      h('p', { class: 'num muted' }, row.last_price === '' || row.last_price === null ? '無報價' : formatMoney(row.last_price, row.currency, 2))))));
}

function priceBlock(data) {
  const valuations = data.last_valuations || [];
  const stale = data.stale || [];
  return h('div', { class: 'stack' },
    h('h3', {}, '最後估值日'),
    valuations.length
      ? h('div', {}, valuations.map((row) => h('article', { class: 'acct' },
        h('div', {},
          h('p', { class: 'acct-name' }, row.name || row.symbol),
          h('p', { class: 'muted' }, row.missing ? '尚無債券估值' : `${row.date}${row.is_stale ? ' · 已過期' : ''}`)),
        h('p', { class: 'num' }, row.missing ? '—' : formatRate(row.value)))))
      : h('p', { class: 'muted' }, '目前沒有債券估值。'),
    h('h3', {}, '過期報價'),
    stale.length
      ? h('ul', { class: 'plain' }, stale.map((row) => h('li', {},
        `${row.symbol} · ${kindLabel(row.kind)} · ${formatRate(row.value)} ${row.currency} · ${row.date}`)))
      : h('p', { class: 'muted' }, '沒有超過門檻的報價。'));
}

function checkBlock(warnings) {
  if (!warnings.length) {
    return h('p', { class: 'ok-text' }, '目前沒有檢查警示。');
  }
  return h('ul', { class: 'plain warn' }, warnings.map((warning) => h('li', {}, warning)));
}
