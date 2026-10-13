import { hasConfig, tryGet } from '../api.js';
import { field, h, select } from '../dom.js';
import { formatMoney, formatTwd } from '../format.js';
import { FLOW, FX_SOURCE, TXN_LABEL } from '../labels.js';
import {
  activeAccounts,
  buildCashTxn,
  explainError,
  indexBy,
  round2,
  taipeiMonth,
} from '../money.js';
import { createPoster, outcomeView } from '../submit.js';

export async function renderRecords(main, ctx) {
  if (!hasConfig()) {
    main.append(h('div', { class: 'stack' },
      h('p', { class: 'lede' }, '明細需要先設定連線。'),
      h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.go('settings') }, '前往設定')));
    return;
  }
  main.append(h('p', { class: 'muted' }, '讀取明細…'));
  const [txnR, tradeR, accountR] = await Promise.all([
    tryGet('transactions', { limit: 80 }),
    tryGet('trades', { limit: 80 }),
    tryGet('accounts'),
  ]);
  if (!ctx.alive()) return;
  main.replaceChildren();
  if (!txnR.ok) {
    main.append(h('div', { class: 'banner err', role: 'alert' },
      h('strong', {}, '讀不到明細'),
      h('p', {}, explainError(txnR.error && txnR.error.message))));
    return;
  }
  const accounts = activeAccounts(accountR.ok ? accountR.data.accounts : []);
  const names = Object.fromEntries((accountR.ok ? accountR.data.accounts : []).map((account) => [account.account_id, account.name]));
  const accountsById = indexBy(accounts, 'account_id');
  const transactions = txnR.data.transactions || [];
  const trades = tradeR.ok ? tradeR.data.trades || [] : [];
  let showVoid = false;
  const list = h('div', { class: 'ledger' });
  const toggle = h('button', { type: 'button', class: 'text-btn', onClick: () => { showVoid = !showVoid; draw(); } }, '顯示已作廢');
  main.append(
    h('p', { class: 'lede' }, '一般收支用「修正」：後端會作廢原筆並寫入新筆。轉帳會整組作廢。投資交易的現金腿會連同那筆交易一起作廢。'),
    h('div', { class: 'row spread' }, h('p', { class: 'muted' }, `最近 ${transactions.length} 筆`), toggle),
    list);

  draw();

  function draw() {
    toggle.textContent = showVoid ? '隱藏已作廢' : '顯示已作廢';
    const visible = transactions.filter((txn) => showVoid || txn.status === 'active');
    const lone = trades.filter((trade) => !trade.cash_txn_id && (showVoid || trade.status === 'active'));
    list.replaceChildren();
    if (!visible.length && !lone.length) {
      list.append(h('p', { class: 'muted' }, '還沒有紀錄。'));
      return;
    }
    let lastDate = '';
    for (const txn of visible) {
      if (txn.date !== lastDate) {
        lastDate = txn.date;
        list.append(h('h3', { class: 'day' }, txn.date));
      }
      list.append(txnRow(txn));
    }
    if (lone.length) {
      list.append(h('h3', { class: 'day' }, '無現金腿的交易'));
      lone.forEach((trade) => list.append(tradeRow(trade)));
    }
  }

  function txnRow(txn) {
    const title = txn.description || `${TXN_LABEL[txn.txn_type] || txn.txn_type} · ${txn.category || ''}`;
    const voided = txn.status === 'void';
    const editable = !voided && !txn.transfer_group_id && !txn.trade_id;
    return h('article', { class: voided ? 'acct voided' : 'acct' },
      h('div', {},
        h('p', { class: 'acct-name' }, title),
        h('p', { class: 'muted' }, meta(txn))),
      h('div', { class: 'acct-amt' },
        h('p', { class: `num ${Number(txn.amount) < 0 ? 'neg' : 'pos'}` }, formatMoney(txn.amount, txn.currency, txn.currency === 'JPY' ? 0 : 2)),
        h('p', { class: 'num muted' }, formatTwd(txn.amount_twd)),
        voided ? h('p', { class: 'muted' }, '已作廢') : h('div', { class: 'row tight' },
          editable ? h('button', { type: 'button', class: 'text-btn', onClick: () => openReplace(txn) }, '修正') : null,
          h('button', {
            type: 'button',
            class: 'text-btn danger',
            onClick: () => openVoid(txn),
          }, txn.transfer_group_id ? '作廢整組' : txn.trade_id ? '作廢交易' : '作廢'))));
  }

  function meta(txn) {
    const bits = [names[txn.account_id] || txn.account_id, TXN_LABEL[txn.txn_type] || txn.txn_type];
    if (txn.category) bits.push(txn.category);
    if (txn.transfer_group_id) bits.push('成對');
    if (txn.trade_id) bits.push('投資');
    if (txn.replaces_id) bits.push(`取代 ${txn.replaces_id}`);
    return bits.join(' · ');
  }

  function tradeRow(trade) {
    const voided = trade.status === 'void';
    return h('article', { class: voided ? 'acct voided' : 'acct' },
      h('div', {},
        h('p', { class: 'acct-name' }, `${trade.side} · ${trade.asset_id}`),
        h('p', { class: 'muted' }, `${trade.trade_date} · ${names[trade.account_id] || trade.account_id}`)),
      h('div', { class: 'acct-amt' },
        h('p', { class: 'num' }, formatMoney(trade.net_amount, trade.currency)),
        voided ? h('p', { class: 'muted' }, '已作廢') : h('button', {
          type: 'button',
          class: 'text-btn danger',
          onClick: () => openTradeVoid(trade),
        }, '作廢')));
  }

  function openVoid(txn) {
    const hint = txn.transfer_group_id
      ? '轉帳會把同一組的兩筆（以及手續費）一起作廢。作廢後請到記帳頁重新輸入。'
      : txn.trade_id
        ? '這筆是投資交易的現金腿，作廢時會連同交易一起作廢。'
        : '作廢後若要改內容，請再記一筆新的。一般收支也可以用修正，一次完成作廢與新筆。';
    openReason({
      title: txn.transfer_group_id ? '作廢整組轉帳' : '作廢這筆',
      hint,
      action: 'void_transaction',
      build: (reason) => ({ txn_id: txn.txn_id, void_reason: reason }),
    });
  }

  function openTradeVoid(trade) {
    openReason({
      title: '作廢投資交易',
      hint: '交易與它的現金腿會一起作廢。',
      action: 'void_trade',
      build: (reason) => ({ trade_id: trade.trade_id, void_reason: reason }),
    });
  }

  function openReason({ title, hint, action, build }) {
    const poster = createPoster(action);
    const reason = h('textarea', { rows: '3', required: true, placeholder: '原因' });
    const status = h('div', {});
    const submit = h('button', { type: 'submit', class: 'btn danger' }, '作廢');
    const dialog = h('dialog', { class: 'sheet' });
    const form = h('form', { class: 'stack', onSubmit: (event) => { event.preventDefault(); send(false); } },
      h('h2', {}, title),
      h('p', { class: 'hint' }, hint),
      field('原因', reason),
      status,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn ghost', onClick: () => dialog.close() }, '取消'),
        submit));
    dialog.append(form);
    dialog.addEventListener('close', () => dialog.remove());
    main.append(dialog);
    dialog.showModal();
    reason.focus();

    async function send(retry) {
      const text = reason.value.trim();
      if (!retry && !text) {
        status.replaceChildren(h('div', { class: 'banner err', role: 'alert' }, h('p', {}, '請填作廢原因')));
        return;
      }
      submit.disabled = true;
      const outcome = await poster.send(retry ? undefined : build(text));
      submit.disabled = false;
      status.replaceChildren(outcomeView(outcome, () => send(true)));
      if (outcome.res && outcome.res.ok) {
        dialog.close();
        ctx.reload();
      }
    }
  }

  function openReplace(txn) {
    const poster = createPoster('replace_transaction');
    const account = select('account_id', accounts.map((item) => [item.account_id, `${item.name} · ${item.currency}`]), txn.account_id);
    const date = h('input', { type: 'date', value: String(txn.date || taipeiMonth().iso) });
    const category = h('input', { value: txn.category || '' });
    const amount = h('input', { inputmode: 'decimal', value: String(Math.abs(Number(txn.amount || 0))) });
    const fx = h('input', { inputmode: 'decimal', value: String(txn.fx_rate || 1) });
    const fxSource = select('fx_source', FX_SOURCE, txn.fx_source || 'actual');
    const flow = select('flow_class', FLOW, txn.flow_class || 'external');
    const description = h('input', { value: txn.description || '' });
    const reason = h('input', { value: '更正' });
    const status = h('div', {});
    const submit = h('button', { type: 'submit', class: 'btn primary' }, '作廢並寫入新筆');
    const dialog = h('dialog', { class: 'sheet' });
    const form = h('form', { class: 'stack', onSubmit: (event) => { event.preventDefault(); send(false); } },
      h('h2', {}, '修正'),
      h('p', { class: 'hint' }, '送出後原筆變成作廢，新筆的 replaces_id 會指向它。這是一次請求。'),
      field('日期', date),
      field('帳戶', account),
      field('分類', category),
      field('金額（正數）', amount),
      field('匯率', fx),
      field('匯率來源', fxSource),
      field('資金分類', flow),
      field('備註', description),
      field('原因', reason),
      status,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn ghost', onClick: () => dialog.close() }, '取消'),
        submit));
    dialog.append(form);
    dialog.addEventListener('close', () => dialog.remove());
    main.append(dialog);
    dialog.showModal();

    function payload() {
      const accountRow = accountsById[account.value] || { currency: txn.currency };
      return {
        txn_id: txn.txn_id,
        void_reason: reason.value.trim() || 'replaced',
        data: buildCashTxn({
          date: date.value,
          accountId: account.value,
          txnType: txn.txn_type,
          category: category.value.trim(),
          amountAbs: amount.value,
          currency: accountRow.currency || txn.currency,
          fxRate: fx.value,
          fxSource: fxSource.value,
          flowClass: flow.value,
          description: description.value.trim(),
        }),
      };
    }

    async function send(retry) {
      const body = payload();
      if (!retry && (!body.data.category || !body.data.amount)) {
        status.replaceChildren(h('div', { class: 'banner err', role: 'alert' }, h('p', {}, '請填分類與金額')));
        return;
      }
      submit.disabled = true;
      const outcome = await poster.send(retry ? undefined : body);
      submit.disabled = false;
      status.replaceChildren(outcomeView(outcome, () => send(true)));
      if (outcome.res && outcome.res.ok && !outcome.network) {
        const twd = round2(body.data.amount * body.data.fx_rate);
        status.append(h('p', { class: 'hint' }, `新筆金額 ${formatMoney(body.data.amount, body.data.currency)} · ${formatTwd(twd)}`));
        setTimeout(() => { if (dialog.open) { dialog.close(); ctx.reload(); } }, 700);
      }
    }
  }
}
