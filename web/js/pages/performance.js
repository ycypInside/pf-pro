import { hasConfig, tryGet } from '../api.js';
import { lineChart } from '../chart.js';
import { h } from '../dom.js';
import { formatPct, formatTwd } from '../format.js';
import { kindLabel } from '../labels.js';
import { benchmarkChunkOpen, explainError } from '../money.js';
import { createPoster, outcomeView } from '../submit.js';

let period = 'YTD';
let benchmark = '';
let flash = '';

const PERIODS = [['MTD', '本月'], ['YTD', '今年'], ['1Y', '一年'], ['ALL', '全部']];

export async function renderPerformance(main, ctx) {
  if (!hasConfig()) {
    main.append(needConfig(ctx));
    return;
  }
  main.append(h('p', { class: 'muted' }, '讀取中…'));
  const query = { period };
  if (benchmark) query.benchmark = benchmark;
  const result = await tryGet('performance', query);
  if (!ctx.alive()) return;
  main.replaceChildren();
  if (!result.ok) {
    main.append(h('div', { class: 'banner err', role: 'alert' },
      h('strong', {}, '讀不到績效'),
      h('p', {}, explainError(result.error && result.error.message))));
    return;
  }
  const data = result.data;
  const portfolio = data.portfolio || {};
  const pnl = portfolio.pnl || {};
  const external = portfolio.external || {};
  const draw = portfolio.max_drawdown;
  const bench = data.benchmark || {};
  const note = flash;
  flash = '';
  const status = h('div', {});
  const poster = createPoster('refresh_benchmarks');

  mount(main,
    h('div', { class: 'seg', role: 'tablist', 'aria-label': '期間' }, PERIODS.map(([id, label]) => h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': period === id ? 'true' : 'false',
      onClick: () => { period = id; ctx.reload(); },
    }, label))),
    note ? h('div', { class: 'banner ok', role: 'status' }, h('p', {}, note)) : null,
    valuationTags(data),
    h('div', { class: 'metrics' },
      metric('時間加權', formatPct(portfolio.twr), portfolio.twr),
      metric('金錢加權', formatPct(portfolio.xirr), portfolio.xirr),
      metric('最大回撤', formatPct(draw && draw.value), draw && draw.value),
      metric('投資淨值', formatTwd(portfolio.nav))),
    h('section', { class: 'card' },
      h('h2', {}, '淨值與指標'),
      h('p', { class: 'muted' }, data.method === 'snapshot'
        ? '時間加權用每日快照連結；中間缺日用 Modified Dietz。指數以期初為 1。'
        : '快照不足，這段報酬由交易與報價推算，再以 Modified Dietz 連結。'),
      picks(bench.available || [], bench.id, (id) => { benchmark = id; ctx.reload(); }),
      lineChart([
        { name: '投資組合', color: '#1d6b4f', points: (data.series || []).map((row) => ({ date: row.date, y: row.index })) },
        { name: bench.id || '指標', color: '#1f2a5c', points: (data.series || []).map((row) => ({ date: row.date, y: row.benchmark_index })) },
      ], { label: '淨值指數與指標' }),
      h('p', { class: 'muted' }, bench.twd_return === null || bench.twd_return === undefined
        ? '這個區間還沒有指標可以對照。'
        : `${bench.id} 同期台幣報酬 ${formatPct(bench.twd_return)}${bench.currency && bench.currency !== 'TWD' ? `（原幣 ${formatPct(bench.local_return)}）` : ''}`)),
    h('section', { class: 'card' },
      h('h2', {}, '回撤'),
      draw ? h('p', { class: 'muted' }, `${draw.peak_date} 高點到 ${draw.trough_date}`) : null,
      lineChart([
        { name: '自高點回撤', color: '#9c4036', points: (data.series || []).map((row) => ({ date: row.date, y: row.drawdown })) },
      ], { label: '回撤', percent: true, height: 120 })),
    h('section', { class: 'card' },
      h('h2', {}, '損益拆解'),
      h('p', { class: 'muted' }, '台幣。價格效果用期末匯率，匯率效果用持有成本的匯率。'),
      h('dl', { class: 'split' },
        stat('已實現價格', pnl.realized_price, true),
        stat('已實現匯率', pnl.realized_fx, true),
        stat('未實現價格', pnl.unrealized_price, true),
        stat('未實現匯率', pnl.unrealized_fx, true),
        stat('股息', pnl.dividends, true),
        stat('利息', pnl.interest, true),
        stat('現金費用', pnl.fees),
        stat('交易費用', pnl.trade_fees)),
      h('p', { class: 'muted' }, '交易費用已含在價差裡，不重複扣一次。')),
    h('section', { class: 'card' },
      h('h2', {}, '外部資金'),
      h('p', { class: 'muted' }, '本金進出不計入報酬。'),
      h('dl', { class: 'split' },
        stat('投入', external.contribution),
        stat('提出', external.withdrawal))),
    (data.warnings || []).length
      ? h('div', { class: 'banner dup', role: 'status' }, (data.warnings || []).map((item) => h('p', {}, item)))
      : null,
    section('帳戶', accountList(data.accounts || [])),
    section('持倉', holdingList(data.holdings || [])),
    h('button', {
      type: 'button',
      class: 'btn',
      onClick: async () => {
        status.replaceChildren(h('p', { class: 'muted' }, '正在補指標…'));
        let added = 0;
        let outcome = null;
        let guard = 0;
        while (guard < 40) {
          outcome = await poster.send({});
          if (!ctx.alive()) return;
          if (!outcome.res || !outcome.res.ok) break;
          const chunk = outcome.res.result || {};
          added += Number(chunk.added) || 0;
          const label = chunk.symbol ? `正在補 ${chunk.symbol}` : '正在補指標';
          const open = benchmarkChunkOpen(outcome.res);
          status.replaceChildren(h('p', { class: 'muted' }, open ? `${label}…` : '指標已更新'));
          if (!open) break;
          guard += 1;
        }
        if (outcome && outcome.res && outcome.res.ok) {
          const unfinished = benchmarkChunkOpen(outcome.res);
          flash = unfinished
            ? `指標還在補，這次新增 ${added} 筆。再按一次會接下去。`
            : `指標已更新，新增 ${added} 筆。`;
          ctx.reload();
          return;
        }
        status.replaceChildren(outcomeView(outcome, async () => {
          const retry = await poster.send();
          status.replaceChildren(outcomeView(retry));
        }));
      },
    }, '更新指標'),
    status);
}

function mount(parent, ...nodes) {
  nodes.forEach((node) => { if (node) parent.append(node); });
}

function needConfig(ctx) {
  return h('div', { class: 'stack' },
    h('p', { class: 'lede' }, '尚未設定連線。網址與權杖只會留在這台瀏覽器。'),
    h('button', { type: 'button', class: 'btn primary', onClick: () => ctx.go('settings') }, '前往設定'));
}

function metric(label, value, raw) {
  return h('article', { class: 'metric' },
    h('p', { class: 'k' }, label),
    h('p', { class: `v num ${tone(raw)}` }, value));
}

function stat(label, value, signed) {
  const n = Number(value);
  const shown = signed && Number.isFinite(n) && n > 0 ? `+${formatTwd(value)}` : formatTwd(value);
  return h('div', {}, h('dt', {}, label), h('dd', { class: `num ${signed ? tone(value) : ''}` }, shown));
}

function tone(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return n > 0 ? 'up' : 'down';
}

function picks(ids, current, onPick) {
  if (!ids.length) return null;
  return h('div', { class: 'tags' }, ids.map((id) => h('button', {
    type: 'button',
    class: 'text-btn',
    'aria-pressed': id === current ? 'true' : 'false',
    onClick: () => onPick(id),
  }, id)));
}

function valuationTags(data) {
  const tags = [];
  const stale = (data.holdings || []).filter((row) => row.is_stale).length;
  if (stale) tags.push(h('span', { class: 'tag' }, `${stale} 檔報價過期`));
  (data.last_valuations || []).forEach((row) => {
    const name = row.name || row.symbol;
    tags.push(h('span', { class: 'tag' }, row.date ? `${name} 最後估值 ${row.date}` : `${name} 沒有估值`));
  });
  return tags.length ? h('div', { class: 'tags' }, tags) : null;
}

function section(title, body) {
  return h('section', { class: 'card' }, h('h2', {}, title), body);
}

function accountList(rows) {
  if (!rows.length) return h('p', { class: 'muted' }, '還沒有投資帳戶。');
  return h('div', {}, rows.map((row) => h('article', { class: 'acct' },
    h('div', {},
      h('p', { class: 'acct-name' }, row.name || row.account_id),
      h('p', { class: 'muted' }, `時間加權 ${formatPct(row.twr)} · 金錢加權 ${formatPct(row.xirr)}`)),
    h('div', { class: 'acct-amt' },
      h('p', { class: 'num' }, formatTwd(row.nav)),
      h('p', { class: `num ${tone(row.max_drawdown)}` }, `回撤 ${formatPct(row.max_drawdown)}`)))));
}

function holdingList(rows) {
  if (!rows.length) return h('p', { class: 'muted' }, '這個區間沒有持倉。');
  return h('div', {}, rows.map((row) => h('article', { class: 'acct' },
    h('div', {},
      h('p', { class: 'acct-name' }, row.name || row.symbol || row.asset_id),
      h('p', { class: 'muted' }, [
        row.account_name || row.account_id,
        row.is_stale ? '報價過期' : '',
        row.price_kind === 'bond_valuation' && row.price_date ? `最後估值 ${row.price_date}` : (row.price_date ? row.price_date : ''),
        row.price_kind ? kindLabel(row.price_kind) : '',
      ].filter(Boolean).join(' · '))),
    h('div', { class: 'acct-amt' },
      h('p', { class: 'num' }, formatTwd(row.market_value_twd)),
      h('p', { class: `num ${tone(row.unrealized_pl_twd)}` }, `未實現 ${formatTwd(row.unrealized_pl_twd)}`),
      h('p', { class: 'muted' }, `價格 ${formatTwd(row.unrealized_price_twd)} · 匯率 ${formatTwd(row.unrealized_fx_twd)}`),
      h('p', { class: 'muted' }, `時間加權 ${formatPct(row.twr)} · 金錢加權 ${formatPct(row.xirr)}`)))));
}
