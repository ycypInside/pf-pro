import { h } from '../dom.js';
import { formatTwd } from '../format.js';
import { ACCOUNT_TYPE } from '../labels.js';
import {
  buildGroups,
  displayAmount,
  hydrateBalances,
  isGroupOpen,
  readGroupState,
  toggleOpen,
  withMode,
  writeGroupState,
} from '../groups.js';

export function renderAccountGroups(balances, accounts, institutions, storage) {
  const store = storage || localStorage;
  let state = readGroupState(store);
  const root = h('div', {});
  draw();
  return root;

  function draw() {
    const rows = hydrateBalances(balances, accounts);
    const groups = buildGroups(state.mode, rows, institutions);
    root.replaceChildren(
      h('div', { class: 'seg two', role: 'tablist', 'aria-label': '帳戶分組' },
        modeButton('bank', '依銀行'),
        modeButton('type', '依類型')),
      groups.length
        ? h('div', {}, groups.map(groupBlock))
        : h('p', { class: 'muted' }, '還沒有帳戶。'));
  }

  function modeButton(mode, label) {
    return h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': state.mode === mode ? 'true' : 'false',
      onClick: () => {
        state = withMode(state, mode);
        writeGroupState(store, state);
        draw();
      },
    }, label);
  }

  function groupBlock(group) {
    const open = isGroupOpen(state, group.id);
    return h('section', {},
      h('button', {
        type: 'button',
        class: 'group-head',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => {
          state = toggleOpen(state, group.id);
          writeGroupState(store, state);
          draw();
        },
      },
      h('span', {}, `${open ? '▾' : '▸'} ${group.label}`),
      h('span', { class: 'num' }, formatTwd(group.total)),
      h('span', { class: 'muted group-sub' }, `現金 ${formatTwd(group.cash)} · 持倉 ${formatTwd(group.holdings)} · 負債 ${formatTwd(group.liabilities)}`)),
      open ? h('div', { class: 'group-body' }, group.accounts.map(accountRow)) : null);
  }
}

function accountRow(row) {
  const amount = displayAmount(row);
  return h('article', { class: 'acct' },
    h('div', {},
      h('p', { class: 'acct-name' }, row.name || row.account_id),
      h('p', { class: 'muted' }, `${ACCOUNT_TYPE[row.type] || row.type || ''} · ${row.currency || ''}`)),
    h('div', { class: 'acct-amt' },
      h('p', { class: 'num' }, formatTwd(amount))));
}
