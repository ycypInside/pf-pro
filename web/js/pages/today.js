import { h } from '../dom.js';

const TONE_LABEL = { green: '綠燈', yellow: '黃燈', red: '紅燈', unknown: '沒有資料' };

export function todayCard(model) {
  if (!model || model.pending) {
    return h('section', { class: 'today', 'aria-busy': 'true' },
      h('h2', {}, '今日行動'),
      h('p', { class: 'muted' }, '讀取中…'));
  }
  const panel = h('div', { class: 'light-panel' });
  panel.hidden = true;
  const buttons = (model.lights || []).map((light) => {
    const button = h('button', {
      type: 'button',
      class: `light tone-${light.tone}`,
      'aria-pressed': 'false',
      'aria-label': `${light.label}，${TONE_LABEL[light.tone] || light.tone}`,
    },
    h('span', { class: `dot ${light.tone}`, 'aria-hidden': 'true' }),
    h('span', {}, light.label));
    button.addEventListener('click', () => toggle(light, button));
    return button;
  });

  function toggle(light, button) {
    const open = button.getAttribute('aria-pressed') === 'true';
    for (const item of buttons) item.setAttribute('aria-pressed', 'false');
    if (open) {
      panel.hidden = true;
      panel.replaceChildren();
      return;
    }
    button.setAttribute('aria-pressed', 'true');
    panel.hidden = false;
    panel.replaceChildren(
      h('p', { class: 'light-panel-title' }, light.label),
      ...light.lines.map((line) => h('p', {}, line)));
  }

  return h('section', { class: 'today', 'data-display-only': 'true', 'aria-labelledby': 'today-title' },
    banner(model.banner),
    h('h2', { id: 'today-title' }, '今日行動'),
    h('p', { class: 'eyebrow' }, '今天要不要動手？'),
    h('p', { class: `today-verdict tone-${model.tone}` }, model.headline),
    h('div', { class: 'today-reasons' }, (model.reasons || []).map((reason) => h('a', {
      href: '#/overview',
      onClick: (event) => jump(event, reason.section),
    }, reason.text))),
    h('div', { class: 'lights', role: 'group', 'aria-label': '限額燈號' }, buttons),
    panel,
    model.paper && model.paper.length
      ? h('p', { class: 'paper-note' }, `紙上倉：${model.paper.join('、')}。不計入今日行動。`)
      : null,
    h('p', { class: 'hint' }, '只顯示判斷，不是買賣指示。'));
}

export function todayExtraSections(model) {
  return [
    detailSection('sec-allocation', '配置帶', lightOf(model, 'band')),
    detailSection('sec-cash', '現金煞車', lightOf(model, 'cash')),
    detailSection('sec-pegatron', '4938 財報前', lightOf(model, 'window')),
  ];
}

export function lightSummary(model, id) {
  const light = lightOf(model, id);
  if (!light || !light.lines.length) return null;
  return h('ul', { class: 'plain today-lines' }, light.lines.map((line) => h('li', {}, line)));
}

function lightOf(model, id) {
  return model && (model.lights || []).find((item) => item.id === id);
}

function detailSection(id, title, light) {
  const lines = light && light.lines.length ? light.lines : ['讀不到這一段。'];
  return h('section', { class: 'card', id },
    h('h2', {}, title),
    h('ul', { class: 'plain today-lines' }, lines.map((line) => h('li', {}, line))));
}

function banner(item) {
  if (!item) return null;
  const stale = item.kind !== 'error';
  return h('div', {
    class: stale ? 'banner dup stale' : 'banner err',
    role: stale ? 'status' : 'alert',
  },
  h('strong', {}, item.title),
  h('p', {}, item.text));
}

function jump(event, id) {
  event.preventDefault();
  const node = document.getElementById(id);
  if (!node) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
