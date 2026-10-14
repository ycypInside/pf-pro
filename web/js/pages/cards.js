import { hasConfig, tryGet } from '../api.js';
import { h, mount } from '../dom.js';
import { formatMoney, formatPct } from '../format.js';
import { explainError } from '../money.js';
import { cardViews } from '../p1.js';

export async function renderCards(main, ctx) {
  if (!hasConfig()) {
    main.append(h('div', { class: 'stack' },
      h('p', { class: 'lede' }, '尚未設定連線。網址與權杖只會留在這台瀏覽器。'),
      h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.go('settings') }, '前往設定')));
    return;
  }
  main.append(h('p', { class: 'muted' }, '讀取中…'));
  const [cardsR, quotesR, alertsR] = await Promise.all([
    tryGet('holding_cards'),
    tryGet('quotes'),
    tryGet('alerts'),
  ]);
  if (!ctx.alive()) return;
  main.replaceChildren();
  if (!cardsR.ok) {
    main.append(h('section', { class: 'card' },
      h('h2', {}, '持股卡'),
      h('p', { class: 'muted' }, explainError(cardsR.error && cardsR.error.message))));
    return;
  }
  const views = cardViews(
    cardsR.data.cards,
    quotesR.ok ? quotesR.data.quotes : {},
    alertsR.ok ? alertsR.data.alerts : [],
  );
  mount(main,
    h('section', { class: 'card' },
      h('h2', {}, '持股卡'),
      h('p', { class: 'hint' }, '出場線、確認天數與論點檢討日。檢討用，不是操作單。'),
      views.length
        ? h('div', {}, views.map(cardArticle))
        : h('p', { class: 'muted' }, '還沒有持股卡。')));
}

function cardArticle(card) {
  const price = card.price == null ? '—' : formatMoney(card.price, card.currency);
  return h('article', { class: 'acct card-row' },
    h('div', {},
      h('p', { class: 'acct-name' }, card.name),
      h('p', { class: card.stale ? 'estimate' : 'muted' }, card.stale ? `估 ${price}` : `現價 ${price}`),
      h('p', {}, card.exit == null ? '出場線 待補' : `出場線 ${formatMoney(card.exit, card.currency)}`),
      h('p', { class: 'muted' }, card.distance == null ? '距離 待補' : `距離出場線 ${formatPct(card.distance)}`),
      h('p', {}, card.day ? `第 ${card.day.current}/${card.day.total} 日` : '確認天數 待補'),
      h('p', { class: 'hint' }, card.thesis ? `論點檢討 ${card.thesis}` : '論點檢討 待補')),
    card.symbol ? h('div', { class: 'acct-amt' }, h('p', { class: 'muted' }, card.symbol)) : null);
}
