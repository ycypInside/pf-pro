import { tryGet } from '../api.js';
import { chartQuery } from '../bundle.js';
import { h, mount } from '../dom.js';
import { formatMoney, formatPct, formatQty, formatTwd } from '../format.js';
import { groupHoldings, joinHoldings, quoteTone, sortHoldings } from '../groups.js';
import { quoteMarks } from '../valuation.js';
import { formatLevel, levelLadder } from '../levels.js';
import { cardsForAsset, rulePriceLines, ruleTypeLabel } from '../p1.js';
import { paintChart, rangeMarker } from '../price-chart.js';

const SORTS = [['value', '市值'], ['change', '漲跌'], ['pl', '損益'], ['name', '名稱']];
let sortKey = 'value';
let groupMode = 'account';
const closedGroups = new Set();

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
        ? h('div', {}, groups.map(groupBlock))
        : h('p', { class: 'muted' }, '還沒有持倉。'));
  }

  function groupBlock(group) {
    const open = !closedGroups.has(group.id);
    const total = group.rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
    return h('section', {},
      h('button', {
        type: 'button',
        class: 'group-head',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => {
          if (open) closedGroups.add(group.id);
          else closedGroups.delete(group.id);
          draw();
        },
      },
      h('span', {}, `${open ? '▾' : '▸'} ${group.label}`),
      h('span', { class: 'num' }, formatTwd(total)),
      h('span', { class: 'muted group-sub' }, `${group.rows.length} 檔`)),
      open ? h('div', { class: 'group-body' }, group.rows.map(quoteRow)) : null);
  }

  function groupButton(mode, label) {
    return h('button', {
      type: 'button',
      'aria-selected': groupMode === mode ? 'true' : 'false',
      onClick: () => { groupMode = mode; draw(); },
    }, label);
  }
}

function quoted(text, stale) {
  return stale ? `估 ${text}` : text;
}

function quoteRow(row) {
  const tone = quoteTone(row.change_pct);
  const stale = row.is_stale;
  const marks = quoteMarks(row);
  const grey = stale || marks.pending;
  const toneClass = grey ? 'estimate num' : tone === 'up' ? 'tw-up num' : tone === 'down' ? 'tw-down num' : 'muted num';
  return h('button', {
    type: 'button',
    class: 'quote-row',
    onClick: () => openDetail(row),
  },
  h('span', { class: 'quote-top' },
    h('span', { class: 'quote-name' },
      h('strong', {}, row.name),
      stale ? h('span', { class: 'tag stale' }, '過期') : null,
      marks.badges.map((badge) => h('span', { class: `tag mini basis-${badge.id}` }, badge.label))),
    h('span', { class: toneClass }, quoted(formatPct(row.change_pct), stale))),
  h('span', { class: 'quote-sub' },
    h('span', { class: grey ? 'estimate' : 'muted' }, `${row.symbol} · ${quoted(formatMoney(row.price, row.currency), stale)}`),
    sparkline(row.spark, stale ? 'flat' : tone)),
  marks.pending ? h('span', { class: 'estimate quote-stale' }, `最後淨值 ${marks.date || '—'}`) : null,
  !marks.pending && !stale && marks.date ? h('span', { class: 'muted quote-stale' }, `價格 ${marks.date}`) : null,
  stale ? h('span', { class: 'muted quote-stale' }, `價格 ${row.price_date || '—'} · 上限 ${row.stale_limit_days == null ? '—' : row.stale_limit_days} 天`) : null,
  h('span', { class: 'quote-metrics' },
    metric('成本', formatTwd(row.cost)),
    metric('市值', quoted(formatTwd(row.value), stale), grey ? 'stale' : ''),
    metric('損益', quoted(formatPct(row.pl_pct), stale), stale ? 'stale' : tone),
    metric('比重', formatPct(row.weight).replace('+', ''))));
}

function metric(label, value, tone) {
  const klass = tone === 'up' ? 'tw-up' : tone === 'down' ? 'tw-down' : tone === 'stale' ? 'estimate' : '';
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
  const [result, cardsResult] = await Promise.all([
    tryGet('chart', chartQuery(row)),
    tryGet('holding_cards'),
  ]);
  body.replaceChildren();
  if (!result.ok) {
    body.append(h('p', { class: 'muted' }, '讀不到這檔走勢。'));
    return;
  }
  const data = result.data;
  const cards = cardsResult.ok ? cardsForAsset(cardsResult.data.cards, row.asset_id) : [];
  data.rule_lines = rulePriceLines(cards);
  let mode = 'line';
  const canvas = h('canvas', { class: 'price-canvas', role: 'img', 'aria-label': `${row.name} 走勢` });
  const tools = h('div', { class: 'seg two', role: 'tablist', 'aria-label': '圖形' },
    chartButton('line', '折線'),
    chartButton('candle', 'K 線'));
  const range = rangeMarker(data.levels, data.rows && data.rows.length ? data.rows[data.rows.length - 1].c : row.price);
  mount(body,
    h('p', { class: 'muted' }, `${data.symbol || row.symbol} · ${formatQty(row.quantity)}`),
    data.source === 'stored' ? h('p', { class: 'hint' }, '價格來源：已儲存淨值') : null,
    tools,
    canvas,
    h('p', { class: 'legend' },
      h('span', {}, h('i', { class: 'swatch', style: 'background:#1d6b4f' }), '價格'),
      h('span', {}, h('i', { class: 'swatch', style: 'background:#8a5a12' }), 'MA20'),
      h('span', {}, h('i', { class: 'swatch', style: 'background:#1f2a5c' }), 'MA60'),
      data.rule_lines.length ? h('span', {}, h('i', { class: 'swatch', style: 'background:#9c4036' }), '規則價位') : null),
    range ? h('div', {},
      h('p', { class: 'muted' }, `52 週 ${formatMoney(range.low, row.currency)} – ${formatMoney(range.high, row.currency)}`),
      h('div', { class: 'alloc-track' }, h('span', { class: 'alloc-target', style: `left:${range.left}` }))) : null,
    levelsSection(data),
    rulesSection(cards));
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

function rulesSection(cards) {
  if (!cards.length) return null;
  return h('section', { class: 'levels' },
    h('h3', {}, '持股卡'),
    cards.map((card) => h('div', {},
      h('p', { class: 'level-summary' }, card.name || card.card_key),
      card.note ? h('p', { class: 'hint' }, card.note) : null,
      (card.rules || []).filter((rule) => !rule.status || rule.status === 'active').map((rule) => h('article', { class: 'rule' },
        h('p', {}, rule.action || rule.rule_key || '規則'),
        rule.reason ? h('p', { class: 'muted' }, rule.reason) : null,
        h('p', { class: 'hint' }, ruleMeta(rule)))))),
    h('p', { class: 'hint' }, '紅虛線是這張卡的價位。檢討用，不是操作單。'));
}

function ruleMeta(rule) {
  const bits = [];
  const level = Number(rule.level);
  if (Number.isFinite(level)) bits.push(`價位 ${formatLevel(level)}`);
  const pct = Number(rule.pct);
  if (rule.pct !== '' && rule.pct != null && Number.isFinite(pct)) bits.push(`門檻 ${pct}%`);
  if (rule.date) bits.push(rule.date);
  const type = ruleTypeLabel(rule.type);
  if (type) bits.push(type);
  return bits.join(' · ');
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
