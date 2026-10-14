import { hasConfig, tryGet } from '../api.js';
import { h, mount } from '../dom.js';
import { formatQty } from '../format.js';
import { paperSleeves } from '../p1.js';

export async function renderPaper(main, ctx) {
  if (!hasConfig()) {
    main.append(h('div', { class: 'stack' },
      h('p', { class: 'lede' }, '尚未設定連線。網址與權杖只會留在這台瀏覽器。'),
      h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.go('settings') }, '前往設定')));
    return;
  }
  main.append(h('p', { class: 'muted' }, '讀取中…'));
  const result = await tryGet('paper');
  if (!ctx.alive()) return;
  main.replaceChildren();
  const ready = result.ok && result.data && result.data.ok !== false;
  const sleeves = paperSleeves(ready ? result.data : null);
  mount(main,
    h('section', { class: 'card paper' },
      h('h2', {}, '紙上倉'),
      h('div', { class: 'banner info paper-banner', role: 'note' },
        h('strong', {}, '這是紙上倉，不是真實持倉'),
        h('p', {}, 'A／B／C 三個紙上袖子只拿來對照 0050 與 00631L，不會併進總覽的真實部位。')),
      ready
        ? h('p', { class: 'hint' }, result.data.note || '以下數字只存在紙上。')
        : h('p', { class: 'muted' }, '紙上倉資料還沒準備好。欄位確定後會填進這三個袖子。'),
      h('div', {}, sleeves.map(sleeveArticle))));
}

function sleeveArticle(sleeve) {
  const positions = sleeve.positions || [];
  return h('article', { class: 'paper-sleeve' },
    h('h3', {}, `紙上倉 ${sleeve.id}`),
    h('p', { class: 'muted' }, `對照 ${sleeve.benchmarks.join('、')}`),
    positions.length
      ? h('div', {}, positions.map((row) => h('p', { class: 'paper-pos' },
        h('span', { class: 'tag' }, '紙上'),
        ` ${row.symbol || row.name || '部位'}`,
        row.quantity == null ? '' : ` · ${formatQty(row.quantity)}`,
        row.note ? ` · ${row.note}` : '')))
      : h('p', { class: 'muted' }, '尚無紙上部位'));
}
