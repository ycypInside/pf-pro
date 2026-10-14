import { hasConfig, loadConfig, tryGet } from '../api.js';
import { cacheKey, fetchBundle, freshnessNote, partsFromEnvelope, readCache, staleView } from '../bundle.js';
import { lineChart } from '../chart.js';
import { h, mount } from '../dom.js';
import { formatMoney, formatPct, formatTwd } from '../format.js';
import { explainError, taipeiMonth } from '../money.js';
import {
  canMarkDebited,
  dcaRows,
  dcaStatusLine,
  debitDayLabel,
  monthStateLabel,
  pathProgress,
  planPoints,
  trackLabel,
  wanLabel,
  yiTrack,
} from '../p1.js';
import { createPoster, outcomeView } from '../submit.js';

const COLORS = ['#1d6b4f', '#1f2a5c', '#8a5a12'];

export async function renderPlan(main, ctx) {
  if (!hasConfig()) {
    main.append(h('div', { class: 'stack' },
      h('p', { class: 'lede' }, '尚未設定連線。網址與權杖只會留在這台瀏覽器。'),
      h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.go('settings') }, '前往設定')));
    return;
  }
  const month = taipeiMonth();
  const names = ['plan', 'dca'];
  const stored = readCache(cacheKey('bundle', names, month));
  if (stored) paint(partsFromEnvelope(stored.body, names), staleView(stored.savedAt));
  else main.append(h('p', { class: 'muted' }, '讀取中…'));
  const loaded = await fetchBundle(tryGet, names, {}, { month, token: loadConfig().token });
  if (!ctx.alive()) return;
  paint(loaded.parts, null);

  function paint(parts, meta) {
  const planR = parts.plan;
  const dcaR = parts.dca;
  main.replaceChildren();
  if (denied(planR) || denied(dcaR)) {
    main.append(
      h('div', { class: 'banner err', role: 'alert' },
        h('strong', {}, '權杖被拒絕'),
        h('p', {}, explainError('unauthorized'))),
      h('button', { type: 'button', class: 'btn', onClick: () => ctx.go('settings') }, '前往設定'));
    return;
  }
  mount(main, freshnessNote(meta), planSection(planR), dcaSection(dcaR));
  }
}

function denied(result) {
  return !!(result && !result.ok && result.error && result.error.payload && result.error.payload.error === 'unauthorized');
}

function planSection(result) {
  if (!result.ok) {
    return h('section', { class: 'card' },
      h('h2', {}, '淨值計畫'),
      h('p', { class: 'muted' }, explainError(result.error && result.error.message)));
  }
  const data = result.data || {};
  const tracks = data.tracks || [];
  const actual = Number(data.net_worth_twd);
  const series = tracks.map((track, index) => ({
    name: trackLabel(track),
    color: COLORS[index % COLORS.length],
    points: planPoints(track, data.as_of),
  })).filter((item) => item.points.length >= 2);
  const markers = Number.isFinite(actual) && data.as_of
    ? [{ name: '實際', color: '#9c4036', date: data.as_of, y: actual }]
    : [];
  return h('section', { class: 'card' },
    h('h2', {}, '淨值計畫'),
    pathNote(pathProgress(data)),
    yiNote(yiTrack(tracks)),
    data.note ? h('p', { class: 'hint' }, data.note) : null,
    series.length
      ? lineChart(series, { label: '計畫與實際淨值', compact: true, markers })
      : h('p', { class: 'muted' }, '資料點不足，還畫不出曲線。'),
    tracks.map(trackCard));
}

function pathNote(path) {
  if (!path) return h('p', { class: 'muted' }, '還沒有路徑 D。');
  const state = Number.isFinite(path.ratio) && path.ratio >= 1 ? '已超過第一年。' : '';
  return h('p', {}, `路徑 D 自 ${wanLabel(path.start)} 走向第一年 ${wanLabel(path.target)}，目前 ${wanLabel(path.actual)}。${state}`);
}

function yiNote(track) {
  if (!track) return null;
  return h('p', {}, `上億差距 ${formatTwd(track.gap_twd)}（${formatPct(track.gap_pct)}）`);
}

function trackCard(track) {
  const next = track.next_milestone;
  return h('article', { class: 'acct plan-track' },
    h('div', {},
      h('p', { class: 'acct-name' }, trackLabel(track)),
      h('p', { class: 'muted' }, `計畫 ${formatTwd(track.plan_now_twd)} · 實際 ${formatTwd(track.actual_twd)}`),
      h('p', {}, `差距 ${formatTwd(track.gap_twd)}（${formatPct(track.gap_pct)}）`),
      next
        ? h('p', { class: 'hint' }, `下一里程碑 ${next.year} 年 ${next.target_date} ${formatTwd(next.target_twd)}${next.note ? ` · ${next.note}` : ''}`)
        : h('p', { class: 'hint' }, '沒有後續里程碑')),
    h('div', { class: 'acct-amt' },
      h('span', { class: track.on_track ? 'tag dca-debited' : 'tag dca-paused_by_brake' }, track.on_track ? '超前' : '落後')));
}

function dcaSection(result) {
  const root = h('section', { class: 'card' });
  if (!result.ok) {
    root.append(
      h('h2', {}, '定額'),
      h('p', { class: 'muted' }, explainError(result.error && result.error.message)));
    return root;
  }
  const data = result.data || {};
  const items = dcaRows(data.items);
  const notice = h('div', {});
  const posters = new Map();
  draw();
  return root;

  function draw() {
    root.replaceChildren(
      h('h2', {}, '定額'),
      h('p', {}, dcaStatusLine(items)),
      data.note ? h('p', { class: 'hint' }, data.note) : null,
      brakeBanner(data.brake),
      notice,
      h('p', { class: 'muted' }, `${data.month || ''} 每月合計 ${formatTwd(data.monthly_total_twd)}`.trim()),
      items.length ? h('div', {}, items.map(dcaItem)) : h('p', { class: 'muted' }, '還沒有定額。'));
  }

  function dcaItem(item) {
    return h('div', { class: 'dca-item' },
      h('article', { class: 'acct' },
        h('div', {},
          h('p', { class: 'acct-name' }, item.name || item.symbol || item.dca_id),
          h('p', { class: 'muted' }, debitDayLabel(item.debit_day)),
          item.note ? h('p', { class: 'hint' }, item.note) : null),
        h('div', { class: 'acct-amt' },
          h('p', { class: 'num' }, formatMoney(item.amount, item.currency)),
          h('span', { class: `tag dca-${item.month_state || 'pending'}` }, monthStateLabel(item.month_state)),
          item.core ? h('span', { class: 'tag' }, '核心') : null)),
      canMarkDebited(item)
        ? h('button', {
          type: 'button',
          class: 'btn',
          onClick: (event) => {
            event.currentTarget.disabled = true;
            mark(item);
          },
        }, '標記已扣款')
        : null);
  }

  async function mark(item) {
    let poster = posters.get(item.dca_id);
    if (!poster) {
      poster = createPoster('mark_dca_debited');
      posters.set(item.dca_id, poster);
    }
    const outcome = await poster.send({ dca_id: item.dca_id, date: taipeiMonth().iso });
    notice.replaceChildren(outcomeView(outcome, () => mark(item)));
    if (outcome.res && outcome.res.ok) {
      item.month_state = 'debited';
      item.last_debit_date = taipeiMonth().iso;
    }
    draw();
  }
}

function brakeBanner(brake) {
  if (!brake || !brake.enabled) return null;
  if (brake.triggered) {
    return h('div', { class: 'banner err', role: 'status' },
      h('strong', {}, '現金煞車'),
      h('p', {}, brake.reason || '現金低於門檻，定額先暫停。'));
  }
  return h('div', { class: 'banner info', role: 'status' },
    h('strong', {}, '現金煞車'),
    h('p', {}, '煞車已啟用，目前未觸發。'));
}
