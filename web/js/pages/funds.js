import { hasConfig, loadConfig, tryGet } from '../api.js';
import { cacheKey, fetchBundle, freshnessNote, partsFromEnvelope, readCache, staleView } from '../bundle.js';
import { h, mount } from '../dom.js';
import { formatTwd } from '../format.js';
import { explainError, taipeiMonth } from '../money.js';
import { RESEARCH_FOOT, fundViews, weightText, weightWidth } from '../research.js';

export async function renderFunds(main, ctx) {
  if (!hasConfig()) {
    main.append(h('div', { class: 'stack' },
      h('p', { class: 'lede' }, '尚未設定連線。網址與權杖只會留在這台瀏覽器。'),
      h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.go('settings') }, '前往設定')));
    return;
  }
  const month = taipeiMonth();
  const names = ['fund_composition'];
  const stored = readCache(cacheKey('bundle', names, month));
  if (stored) paint(partsFromEnvelope(stored.body, names), staleView(stored.savedAt));
  else main.append(h('p', { class: 'muted' }, '讀取中…'));
  const loaded = await fetchBundle(tryGet, names, {}, { month, token: loadConfig().token });
  if (!ctx.alive()) return;
  paint(loaded.parts, null);

  function paint(parts, meta) {
    const result = parts.fund_composition;
    main.replaceChildren();
    if (!result || !result.ok) {
      mount(main,
        h('section', { class: 'card' },
          h('h2', {}, '基金成分'),
          h('p', { class: 'muted' }, explainError(result && result.error && result.error.message))),
        foot());
      return;
    }
    const view = fundViews(result.data);
    const head = [view.fileDate ? `檔案日 ${view.fileDate}` : '', view.sourceNote].filter(Boolean).join(' · ');
    mount(main,
      freshnessNote(meta),
      h('section', { class: 'card' },
        h('h2', {}, '基金成分'),
        head ? h('p', { class: 'muted' }, head) : null,
        view.funds.length
          ? view.funds.map((fund, index) => fundCard(fund, index === 0))
          : h('p', { class: 'muted' }, '還沒有基金成分。')),
      lookthroughSection(view),
      crossSection(view),
      foot());
  }
}

function foot() {
  return h('p', { class: 'research-foot' }, RESEARCH_FOOT);
}

function fundCard(fund, open) {
  return h('details', { class: 'fund-card', open: open || false },
    h('summary', {},
      h('span', { class: 'fund-name' }, fund.name),
      h('span', { class: 'tag' }, fund.typeLabel)),
    h('p', {}, `持有 ${fund.held == null ? '—' : formatTwd(fund.held)}`),
    dateLine(fund),
    fund.top10.length ? h('div', {}, h('h3', {}, '前十大'), fund.top10.map(topRow)) : null,
    barList('產業', fund.sectors),
    barList('地區', fund.regions),
    fund.href
      ? h('p', {}, h('a', { href: fund.href, target: '_blank', rel: 'noopener noreferrer' }, '資料來源'))
      : null);
}

function dateLine(fund) {
  const bits = [];
  if (fund.dataDate) bits.push(`資料日 ${fund.dataDate}`);
  if (fund.sectorsDate) bits.push(`產業日 ${fund.sectorsDate}`);
  if (fund.regionsDate) bits.push(`地區日 ${fund.regionsDate}`);
  return bits.length ? h('p', { class: 'muted' }, bits.join(' · ')) : null;
}

function topRow(row) {
  return h('div', { class: 'weight-row' },
    h('span', { class: 'muted' }, row.rank == null ? '' : String(row.rank)),
    h('span', { class: 'weight-name' },
      row.name || row.symbol || '—',
      row.held ? h('span', { class: 'tag' }, '直接持有') : null),
    h('span', {}, weightText(row.weight)),
    bar(row.weight));
}

function barList(title, rows) {
  if (!rows || !rows.length) return null;
  return h('div', {},
    h('h3', {}, title),
    rows.map((row) => h('div', { class: 'weight-row' },
      h('span', { class: 'weight-name' }, row.name || '—'),
      h('span', {}, weightText(row.weight)),
      bar(row.weight))));
}

function bar(weight) {
  return h('span', { class: 'weight-track', 'aria-hidden': 'true' },
    h('span', { class: 'weight-fill', style: `width:${weightWidth(weight)}%` }));
}

function lookthroughSection(view) {
  if (!view.lookthrough.length) return null;
  return h('section', { class: 'card' },
    h('h2', {}, '重疊曝險'),
    h('p', { class: 'hint' }, '估算（僅前十大）'),
    view.lookthrough.map((row) => h('details', { class: 'look-row' },
      h('summary', {}, `${row.name || row.symbol} 直接 ${money(row.direct)} + 透過基金 ${money(row.via)} = ${money(row.total)}`),
      row.funds.map((fund) => h('p', { class: 'muted' }, `${fund.name} ${weightText(fund.weight)} · ${money(fund.via)}`)))));
}

function crossSection(view) {
  if (!view.crossFund.length) return null;
  return h('section', { class: 'card' },
    h('h2', {}, '多檔基金共同持有'),
    view.crossFund.map((row) => h('article', { class: 'cross-row' },
      h('h3', {}, row.name || '—'),
      row.funds.map((fund) => h('p', {}, `${fund.name} ${weightText(fund.weight)}`)))));
}

function money(value) {
  return value == null ? '—' : formatTwd(value);
}
