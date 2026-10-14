import { clear, h, icon } from './dom.js';
import { renderAllocation } from './pages/allocation.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderEntry } from './pages/entry.js';
import { renderPlan } from './pages/plan.js';
import { renderPerformance } from './pages/performance.js';
import { renderRecords } from './pages/records.js';
import { renderSettings } from './pages/settings.js';

const PAGES = {
  overview: { title: '總覽', render: renderDashboard, icon: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z' },
  plan: { title: '計畫', render: renderPlan, icon: 'M4 16l4-5 3 3 6-8M5 19h14' },
  performance: { title: '績效', render: renderPerformance, icon: 'M4 19V5M4 19h16M8 15l3.2-4 2.6 2.4L18 8' },
  allocation: { title: '配置', render: renderAllocation, icon: 'M12 5a7 7 0 1 0 .01 0M12 12V5M12 12l5 3' },
  entry: { title: '記帳', render: renderEntry, icon: 'M12 5v14M5 12h14' },
  records: { title: '明細', render: renderRecords, icon: 'M8 7h11M8 12h11M8 17h11M5 7h.01M5 12h.01M5 17h.01' },
  settings: { title: '設定', render: renderSettings, icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM12 3.5v2.2M12 18.3v2.2M4.8 6.2l1.6 1.6M17.6 16.2l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.8 17.8l1.6-1.6M17.6 7.8l1.6-1.6' },
};

let generation = 0;

function parseRoute(hash) {
  const raw = (hash || '#/overview').replace(/^#\/?/, '');
  const qIndex = raw.indexOf('?');
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const queryText = qIndex === -1 ? '' : raw.slice(qIndex + 1);
  const namePart = path.split('/')[0];
  const name = PAGES[namePart] ? namePart : 'overview';
  const query = {};
  for (const [key, value] of new URLSearchParams(queryText)) query[key] = value;
  return { name, query };
}

function hashFor(name, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `#/${name}${qs ? `?${qs}` : ''}`;
}

function samePlace(a, b) {
  const keys = new Set([...Object.keys(a.query), ...Object.keys(b.query)]);
  for (const key of keys) if ((a.query[key] || '') !== (b.query[key] || '')) return false;
  return a.name === b.name;
}

function go(name, query) {
  const next = hashFor(name, query);
  if (samePlace(parseRoute(location.hash), parseRoute(next))) render();
  else location.hash = next;
}

function syncOffline() {
  const app = document.querySelector('#app');
  if (!app) return;
  const existing = app.querySelector(':scope > .offline');
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!offline) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;
  app.prepend(h('p', { class: 'offline', role: 'status' }, '目前沒有網路。畫面可能不是最新的。'));
}

function render() {
  const gen = ++generation;
  const { name, query } = parseRoute(location.hash);
  const page = PAGES[name];
  document.title = `${page.title} · 帳簿`;
  const app = document.querySelector('#app');
  clear(app);
  const main = h('main', { id: 'main', class: 'main' });
  app.append(
    h('header', { class: 'top' },
      h('div', { class: 'top-row' },
        h('p', { class: 'brand' }, h('span', { class: 'chop', 'aria-hidden': 'true' }, '帳'), '帳簿'),
        h('button', { type: 'button', class: 'text-btn', onClick: () => render() }, '重新整理')),
      h('h1', {}, page.title)),
    main,
    h('nav', { class: 'nav', 'aria-label': '主要' },
      Object.entries(PAGES).map(([key, item]) => h('a', {
        href: `#/${key}`,
        class: key === name ? 'on' : '',
        'aria-current': key === name ? 'page' : false,
      }, icon(item.icon), h('span', {}, item.title)))));
  syncOffline();
  page.render(main, { go, reload: render, alive: () => gen === generation, query });
}

function boot() {
  window.addEventListener('hashchange', render);
  window.addEventListener('online', syncOffline);
  window.addEventListener('offline', syncOffline);
  if (!location.hash) history.replaceState(null, '', '#/overview');
  render();
}

boot();
