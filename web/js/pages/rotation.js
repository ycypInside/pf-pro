import { hasConfig, loadConfig, tryGet } from '../api.js';
import { cacheKey, fetchBundle, freshnessNote, partsFromEnvelope, readCache, staleView } from '../bundle.js';
import { writeCache } from '../swr.js';
import { h, mount } from '../dom.js';
import { explainError, taipeiMonth } from '../money.js';
import { renderMarkdown } from '../markdown.js';
import { RESEARCH_FOOT, rotationView, taipeiToday } from '../research.js';

export async function renderRotation(main, ctx) {
  if (!hasConfig()) {
    main.append(h('div', { class: 'stack' },
      h('p', { class: 'lede' }, '尚未設定連線。網址與權杖只會留在這台瀏覽器。'),
      h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.go('settings') }, '前往設定')));
    return;
  }
  const month = taipeiMonth();
  const names = ['stock_rotation'];
  const stored = readCache(cacheKey('bundle', names, month));
  let currentSymbol = '';
  if (stored) paint(partsFromEnvelope(stored.body, names), staleView(stored.savedAt));
  else main.append(h('p', { class: 'muted' }, '讀取中…'));
  const loaded = await fetchBundle(tryGet, names, {}, { month, token: loadConfig().token });
  if (!ctx.alive()) return;
  paint(loaded.parts, null);

  function paint(parts, meta) {
    const result = parts.stock_rotation;
    const reportHost = h('section', { class: 'card report-pane', hidden: true });
    main.replaceChildren();
    if (!result || !result.ok) {
      mount(main,
        h('section', { class: 'card' },
          h('h2', {}, '個股分析'),
          h('p', { class: 'muted' }, explainError(result && result.error && result.error.message))),
        foot());
      return;
    }
    const view = rotationView(result.data, taipeiToday());
    mount(main,
      freshnessNote(meta),
      h('section', { class: 'card' },
        h('h2', {}, '個股分析'),
        view.cadence ? h('p', { class: 'lede' }, view.cadence) : null,
        view.weeks.length
          ? h('div', { class: 'hscroll' }, rotationTable(view.weeks, (symbol) => openReport(symbol, reportHost)))
          : h('p', { class: 'muted' }, '還沒有輪動表。'),
        view.reports.length
          ? h('div', { class: 'report-list' },
            h('h3', {}, '報告'),
            view.reports.map((report) => h('button', {
              type: 'button',
              class: 'chip',
              onClick: () => openReport(report.symbol, reportHost),
            }, `${report.title} ${report.reportDate}`.trim())))
          : null),
      reportHost,
      foot());
    if (currentSymbol) openReport(currentSymbol, reportHost);
  }

  async function openReport(symbol, reportHost) {
    if (!symbol) return;
    currentSymbol = symbol;
    reportHost.hidden = false;
    const key = cacheKey('stock_report', [symbol], month);
    const storedReport = readCache(key);
    if (storedReport) showReport(reportHost, storedReport.body, staleView(storedReport.savedAt));
    else reportHost.replaceChildren(h('p', { class: 'muted' }, '讀取中…'));
    const result = await tryGet('stock_report', { symbol });
    if (!ctx.alive() || currentSymbol !== symbol) return;
    if (result.ok && result.data && result.data.ok !== false) {
      writeCache(key, result.data, undefined, loadConfig().token);
      showReport(reportHost, result.data, null);
      return;
    }
    const message = result.error && result.error.message;
    reportHost.replaceChildren(h('p', { class: 'muted' }, message === 'no report' ? '尚無報告' : explainError(message)));
  }
}

function foot() {
  return h('p', { class: 'research-foot' }, RESEARCH_FOOT);
}

function rotationTable(weeks, onPick) {
  return h('table', { class: 'rotation' },
    h('thead', {}, h('tr', {}, ['週', '市場', '代號', '名稱', '備註', '報告'].map((label) => h('th', {}, label)))),
    weeks.map((week) => h('tbody', {},
      h('tr', { class: 'rotation-week' }, h('th', { colspan: '6' }, weekRange(week))),
      week.rows.map((row) => h('tr', {
        class: row.highlight ? 'rotation-current' : '',
        tabIndex: 0,
        'data-symbol': row.symbol,
        onClick: () => onPick(row.symbol),
        onKeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onPick(row.symbol);
          }
        },
      },
      h('td', {}, weekRange(week)),
      h('td', {}, h('span', { class: 'tag' }, row.market)),
      h('td', {}, row.symbol || '—'),
      h('td', {}, row.name || '—'),
      h('td', {}, row.note || '—'),
      h('td', {}, row.hasReport ? (row.reportDate || '—') : '尚無報告'))))));
}

function weekRange(week) {
  if (week.weekStart && week.weekEnd) return `${week.weekStart}–${week.weekEnd}`;
  return week.weekStart || week.weekEnd || '—';
}

function showReport(host, data, meta) {
  const history = data.history_dates || [];
  host.hidden = false;
  host.replaceChildren();
  const body = h('div', { class: 'md' });
  body.innerHTML = renderMarkdown(data.md || '');
  mount(host,
    freshnessNote(meta),
    h('h2', {}, data.title || data.symbol || '報告'),
    data.report_date ? h('p', { class: 'muted' }, data.report_date) : null,
    data.complete === false ? h('p', { class: 'estimate' }, '報告不完整') : null,
    history.length ? h('p', { class: 'hint' }, `歷史 ${history.join('、')}`) : null,
    body);
}
