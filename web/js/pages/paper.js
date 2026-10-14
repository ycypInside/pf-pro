import { hasConfig, tryGet } from '../api.js';
import { lineChart } from '../chart.js';
import { h, mount } from '../dom.js';
import { formatQty, formatTwd } from '../format.js';
import { explainError } from '../money.js';
import { paperView } from '../p1.js';

const SLEEVE_COLOR = { A: '#1d6b4f', B: '#1f2a5c', C: '#8a5a12' };
const BENCH_COLOR = { '0050': '#9c4036', '00631L': '#5c3d73' };

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
  const view = paperView(result.ok ? result.data : null);
  mount(main,
    h('section', { class: 'card paper' },
      h('h2', {}, '紙上倉'),
      h('div', { class: 'banner info paper-banner', role: 'note' },
        h('strong', {}, '這是紙上倉，不是真實持倉'),
        h('p', {}, 'A／B／C 只在這頁對照 0050 與 00631L，不計入淨值與配置。')),
      h('p', { class: 'hint' }, view.note),
      view.stale ? h('p', { class: 'estimate' }, `估 ${view.staleNote}`) : null,
      result.ok ? null : h('p', { class: 'muted' }, result.error ? explainError(result.error.message) : '紙上倉資料還沒準備好。'),
      comparison(view),
      h('div', {}, view.sleeves.map(sleeveArticle))));
}

function comparison(view) {
  const series = [];
  for (const sleeve of view.sleeves) {
    const points = pointsOf(sleeve.series);
    if (points.length) series.push({ name: `${sleeve.stale ? '估 ' : ''}紙上倉 ${sleeve.sleeve}`, color: SLEEVE_COLOR[sleeve.sleeve], points });
  }
  for (const symbol of ['0050', '00631L']) {
    const bench = view.benchmarks[symbol];
    if (!bench) continue;
    const points = pointsOf(bench.series);
    if (points.length) series.push({ name: `${bench.stale ? '估 ' : ''}${symbol}`, color: BENCH_COLOR[symbol], points });
  }
  return h('div', { class: 'paper-compare' },
    h('h3', {}, '對照 0050、00631L'),
    series.length
      ? lineChart(series, { label: '紙上倉與 0050、00631L', height: 120 })
      : h('p', { class: 'muted' }, '還沒有可對照的報酬曲線。'));
}

function pointsOf(rows) {
  return (rows || [])
    .filter((row) => row && row.date && Number.isFinite(Number(row.return_pct)))
    .map((row) => ({ date: row.date, y: Number(row.return_pct) }));
}

function sleeveArticle(sleeve) {
  const positions = sleeve.positions || [];
  return h('article', { class: 'paper-sleeve' },
    h('h3', {}, sleeve.label || `紙上倉 ${sleeve.sleeve}`),
    h('p', { class: 'muted' }, [
      sleeve.asOf ? `截至 ${sleeve.asOf}` : '尚無結算日',
      sleeve.tradingDays ? ` · 交易日 ${sleeve.tradingDays}` : '',
    ].join('')),
    h('div', { class: 'paper-metrics' },
      metric('權益', money(sleeve.equity), sleeve.stale),
      metric('現金', money(sleeve.cash), sleeve.stale),
      metric('報酬', signed(sleeve.returnPct, '%'), sleeve.stale),
      metric('回撤', signed(sleeve.drawdownPct, '%'), sleeve.stale),
      metric('年化', signed(sleeve.annualizedPct, '%'), sleeve.stale),
      metric('對 0050', signed(sleeve.vs0050, ' 百分點'), sleeve.stale),
      metric('對 00631L', signed(sleeve.vs631, ' 百分點'), sleeve.stale)),
    gateList(sleeve),
    positions.length
      ? h('details', { class: 'paper-pos' },
        h('summary', {}, `部位 ${positions.length}`),
        positions.map(positionLine))
      : h('p', { class: 'muted' }, '尚無紙上部位'));
}

function gateList(sleeve) {
  const gate = sleeve.gate || { checks: [] };
  if (!sleeve.present) return null;
  const checks = gate.checks || [];
  return h('div', {},
    h('p', {}, `${gate.goLive ? '✓' : '✗'} ${gate.goLive ? '可以上線' : '還不能上線'}`),
    checks.length
      ? h('ul', { class: 'paper-checks' }, checks.map((check) => h('li', {},
        `${check.ok ? '✓' : '✗'} ${check.label}${check.current ? ` ${check.current}` : ''}`)))
      : h('p', { class: 'muted' }, '尚無門檻'));
}

function positionLine(row) {
  const name = row.name || row.code || '部位';
  return h('p', { class: 'paper-pos' },
    h('span', { class: 'tag' }, '紙上'),
    ` ${row.code ? `${row.code} ` : ''}${name}`,
    row.qty == null ? '' : ` · ${formatQty(row.qty)}`,
    Number.isFinite(Number(row.pnl_pct)) ? ` · ${signed(Number(row.pnl_pct), '%')}` : '');
}

function metric(label, value, stale) {
  return h('p', { class: stale ? 'estimate' : '' }, `${stale ? '估 ' : ''}${label} ${value}`);
}

function money(value) {
  return Number.isFinite(value) ? formatTwd(value) : '—';
}

function signed(value, suffix) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(2)}${suffix}`;
}
