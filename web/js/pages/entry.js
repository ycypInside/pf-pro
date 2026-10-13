import { hasConfig, tryGet } from '../api.js';
import { field, h, mount, select } from '../dom.js';
import { formatMoney, formatTwd } from '../format.js';
import {
  ASSET_CLASS,
  DEFAULT_EXPENSE,
  DEFAULT_INCOME,
  FLOW,
  FX_SOURCE,
  MARKET_SOURCE,
  PRICE_KIND,
  PRICE_SOURCE,
  SIDES,
} from '../labels.js';
import {
  activeAccounts,
  buildCashTxn,
  buildPrice,
  buildTrade,
  buildTransfer,
  explainError,
  fxMap,
  indexBy,
  isYes,
  parseList,
  problemsForCash,
  problemsForPrice,
  problemsForTrade,
  problemsForTransfer,
  round2,
  taipeiMonth,
  tradeEconomics,
} from '../money.js';
import {
  mergeEntryPreset,
  readLastCash,
  readTemplates,
  rememberTemplate,
  usableLastCash,
  writeLastCash,
  writeTemplates,
} from '../prefs.js';
import { createPoster, outcomeView } from '../submit.js';

const CURRENCIES = ['TWD', 'USD', 'JPY', 'EUR', 'CNY', 'HKD', 'AUD', 'GBP'];

export async function renderEntry(main, ctx) {
  if (!hasConfig()) {
    main.append(h('div', { class: 'stack' },
      h('p', { class: 'lede' }, '記帳前請先在設定頁儲存 API 網址與權杖。'),
      h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.go('settings') }, '前往設定')));
    return;
  }
  main.append(h('p', { class: 'muted' }, '讀取帳戶…'));
  const [accountsR, assetsR, pricesR, settingsR] = await Promise.all([
    tryGet('accounts'),
    tryGet('assets'),
    tryGet('prices'),
    tryGet('settings'),
  ]);
  if (!ctx.alive()) return;
  main.replaceChildren();
  if (!accountsR.ok) {
    main.append(h('div', { class: 'banner err', role: 'alert' },
      h('strong', {}, '讀不到帳戶'),
      h('p', {}, explainError(accountsR.error && accountsR.error.message))));
    return;
  }
  const accounts = activeAccounts(accountsR.data.accounts);
  const accountsById = indexBy(accounts, 'account_id');
  const assets = (assetsR.ok ? assetsR.data.assets : []).filter((asset) => asset.status !== 'delisted');
  const assetsById = indexBy(assets, 'asset_id');
  const quotes = pricesR.ok ? pricesR.data.quotes : [];
  const rates = fxMap(quotes);
  const settings = settingsR.ok ? settingsR.data.settings : {};
  const expenseCats = parseList(settings.categories_expense, DEFAULT_EXPENSE);
  const incomeCats = parseList(settings.categories_income, DEFAULT_INCOME);
  const today = taipeiMonth().iso;
  let tab = 'cash';

  const panels = {
    cash: cashPanel(),
    transfer: transferPanel(),
    trade: tradePanel(),
    price: pricePanel(),
  };
  const tabs = h('div', { class: 'seg', role: 'tablist' },
    tabButton('cash', '收支'),
    tabButton('transfer', '轉帳'),
    tabButton('trade', '投資'),
    tabButton('price', '報價'));
  const deck = h('div', {}, Object.values(panels));
  mount(main,
    assetsR.ok ? null : h('p', { class: 'hint' }, '標的清單需要更新後的後端。'),
    tabs,
    deck);
  const initialTab = ['cash', 'transfer', 'trade', 'price'].includes(ctx.query && ctx.query.tab)
    ? ctx.query.tab
    : 'cash';
  show(initialTab);
  const saved = usableLastCash(readLastCash(localStorage), accounts.map((account) => account.account_id));
  const query = ctx.query || {};
  if (query.mode || query.account || query.category || query.kind) {
    panels.cash.applyPreset(mergeEntryPreset(saved, query, { income: incomeCats, expense: expenseCats }));
  } else if (saved) {
    panels.cash.applyPreset(saved);
  }

  function tabButton(id, label) {
    return h('button', { type: 'button', role: 'tab', dataset: { tab: id }, onClick: () => show(id) }, label);
  }

  function show(id) {
    tab = id;
    for (const button of tabs.querySelectorAll('button')) {
      button.setAttribute('aria-selected', button.dataset.tab === id ? 'true' : 'false');
    }
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== id;
  }

  function accountSelect(name, placeholder) {
    return select(name, [[ '', placeholder ], ...accounts.map((account) => [account.account_id, `${account.name} · ${account.currency}`])]);
  }

  function datalist(id, values) {
    return h('datalist', { id }, values.map((value) => h('option', { value })));
  }

  function problemsBanner(problems) {
    return h('div', { class: 'banner err', role: 'alert' },
      h('strong', {}, '請先修正'),
      h('ul', { class: 'plain' }, problems.map((problem) => h('li', {}, problem))));
  }

  function cashPanel() {
    const poster = createPoster('add_transaction');
    const status = h('div', {});
    const preview = h('p', { class: 'preview num' }, '');
    const form = h('form', { class: 'stack' });
    const kindExpense = h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': 'true' }, '支出');
    const kindIncome = h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': 'false' }, '收入');
    let incomeMode = false;
    const incomeType = select('income_type', [['income', '一般收入'], ['dividend', '股息'], ['interest', '利息']]);
    const incomeWrap = field('收入種類', incomeType);
    incomeWrap.hidden = true;
    const account = accountSelect('account_id', '選擇帳戶');
    const category = h('input', { name: 'category', list: 'cats', required: true, placeholder: '例如 餐飲' });
    const amount = h('input', { name: 'amount', inputmode: 'decimal', placeholder: '0', required: true });
    const fx = h('input', { name: 'fx_rate', inputmode: 'decimal', placeholder: '1 原幣兌台幣' });
    const fxWrap = field('匯率（兌台幣）', fx, '台幣帳戶固定為 1。');
    const fxSource = select('fx_source', FX_SOURCE, 'actual');
    const flow = select('flow_class', FLOW, 'external');
    const date = h('input', { name: 'date', type: 'date', value: today, required: true });
    const description = h('input', { name: 'description', placeholder: '選填' });
    const submit = h('button', { type: 'submit', class: 'btn primary' }, '入帳');
    const chipBox = h('div', {});
    kindExpense.addEventListener('click', () => setIncome(false));
    kindIncome.addEventListener('click', () => setIncome(true));
    account.addEventListener('change', syncFx);
    form.addEventListener('input', () => preview.textContent = cashPreview());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      send(false);
    });
    category.value = expenseCats[0] || '';
    paintChips();
    form.append(
      chipBox,
      h('div', { class: 'seg two' }, kindExpense, kindIncome),
      incomeWrap,
      field('日期', date),
      field('帳戶', account),
      field('分類', category),
      datalist('cats', expenseCats),
      field('金額', amount, '填正數即可，支出會記成流出。'),
      fxWrap,
      field('匯率來源', fxSource),
      field('資金分類', flow),
      field('備註', description),
      preview,
      submit,
      status);
    syncFx();
    form.applyPreset = applyPreset;
    return form;

    function paintChips() {
      const items = readTemplates(localStorage).filter((item) => accountsById[item.account_id]);
      chipBox.hidden = !items.length;
      chipBox.replaceChildren();
      if (!items.length) return;
      chipBox.append(h('div', { class: 'chips' }, items.map((item) => h('button', {
        type: 'button',
        class: 'chip',
        onClick: () => applyPreset({
          account_id: item.account_id,
          category: item.category,
          income: item.kind !== 'expense',
          income_type: item.kind === 'dividend' || item.kind === 'interest' ? item.kind : 'income',
          kind: item.kind,
        }),
      }, item.label || item.category))));
    }

    function applyPreset(preset) {
      if (!preset) return;
      if (preset.account_id && accountsById[preset.account_id]) account.value = preset.account_id;
      if (preset.income_type === 'dividend' || preset.income_type === 'interest' || preset.kind === 'dividend' || preset.kind === 'interest') {
        incomeType.value = preset.income_type === 'dividend' || preset.income_type === 'interest' ? preset.income_type : preset.kind;
      }
      if (preset.income === true || preset.income === false) setIncome(preset.income);
      if (preset.category) category.value = preset.category;
      if (preset.flow_class) flow.value = preset.flow_class;
      syncFx();
    }

    function setIncome(next) {
      incomeMode = next;
      kindExpense.setAttribute('aria-pressed', next ? 'false' : 'true');
      kindIncome.setAttribute('aria-pressed', next ? 'true' : 'false');
      incomeWrap.hidden = !next;
      const list = form.querySelector('#cats') || form.querySelector('datalist');
      if (list) {
        list.replaceChildren(...(next ? incomeCats : expenseCats).map((value) => h('option', { value })));
      }
      if (!category.value || expenseCats.includes(category.value) || incomeCats.includes(category.value)) {
        category.value = next ? (incomeCats[0] || '') : (expenseCats[0] || '');
      }
      const type = incomeType.value;
      if (next && (type === 'dividend' || type === 'interest')) flow.value = 'investment_income';
      else flow.value = 'external';
      preview.textContent = cashPreview();
    }

    function syncFx() {
      const accountRow = accountsById[account.value];
      const twd = !accountRow || accountRow.currency === 'TWD';
      fxWrap.hidden = twd;
      if (twd) fx.value = '1';
      else if (!fx.value && rates[accountRow.currency]) {
        fx.value = String(rates[accountRow.currency].value);
        fxSource.value = 'market';
      }
      preview.textContent = cashPreview();
    }

    function read() {
      const accountRow = accountsById[account.value];
      const txnType = incomeMode ? incomeType.value : 'expense';
      return buildCashTxn({
        date: date.value,
        accountId: account.value,
        txnType,
        category: category.value.trim(),
        amountAbs: amount.value,
        currency: accountRow ? accountRow.currency : 'TWD',
        fxRate: fx.value,
        fxSource: fxSource.value,
        flowClass: flow.value,
        description: description.value.trim(),
      });
    }

    function cashPreview() {
      const txn = read();
      if (!Number.isFinite(txn.amount) || txn.amount === 0 || !txn.currency) return '';
      const twd = round2(txn.amount * txn.fx_rate);
      return `將寫入 ${formatMoney(txn.amount, txn.currency)} · ${formatTwd(twd)}`;
    }

    async function send(retry) {
      const txn = read();
      const accountRow = accountsById[txn.account_id];
      const problems = problemsForCash({ ...txn, investmentAccount: !!(accountRow && isYes(accountRow.is_investment)) });
      if (!retry && problems.length) {
        status.replaceChildren(problemsBanner(problems));
        return;
      }
      submit.disabled = true;
      const outcome = await poster.send(retry ? undefined : txn);
      submit.disabled = false;
      if (!ctx.alive()) return;
      status.replaceChildren(outcomeView(outcome, () => send(true)));
      if (outcome.res && outcome.res.ok) {
        const kind = incomeMode ? incomeType.value : 'expense';
        const kindName = kind === 'dividend' ? '股息' : kind === 'interest' ? '利息' : incomeMode ? '收入' : '支出';
        writeLastCash({
          account_id: txn.account_id,
          category: txn.category,
          income: incomeMode,
          income_type: incomeMode ? incomeType.value : 'income',
          flow_class: flow.value,
        }, localStorage);
        writeTemplates(rememberTemplate(readTemplates(localStorage), {
          kind,
          account_id: txn.account_id,
          category: txn.category,
          label: `${kindName} · ${txn.category}`,
        }), localStorage);
        paintChips();
        if (!outcome.res.replay) {
          amount.value = '';
          description.value = '';
          preview.textContent = '';
        }
      }
    }
  }

  function transferPanel() {
    const poster = createPoster('add_transfer');
    const status = h('div', {});
    const preview = h('p', { class: 'preview num' }, '');
    const date = h('input', { type: 'date', value: today, required: true });
    const fromAccount = accountSelect('from_account', '轉出帳戶');
    const toAccount = accountSelect('to_account', '轉入帳戶');
    const fromAmount = h('input', { inputmode: 'decimal', placeholder: '轉出金額' });
    const toAmount = h('input', { inputmode: 'decimal', placeholder: '轉入金額' });
    const fromFx = h('input', { inputmode: 'decimal', placeholder: '匯率' });
    const toFx = h('input', { inputmode: 'decimal', placeholder: '匯率' });
    const fromFxWrap = field('轉出匯率', fromFx);
    const toFxWrap = field('轉入匯率', toFx);
    const toAmountWrap = field('轉入金額', toAmount, '同幣別時與轉出相同。');
    const fxSource = select('fx_source', FX_SOURCE, 'actual');
    const flow = select('flow_class', FLOW, 'internal');
    const description = h('input', { placeholder: '選填' });
    const feeOn = h('input', { type: 'checkbox' });
    const feeAmount = h('input', { inputmode: 'decimal', placeholder: '手續費' });
    const feeAccount = accountSelect('fee_account', '手續費帳戶');
    const feeBox = h('div', { class: 'stack inset' }, field('手續費金額', feeAmount), field('手續費帳戶', feeAccount));
    feeBox.hidden = true;
    const submit = h('button', { type: 'submit', class: 'btn primary' }, '轉帳');
    const form = h('form', { class: 'stack', onSubmit: (event) => { event.preventDefault(); send(false); } },
      field('日期', date),
      field('轉出', fromAccount),
      field('轉入', toAccount),
      field('轉出金額', fromAmount),
      toAmountWrap,
      fromFxWrap,
      toFxWrap,
      field('匯率來源', fxSource),
      field('資金分類', flow, '自己帳戶之間通常是內部移轉。'),
      field('備註', description),
      h('label', { class: 'check' }, feeOn, '另記一筆手續費'),
      feeBox,
      preview,
      submit,
      status);
    feeOn.addEventListener('change', () => { feeBox.hidden = !feeOn.checked; });
    form.addEventListener('input', sync);
    sync();
    return form;

    function currencies() {
      return {
        from: accountsById[fromAccount.value],
        to: accountsById[toAccount.value],
      };
    }

    function sync() {
      const { from, to } = currencies();
      const same = from && to && from.currency === to.currency;
      toAmount.readOnly = !!same;
      if (same) toAmount.value = fromAmount.value;
      fromFxWrap.hidden = !from || from.currency === 'TWD';
      toFxWrap.hidden = !to || to.currency === 'TWD' || same;
      if (from && from.currency !== 'TWD' && !fromFx.value && rates[from.currency]) fromFx.value = String(rates[from.currency].value);
      if (to && to.currency !== 'TWD' && !same && !toFx.value && rates[to.currency]) toFx.value = String(rates[to.currency].value);
      preview.textContent = transferPreview();
    }

    function read() {
      const { from, to } = currencies();
      const fromCurrency = from ? from.currency : 'TWD';
      const toCurrency = to ? to.currency : 'TWD';
      const same = fromCurrency === toCurrency;
      const feeAccountRow = accountsById[feeAccount.value];
      return buildTransfer({
        date: date.value,
        fromAccount: fromAccount.value,
        toAccount: toAccount.value,
        fromAmount: fromAmount.value,
        toAmount: same ? fromAmount.value : toAmount.value,
        fromCurrency,
        toCurrency,
        fromFx: fromFx.value,
        toFx: same ? fromFx.value : toFx.value,
        fxSourceFrom: fxSource.value,
        fxSourceTo: fxSource.value,
        flowClass: flow.value,
        description: description.value.trim(),
        fee: feeOn.checked ? {
          account_id: feeAccount.value,
          amount: feeAmount.value,
          currency: feeAccountRow ? feeAccountRow.currency : 'TWD',
          fx_rate: !feeAccountRow || feeAccountRow.currency === 'TWD'
            ? 1
            : Number((rates[feeAccountRow.currency] && rates[feeAccountRow.currency].value) || fromFx.value || 0),
          fx_source: fxSource.value,
        } : null,
      });
    }

    function transferPreview() {
      const data = read();
      if (!data.from.currency || !Number.isFinite(data.from.amount)) return '轉帳會一次寫入成對兩筆。';
      const outTwd = round2(data.from.amount * data.from.fx_rate);
      const inTwd = round2(data.to.amount * data.to.fx_rate);
      const gap = round2(inTwd + outTwd);
      const gapText = data.from.currency === data.to.currency ? '' : ` · 台幣差額 ${formatTwd(gap)}`;
      return `轉出 ${formatMoney(data.from.amount, data.from.currency)}，轉入 ${formatMoney(data.to.amount, data.to.currency)}${gapText}`;
    }

    async function send(retry) {
      const data = read();
      const problems = problemsForTransfer(data, accountsById);
      if (!retry && problems.length) {
        status.replaceChildren(problemsBanner(problems));
        return;
      }
      submit.disabled = true;
      const outcome = await poster.send(retry ? undefined : data);
      submit.disabled = false;
      if (!ctx.alive()) return;
      status.replaceChildren(outcomeView(outcome, () => send(true)));
      if (outcome.res && outcome.res.ok && !outcome.res.replay) {
        fromAmount.value = '';
        toAmount.value = '';
        description.value = '';
      }
    }
  }

  function tradePanel() {
    const poster = createPoster('add_trade');
    const assetPoster = createPoster('create_asset');
    const status = h('div', {});
    const assetStatus = h('div', {});
    const preview = h('p', { class: 'preview num' }, '');
    const date = h('input', { type: 'date', value: today, required: true });
    const settle = h('input', { type: 'date' });
    const account = accountSelect('account_id', '選擇投資帳戶');
    const asset = select('asset_id', [['', '選擇標的'], ...assets.map((item) => [item.asset_id, `${item.name} · ${item.currency}`])]);
    const side = select('side', SIDES, 'buy');
    const quantity = h('input', { inputmode: 'decimal', placeholder: '股數' });
    const price = h('input', { inputmode: 'decimal', placeholder: '成交價' });
    const fee = h('input', { inputmode: 'decimal', placeholder: '0', value: '0' });
    const tax = h('input', { inputmode: 'decimal', placeholder: '0', value: '0' });
    const accrued = h('input', { inputmode: 'decimal', placeholder: '債券前手息，可空白' });
    const fx = h('input', { inputmode: 'decimal' });
    const fxWrap = field('匯率（兌台幣）', fx);
    const fxSource = select('fx_source', FX_SOURCE, 'actual');
    const description = h('input', { placeholder: '選填' });
    const submit = h('button', { type: 'submit', class: 'btn primary' }, '記入交易');
    const form = h('form', { class: 'stack', onSubmit: (event) => { event.preventDefault(); send(false); } },
      h('p', { class: 'hint' }, '買進現金為負的成交金額加費用；賣出為成交金額減費用。分割請填增加的股數，價格可為 0。'),
      field('交易日', date),
      field('交割日', settle, '可空白。'),
      field('帳戶', account),
      field('標的', asset),
      newAssetBox(),
      field('方向', side),
      field('數量', quantity),
      field('價格', price),
      field('手續費', fee),
      field('稅', tax),
      field('前手息', accrued),
      fxWrap,
      field('匯率來源', fxSource),
      field('備註', description),
      preview,
      submit,
      status);
    form.addEventListener('input', () => { syncFx(); preview.textContent = tradePreview(); });
    syncFx();
    return form;

    function newAssetBox() {
      const id = h('input', { placeholder: '例如 AST-0050' });
      const name = h('input', { placeholder: '名稱' });
      const assetClass = select('asset_class', ASSET_CLASS, 'etf');
      const symbol = h('input', { placeholder: '0050.TW 或 MU' });
      const currency = select('currency', CURRENCIES.map((code) => [code, code]), 'TWD');
      const source = select('price_source', PRICE_SOURCE, 'manual');
      const button = h('button', { type: 'button', class: 'btn', onClick: create }, '建立標的');
      const box = h('details', { class: 'inset' },
        h('summary', {}, '新增標的'),
        h('div', { class: 'stack' },
          field('代號', id),
          field('名稱', name),
          field('種類', assetClass),
          field('交易所代碼', symbol),
          field('幣別', currency),
          field('報價方式', source),
          button,
          assetStatus));

      async function create() {
        const payload = {
          asset_id: id.value.trim(),
          name: name.value.trim(),
          asset_class: assetClass.value,
          symbol: symbol.value.trim(),
          currency: currency.value,
          price_source: source.value,
        };
        if (!payload.asset_id || !payload.name) {
          assetStatus.replaceChildren(problemsBanner(['請填代號與名稱']));
          return;
        }
        button.disabled = true;
        const outcome = await assetPoster.send(payload);
        button.disabled = false;
        if (!ctx.alive()) return;
        assetStatus.replaceChildren(outcomeView(outcome, () => create()));
        if (outcome.res && outcome.res.ok) {
          assetsById[payload.asset_id] = { ...payload, status: 'active' };
          const option = h('option', { value: payload.asset_id }, `${payload.name} · ${payload.currency}`);
          asset.append(option);
          asset.value = payload.asset_id;
          syncFx();
        }
      }

      box.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') event.preventDefault();
      });
      return box;
    }

    function chosenAsset() {
      return assetsById[asset.value];
    }

    function syncFx() {
      const item = chosenAsset();
      const twd = !item || item.currency === 'TWD';
      fxWrap.hidden = twd;
      if (twd) fx.value = '1';
      else if (!fx.value && item && rates[item.currency]) {
        fx.value = String(rates[item.currency].value);
        fxSource.value = 'market';
      }
    }

    function read() {
      const item = chosenAsset();
      return buildTrade({
        tradeDate: date.value,
        settleDate: settle.value,
        accountId: account.value,
        assetId: asset.value,
        side: side.value,
        quantity: quantity.value,
        price: price.value || 0,
        fee: fee.value || 0,
        tax: tax.value || 0,
        accrued: accrued.value,
        currency: item ? item.currency : 'TWD',
        fxRate: fx.value || 1,
        fxSource: fxSource.value,
        description: description.value.trim(),
      });
    }

    function tradePreview() {
      const data = read();
      if (!(data.quantity > 0)) return '預覽會顯示現金腿。';
      const econ = tradeEconomics({
        side: data.side,
        quantity: data.quantity,
        price: data.price,
        fee: data.fee,
        tax: data.tax,
        accrued: data.accrued_interest || 0,
        fxRate: data.fx_rate,
      });
      const item = chosenAsset();
      const currency = item ? item.currency : '';
      return `成交 ${formatMoney(econ.gross, currency)} · 現金 ${formatMoney(econ.net, currency)} · ${formatTwd(econ.netTwd)}`;
    }

    async function send(retry) {
      const data = read();
      const problems = problemsForTrade(data, accountsById[data.account_id], chosenAsset());
      if (!retry && problems.length) {
        status.replaceChildren(problemsBanner(problems));
        return;
      }
      submit.disabled = true;
      const outcome = await poster.send(retry ? undefined : data);
      submit.disabled = false;
      if (!ctx.alive()) return;
      status.replaceChildren(outcomeView(outcome, () => send(true)));
    }
  }

  function pricePanel() {
    const poster = createPoster('add_price');
    const status = h('div', {});
    const symbol = h('input', { placeholder: '0050.TW、MU 或 USDTWD', list: 'symbols' });
    const symbols = [...assets.map((item) => item.symbol || item.asset_id), 'USDTWD', 'JPYTWD', 'EURTWD'];
    const kind = select('kind', PRICE_KIND, 'price');
    const date = h('input', { type: 'date', value: today });
    const value = h('input', { inputmode: 'decimal', placeholder: '價格或匯率' });
    const currency = select('currency', CURRENCIES.map((code) => [code, code]), 'TWD');
    const source = select('source', MARKET_SOURCE, 'manual');
    const note = h('input', { placeholder: '選填' });
    const submit = h('button', { type: 'submit', class: 'btn primary' }, '新增報價');
    const form = h('form', { class: 'stack', onSubmit: (event) => { event.preventDefault(); send(false); } },
      h('p', { class: 'hint' }, '價格只新增、不覆寫。同一代號、日期、來源已存在時會被拒絕。'),
      field('代號', symbol),
      h('datalist', { id: 'symbols' }, symbols.filter(Boolean).map((item) => h('option', { value: item }))),
      field('種類', kind),
      field('日期', date),
      field('數值', value),
      field('幣別', currency),
      field('來源', source),
      field('備註', note),
      submit,
      status);
    kind.addEventListener('change', () => {
      if (kind.value === 'fx') {
        currency.value = 'TWD';
        if (!symbol.value) symbol.value = 'USDTWD';
      }
      if (kind.value === 'bond_valuation') note.placeholder = '最後估值日會顯示在總覽';
    });
    return form;

    function read() {
      return buildPrice({
        symbol: symbol.value,
        kind: kind.value,
        date: date.value,
        value: value.value,
        currency: currency.value,
        source: source.value,
        note: note.value.trim(),
      });
    }

    async function send(retry) {
      const data = read();
      const problems = problemsForPrice(data);
      if (!retry && problems.length) {
        status.replaceChildren(problemsBanner(problems));
        return;
      }
      submit.disabled = true;
      const outcome = await poster.send(retry ? undefined : data);
      submit.disabled = false;
      if (!ctx.alive()) return;
      status.replaceChildren(outcomeView(outcome, () => send(true)));
      if (outcome.res && outcome.res.ok && !outcome.res.replay) value.value = '';
    }
  }
}
