import { clear, h, icon } from './dom.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderEntry } from './pages/entry.js';
import { renderRecords } from './pages/records.js';
import { renderSettings } from './pages/settings.js';

const PAGES = {
  overview: { title: '總覽', render: renderDashboard, icon: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z' },
  entry: { title: '記帳', render: renderEntry, icon: 'M12 5v14M5 12h14' },
  records: { title: '明細', render: renderRecords, icon: 'M8 7h11M8 12h11M8 17h11M5 7h.01M5 12h.01M5 17h.01' },
  settings: { title: '設定', render: renderSettings, icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM12 3.5v2.2M12 18.3v2.2M4.8 6.2l1.6 1.6M17.6 16.2l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.8 17.8l1.6-1.6M17.6 7.8l1.6-1.6' },
};

let generation = 0;

function route() {
  const name = (location.hash || '#/overview').replace(/^#\/?/, '').split('/')[0];
  return PAGES[name] ? name : 'overview';
}

function go(name) {
  const next = `#/${name}`;
  if (location.hash === next) render();
  else location.hash = next;
}

function render() {
  const gen = ++generation;
  const name = route();
  const page = PAGES[name];
  document.title = `${page.title} · 帳簿`;
  const app = document.querySelector('#app');
  clear(app);
  const main = h('main', { id: 'main', class: 'main' });
  app.append(
    h('header', { class: 'top' },
      h('p', { class: 'brand' }, h('span', { class: 'chop', 'aria-hidden': 'true' }, '帳'), '帳簿'),
      h('h1', {}, page.title)),
    main,
    h('nav', { class: 'nav', 'aria-label': '主要' },
      Object.entries(PAGES).map(([key, item]) => h('a', {
        href: `#/${key}`,
        class: key === name ? 'on' : '',
        'aria-current': key === name ? 'page' : false,
      }, icon(item.icon), h('span', {}, item.title)))));
  page.render(main, { go, reload: render, alive: () => gen === generation });
}

function boot() {
  window.addEventListener('hashchange', render);
  if (!location.hash) history.replaceState(null, '', '#/overview');
  render();
}

boot();
