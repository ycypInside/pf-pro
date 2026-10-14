import { hasConfig, tryGet } from '../api.js';
import { h, mount } from '../dom.js';
import { formatPct, formatRate, formatTwd } from '../format.js';
import { kindLabel } from '../labels.js';
import { explainError, netWorth, splitCategories, taipeiMonth, withTwd } from '../money.js';
import { collectDecisions, dayChange, pathProgress, wanLabel } from '../p1.js';
import { entryQuery, readTemplates } from '../prefs.js';
import { renderAccountGroups } from './accounts.js';
import { adviceCard } from './advice.js';
import { alertsBlock } from './alerts.js';
import { renderHoldings } from './holdings.js';

export async function renderDashboard(main, ctx) {
  if (!hasConfig()) {
    main.append(needConfig(ctx));
    return;
  }
  main.append(h('p', { class: 'muted' }, '讀取中…'));
  const month = taipeiMonth();
  const loaded = await loadOverview(month);
  const { accountsR, balancesR, incomeR, checksR, pricesR, holdingsR, quotesR, adviceR, alertsR, planR, dcaR, decisionsR, performanceR } = loaded;
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
  const known = new Set(accounts.map((account) => account.account_id));
  const templates = readTemplates(localStorage).filter((item) => !item.account_id || known.has(item.account_id));

  const quoteBook = quotesR.ok ? quotesR.data.quotes : {};
  const decisions = collectDecisions({
    decisions: decisionsR && decisionsR.ok ? decisionsR.data : null,
    alerts: alertsR && alertsR.ok ? alertsR.data.alerts : null,
    dcaItems: dcaR && dcaR.ok ? dcaR.data.items : null,
    quotes: quotesR.ok ? quoteBook : null,
  });
  const planData = planR && planR.ok ? planR.data : null;
  const change = dayChange(planData, performanceR && performanceR.ok ? performanceR.data : null);
  const path = pathProgress(planData && planData.tracks, planData ? planData.net_worth_twd : summary.net_worth_twd);

  mount(main,
    section('待您決定', decisionsBody(decisions)),
    h('section', { class: 'hero' },
      h('div', { class: 'hero-top' },
        h('p', { class: 'eyebrow' }, '淨資產 · 台幣'),
        h('button', { type: 'button', class: 'text-btn', onClick: () => ctx.reload() }, '重新整理')),
      h('p', { class: 'net num' }, formatTwd(summary.net_worth_twd)),
      changeLine(change),
      pathBar(path),
      h('dl', { class: 'split' },
        stat('資產', formatTwd(summary.total_assets_twd)),
        stat('負債', formatTwd(summary.total_liabilities_twd)),
        stat('現金', formatTwd(summary.cash_twd)),
        stat('投資', formatTwd(summary.investments_twd)))),
    h('div', { class: 'quick' },
      h('button', { type: 'button', class: 'btn', onClick: () => ctx.go('entry', { tab: 'cash', mode: 'expense' }) }, '記支出'),
      h('button', { type: 'button', class: 'btn', onClick: () => ctx.go('entry', { tab: 'cash', mode: 'income' }) }, '記收入'),
      h('button', { type: 'button', class: 'btn', onClick: () => ctx.go('entry', { tab: 'transfer' }) }, '轉帳')),
    templates.length ? section('再記一筆', templateChips(templates, names, ctx)) : null,
    missingFx(summary),
    adviceCard(adviceR.ok ? adviceR.data : null, !adviceR.ok),
    section('檢討提醒', alertsBlock(alertsR)),
    section('帳戶餘額', balancesR.ok
      ? renderAccountGroups(balancesR.data.balances || rawBalances, accounts, balancesR.data.institutions || [], localStorage)
      : renderAccountGroups(rawBalances, accounts, [], localStorage)),
    section(`${month.label}收支`, incomeR.ok ? incomeBlock(report, categories) : failNote(incomeR)),
    section('持倉', renderHoldings(holdingsR.ok ? (holdingsR.data.holdings || holdings) : holdings, quoteBook, names)),
    section('報價與最後估值日', pricesR.ok ? priceBlock(pricesR.data) : failNote(pricesR, '報價')),
    section('資料檢查', checksR.ok ? checkBlock(checksR.data.warnings || []) : failNote(checksR)));
}

function templateChips(templates, names, ctx) {
  return h('div', { class: 'chips' }, templates.map((item) => {
    const account = names[item.account_id];
    const text = account ? `${item.label || item.category} · ${account}` : (item.label || item.category);
    return h('button', {
      type: 'button',
      class: 'chip',
      onClick: () => ctx.go('entry', entryQuery(item)),
    }, text);
  }));
}

async function loadOverview(month) {
  const [summary, balances, quotes, advice, holdings, alerts, plan, dca, decisions, performance] = await Promise.all([
    tryGet('summary', { from: month.from, to: month.to }),
    tryGet('balances'),
    tryGet('quotes'),
    tryGet('advice'),
    tryGet('holdings'),
    tryGet('alerts'),
    tryGet('plan'),
    tryGet('dca'),
    tryGet('decisions'),
    tryGet('performance', { period: '1Y' }),
  ]);
  if (summary.ok) {
    const data = summary.data;
    const balanceData = balances.ok
      ? { institutions: [], ...balances.data, net_worth: balances.data.net_worth || data.net_worth }
      : { balances: data.balances || [], net_worth: data.net_worth, institutions: [] };
    return {
      accountsR: { ok: true, data: { accounts: data.accounts || [] } },
      balancesR: { ok: true, data: balanceData },
      incomeR: { ok: true, data: { report: data.report } },
      checksR: { ok: true, data: { warnings: data.warnings || [] } },
      pricesR: { ok: true, data: { quotes: data.quotes || [], last_valuations: data.last_valuations || [], stale: data.stale || [] } },
      holdingsR: holdings.ok ? holdings : { ok: true, data: { holdings: data.holdings || [] } },
      quotesR: quotes,
      adviceR: advice,
      alertsR: alerts,
      planR: plan,
      dcaR: dca,
      decisionsR: decisions,
      performanceR: performance,
    };
  }
  if (summary.error && summary.error.message === 'unknown q') {
    const [accountsR, balancesR, incomeR, checksR, pricesR, holdingsR] = await Promise.all([
      tryGet('accounts'),
      tryGet('balances'),
      tryGet('income_expense', { from: month.from, to: month.to }),
      tryGet('checks'),
      tryGet('prices'),
      tryGet('holdings'),
    ]);
    return {
      accountsR, balancesR, incomeR, checksR, pricesR, holdingsR, quotesR: quotes, adviceR: advice, alertsR: alerts,
      planR: plan, dcaR: dca, decisionsR: decisions, performanceR: performance,
    };
  }
  return {
    accountsR: summary,
    balancesR: summary,
    incomeR: summary,
    checksR: summary,
    pricesR: summary,
    holdingsR: summary,
    quotesR: quotes,
    adviceR: advice,
    alertsR: alerts,
    planR: plan,
    dcaR: dca,
    decisionsR: decisions,
    performanceR: performance,
  };
}

function decisionsBody(decisions) {
  if (!decisions.known && !decisions.items.length) return h('p', { class: 'muted' }, '讀不到待決定事項。');
  if (!decisions.items.length) return h('p', { class: 'ok-text' }, '今天無事');
  return h('div', {}, decisions.items.map((item) => h('article', { class: `decision decision-${item.kind}` },
    h('p', {}, item.title),
    item.detail ? h('p', { class: 'muted' }, item.detail) : null)));
}

function changeLine(change) {
  if (!change || !Number.isFinite(change.twd)) return null;
  const tone = change.twd < 0 ? 'down' : change.twd > 0 ? 'up' : '';
  const pct = Number.isFinite(change.pct) ? `（${formatPct(change.pct)}）` : '';
  return h('p', { class: `day-change ${tone}` }, `較前一日 ${formatTwd(change.twd)}${pct}`);
}

function pathBar(path) {
  if (!path || !Number.isFinite(path.start) || !Number.isFinite(path.target)) return null;
  const ratio = Number.isFinite(path.ratio) ? path.ratio : 0;
  const width = Math.max(0, Math.min(1, ratio)) * 100;
  const state = ratio >= 1 ? '已超過第一年' : ratio < 0 ? '還沒回到起點' : `完成 ${Math.round(ratio * 100)}%`;
  return h('div', { class: 'path' },
    h('p', { class: 'path-label' }, `路徑 D ${wanLabel(path.start)} → 第一年 ${wanLabel(path.target)}`),
    h('div', { class: 'path-track' }, h('span', { class: 'path-fill', style: `width:${width}%` })),
    h('p', { class: 'path-label' }, state));
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
