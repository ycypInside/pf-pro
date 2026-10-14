import { tryGet } from '../api.js';
import { h } from '../dom.js';
import { formatMoney, formatPct, formatQty, formatTwd } from '../format.js';
import { groupHoldings, joinHoldings, quoteTone, sortHoldings } from '../groups.js';
import { formatLevel, levelLadder } from '../levels.js';
import { paintChart, rangeMarker } from '../price-chart.js';

const SORTS = [['value', '市值'], ['change', '漲跌'], ['pl', '損益'], ['name', '名稱']];
let sortKey = 'value';
let groupMode = 'account';

export function renderHoldings(holdings, quotes, names) {
  const root = h('div', {});
  draw();
  return root;

  function draw() {
    const joined = sortHoldings(joinHoldings(holdings, quotes), sortKey);
    const groups = groupHoldings(joined, groupMode, names);
    root.replaceChildren(
      h('div', { class: 'seg', role: 'tablist', 'aria-label': '持倉排序' }, SORTS.map(([id, label]) => h('button', {
        type: 'button',
        'aria-selected': sortKey === id ? 'true' : 'false',
        onClick: () => { sortKey = id; draw(); },
      }, label))),
      h('div', { class: 'seg two', role: 'tablist', 'aria-label': '持倉分組' },
        groupButton('account', '依帳戶'),
        groupButton('class', '依類型')),
      groups.length
        ? h('div', {}, groups.map((group) => h('section', {},
          h('h3', {}, group.label),
          ...group.rows.map(quoteRow))))
        : h('p', { class: 'muted' }, '還沒有持倉。'));
  }

  function groupButton(mode, label) {
    return h('button', {
      type: 'button',
      'aria-selected': groupMode === mode ? 'true' : 'false',
      onClick: () => { groupMode = mode; draw(); },
    }, label);
  }
}

function quoteRow(row) {
  const tone = quoteTone(row.change_pct);
  return h('button', {
    type: 'button',
    class: 'quote-row',
    onClick: () => openDetail(row),
  },
  h('span', { class: 'quote-top' },
    h('strong', {}, row.name),
    h('span', { class: tone === 'up' ? 'tw-up num' : tone === 'down' ? 'tw-down num' : 'muted num' }, formatPct(row.change_pct))),
  h('span', { class: 'quote-sub' },
    h('span', { class: 'muted' }, `${row.symbol} · ${formatMoney(row.price, row.currency)}`),
    sparkline(row.spark, tone)),
  h('span', { class: 'quote-metrics' },
    metric('成本', formatTwd(row.cost)),
    metric('市值', formatTwd(row.value)),
    metric('損益', formatPct(row.pl_pct), tone),
    metric('比重', formatPct(row.weight).replace('+', ''))));
}

function metric(label, value, tone) {
  const klass = tone === 'up' ? 'tw-up' : tone === 'down' ? 'tw-down' : '';
  return h('span', {},
    h('span', { class: 'muted' }, label),
    h('span', { class: `num ${klass}` }, value));
}

function sparkline(values, tone) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = 60 / (nums.length - 1);
  const points = nums.map((value, index) => `${(index * step).toFixed(1)},${(22 - ((value - min) / span) * 20).toFixed(1)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 60 24');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', tone === 'up' ? '#9c4036' : tone === 'down' ? '#1d6b4f' : '#667069');
  line.setAttribute('stroke-width', '1.6');
  svg.append(line);
  return svg;
}

async function openDetail(row) {
  const dialog = h('dialog', { class: 'sheet' });
  const body = h('div', { class: 'stack' });
  dialog.append(
    h('div', { class: 'row spread' },
      h('h2', {}, row.name),
      h('button', { type: 'button', class: 'text-btn', onClick: () => dialog.close() }, '關閉')),
    body);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  body.append(h('p', { class: 'muted' }, '讀取走勢…'));
  const result = await tryGet('chart', { asset: row.asset_id });
  body.replaceChildren();
  if (!result.ok) {
    body.append(h('p', { class: 'muted' }, '讀不到這檔走勢。'));
    return;
  }
  const data = result.data;
  let mode = 'line';
  const canvas = h('canvas', { class: 'price-canvas', role: 'img', 'aria-label': `${row.name} 走勢` });
  const tools = h('div', { class: 'seg two', role: 'tablist', 'aria-label': '圖形' },
    chartButton('line', '折線'),
    chartButton('candle', 'K 線'));
  const range = rangeMarker(data.levels, data.rows && data.rows.length ? data.rows[data.rows.length - 1].c : row.price);
  body.append(
    h('p', { class: 'muted' }, `${data.symbol || row.symbol} · ${formatQty(row.quantity)}`),
    data.source === 'stored' ? h('p', { class: 'hint' }, '價格來源：已儲存淨值') : null,
    tools,
    canvas,
    h('p', { class: 'legend' },
      h('span', {}, h('i', { class: 'swatch', style: 'background:#1d6b4f' }), '價格'),
      h('span', {}, h('i', { class: 'swatch', style: 'background:#8a5a12' }), 'MA20'),
      h('span', {}, h('i', { class: 'swatch', style: 'background:#1f2a5c' }), 'MA60')),
    range ? h('div', {},
      h('p', { class: 'muted' }, `52 週 ${formatMoney(range.low, row.currency)} – ${formatMoney(range.high, row.currency)}`),
      h('div', { class: 'alloc-track' }, h('span', { class: 'alloc-target', style: `left:${range.left}` }))) : null,
    levelsSection(data));
  paint();

  function chartButton(id, label) {
    return h('button', {
      type: 'button',
      'aria-selected': mode === id ? 'true' : 'false',
      onClick: () => { mode = id; syncTools(); paint(); },
    }, label);
  }

  function syncTools() {
    for (const button of tools.querySelectorAll('button')) {
      button.setAttribute('aria-selected', button.textContent === (mode === 'line' ? '折線' : 'K 線') ? 'true' : 'false');
    }
  }

  function paint() {
    requestAnimationFrame(() => paintChart(canvas, data, mode));
  }
}

function levelsSection(payload) {
  const ladder = levelLadder(payload);
  if (!ladder.rows.length) return null;
  return h('section', { class: 'levels' },
    h('h3', {}, 'Levels'),
    h('p', { class: 'level-summary' }, ladder.summary),
    h('table', { class: 'level-table' },
      h('caption', { class: 'sr' }, 'Levels'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, '價位'),
        h('th', { scope: 'col' }, '價格'),
        h('th', { scope: 'col' }, '距離'))),
      h('tbody', {}, ladder.rows.flatMap((item) => [
        h('tr', { class: item.current ? 'level-now' : '' },
          h('th', { scope: 'row' }, item.label),
          h('td', { class: 'num' }, formatLevel(item.price)),
          h('td', { class: 'num' }, item.current ? '—' : formatPct(item.distance))),
        h('tr', { class: 'level-note' }, h('td', { colspan: '3' }, item.note)),
      ]))),
    h('p', { class: 'hint' }, ladder.disclaimer));
}
