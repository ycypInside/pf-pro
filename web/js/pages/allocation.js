import { hasConfig, tryGet } from '../api.js';
import { h } from '../dom.js';
import { formatPct, formatTwd } from '../format.js';
import { explainError } from '../money.js';

export async function renderAllocation(main, ctx) {
  if (!hasConfig()) {
    main.append(h('div', { class: 'stack' },
      h('p', { class: 'lede' }, '尚未設定連線。網址與權杖只會留在這台瀏覽器。'),
      h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.go('settings') }, '前往設定')));
    return;
  }
  main.append(h('p', { class: 'muted' }, '讀取中…'));
  const result = await tryGet('allocation');
  if (!ctx.alive()) return;
  main.replaceChildren();
  if (!result.ok) {
    main.append(h('div', { class: 'banner err', role: 'alert' },
      h('strong', {}, '讀不到配置'),
      h('p', {}, explainError(result.error && result.error.message))));
    return;
  }
  const data = result.data;
  const rows = data.rows || [];
  const alerts = rows.filter((row) => row.alert);
  mount(main,
    valuationTags(data),
    data.target_set
      ? null
      : h('div', { class: 'banner dup', role: 'status' },
        h('strong', {}, '尚未設定目標'),
        h('p', {}, '先用股票 60%、債券 20%、現金 20%，再平衡帶 5 個百分點。可在 Settings 寫入 target_allocation 與 rebalance_band_pct。')),
    h('section', { class: 'hero' },
      h('p', { class: 'eyebrow' }, '可投資資產 · 台幣'),
      h('p', { class: 'net num' }, formatTwd(data.total_twd)),
      h('p', { class: 'muted' }, alerts.length ? `${alerts.length} 類超出 ±${data.band_pct}%` : '都在再平衡區間內')),
    h('section', { class: 'card' },
      h('h2', {}, '實際與目標'),
      h('p', { class: 'muted' }, '長條是實際比重，直條是目標。'),
      rows.length ? h('div', {}, rows.map(allocRow)) : h('p', { class: 'muted' }, '還沒有部位或現金。')),
    h('section', { class: 'card' },
      h('h2', {}, '再平衡'),
      alerts.length
        ? h('ul', { class: 'plain' }, alerts.map((row) => h('li', {}, suggestion(row))))
        : h('p', { class: 'muted' }, '不需要調整。')),
    (data.estimated || []).length
      ? h('div', { class: 'banner dup', role: 'status' }, h('p', {}, `${data.estimated.join('、')} 缺少市價，這次先用成本。`))
      : null,
    (data.missing_fx || []).length
      ? h('div', { class: 'banner dup', role: 'status' }, h('p', {}, `${data.missing_fx.join('、')} 缺匯率，未計入配置。`))
      : null);
}

function mount(parent, ...nodes) {
  nodes.forEach((node) => { if (node) parent.append(node); });
}

function allocRow(row) {
  const actual = Math.max(0, Number(row.actual_weight) || 0);
  const target = Math.max(0, Number(row.target_weight) || 0);
  const scale = Math.max(actual, target, 0.01);
  return h('div', { class: 'alloc' },
    h('div', { class: 'alloc-top' },
      h('strong', {}, row.label || row.bucket),
      h('span', { class: 'num' }, formatPct(actual).replace('+', '')),
      row.alert ? h('span', { class: 'tag' }, '超出區間') : null),
    h('div', { class: 'alloc-track', title: `目標 ${formatPct(target)}` },
      h('span', { class: 'alloc-fill', style: `width:${Math.min(100, (actual / scale) * 100)}%` }),
      h('span', { class: 'alloc-target', style: `left:${Math.min(100, (target / scale) * 100)}%` })),
    h('p', { class: 'muted' }, `目標 ${formatPct(target).replace('+', '')} · ${formatTwd(row.actual_twd)}`));
}

function suggestion(row) {
  const points = (Math.abs(Number(row.drift) || 0) * 100).toFixed(1);
  const more = Number(row.trade_twd) >= 0;
  return `${row.label || row.bucket}${more ? '低於' : '高出'}目標 ${points} 個百分點，建議${more ? '增加' : '減少'} ${formatTwd(Math.abs(row.trade_twd))}`;
}

function valuationTags(data) {
  const tags = [];
  if (data.stale_count) tags.push(h('span', { class: 'tag' }, `${data.stale_count} 筆報價過期`));
  (data.last_valuations || []).forEach((row) => {
    const name = row.name || row.symbol;
    tags.push(h('span', { class: 'tag' }, row.date ? `${name} 最後估值 ${row.date}` : `${name} 沒有估值`));
  });
  return tags.length ? h('div', { class: 'tags' }, tags) : null;
}
