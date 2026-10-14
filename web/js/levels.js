import { formatMoney } from './format.js';

/** Price ladder for the holding sheet. Considerations for most names; neutral copy for 4938. */

export const LEVEL_DISCLAIMER = '技術指標僅供參考，不構成投資建議';

const SUPPORT_KINDS = new Set(['support', 's1', 's2', 'low52']);
const RESIST_KINDS = new Set(['resistance', 'r1', 'r2', 'high52']);

const LABELS = {
  resistance: '壓力線',
  support: '支撐線',
  ma20: 'MA20',
  ma60: 'MA60',
  pivot: 'Pivot',
  r1: 'R1',
  r2: 'R2',
  s1: 'S1',
  s2: 'S2',
  high52: '52 週高',
  low52: '52 週低',
  current: '現價',
};

const NOTES = {
  trade: {
    resistance: '近期高點，接近時可考慮分批獲利、有效突破則可能轉為支撐',
    support: '近期低點，回測不破可考慮分批布局、跌破則考慮停損',
    ma20: '約一個月均價，短線多空分界',
    ma60: '季線，中期趨勢',
    pivot: '當日／短線參考價',
    r1: '樞軸第一壓力，接近時可考慮分批獲利、站上後可視為短線支撐',
    r2: '樞軸第二壓力，比第一檔更遠，接近時可考慮分批獲利',
    s1: '樞軸第一支撐，回測不破可考慮分批布局、跌破則考慮停損',
    s2: '樞軸第二支撐，比第一檔更遠，失守可考慮縮小部位',
    high52: '近一年高點，接近時可考慮分批獲利、有效突破則區間上移',
    low52: '近一年低點，守住可考慮分批布局、跌破則考慮停損',
    current: '最近收盤價，用來對照各價位的距離',
  },
  neutral: {
    resistance: '近期高點。價格接近時是上方參考，收在其上之後，此價常改為下方參考',
    support: '近期低點。價格接近時是下方參考，收在其下之後，此價常改為上方參考',
    ma20: '約一個月的平均價，用來對照短線位置',
    ma60: '約一季的平均價，用來對照中期位置',
    pivot: '由前一根Ｋ線的高、低、收計算出的短線參考價',
    r1: '由樞軸算出的第一道較高參考價',
    r2: '由樞軸算出的第二道較高參考價',
    s1: '由樞軸算出的第一道較低參考價',
    s2: '由樞軸算出的第二道較低參考價',
    high52: '近一年的最高價',
    low52: '近一年的最低價',
    current: '最近收盤價，用來對照各價位的距離',
  },
};

function finite(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function roundLevel(price) {
  const n = finite(price);
  if (n == null) return null;
  const digits = Math.abs(n) >= 1 ? 2 : 4;
  return Number(n.toFixed(digits));
}

export function formatLevel(price) {
  const n = roundLevel(price);
  if (n == null) return '—';
  const digits = Math.abs(n) >= 1 ? 2 : 4;
  return formatMoney(n, '', digits);
}

function samePrice(a, b) {
  return roundLevel(a) === roundLevel(b);
}

function lastClose(rows) {
  for (let i = (rows || []).length - 1; i >= 0; i -= 1) {
    const close = finite(rows[i] && rows[i].c);
    if (close != null) return close;
  }
  return null;
}

function lastOf(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const n = finite(series[i]);
    if (n != null) return n;
  }
  return null;
}

function sma(rows, length) {
  if (!rows || rows.length < length) return null;
  let sum = 0;
  for (let i = rows.length - length; i < rows.length; i += 1) {
    const close = finite(rows[i] && rows[i].c);
    if (close == null) return null;
    sum += close;
  }
  return sum / length;
}

function swings(rows, last) {
  const resistance = [];
  const support = [];
  const n = rows.length;
  const from = Math.max(2, n - 120);
  for (let i = from; i < n - 2; i += 1) {
    const high = finite(rows[i].h);
    const low = finite(rows[i].l);
    let isHigh = high != null;
    let isLow = low != null;
    for (let k = i - 2; k <= i + 2; k += 1) {
      if (k === i) continue;
      if (high == null || !(finite(rows[k].h) < high)) isHigh = false;
      if (low == null || !(finite(rows[k].l) > low)) isLow = false;
    }
    if (isHigh && high > last) resistance.push({ price: high, d: rows[i].d });
    if (isLow && low < last) support.push({ price: low, d: rows[i].d });
  }
  resistance.sort((a, b) => a.price - b.price);
  support.sort((a, b) => b.price - a.price);
  return { resistance: resistance.slice(0, 3), support: support.slice(0, 3) };
}

function listed(levels, key) {
  const value = levels && levels[key];
  if (!Array.isArray(value) || !value.length) return null;
  return value;
}

function previousBar(rows) {
  if (!rows.length) return null;
  const prev = rows.length > 1 ? rows[rows.length - 2] : rows[rows.length - 1];
  const high = finite(prev.h);
  const low = finite(prev.l);
  const close = finite(prev.c);
  if (high == null || low == null || close == null) return null;
  return { high, low, close };
}

function extreme(rows, key) {
  let best = null;
  for (const row of rows) {
    const n = finite(row && row[key]);
    if (n == null) continue;
    if (best == null) best = n;
    else best = key === 'l' ? Math.min(best, n) : Math.max(best, n);
  }
  return best;
}

function pegatron(payload) {
  const symbol = String((payload && (payload.symbol || payload.asset_id)) || '').replace(/\.TW$/i, '');
  return symbol === '4938';
}

function nearest(rows, kinds, side, last) {
  let best = null;
  for (const row of rows) {
    if (!kinds.has(row.kind)) continue;
    if (side === 'below' ? !(row.price < last) : !(row.price > last)) continue;
    if (!best || (side === 'below' ? row.price > best.price : row.price < best.price)) best = row;
  }
  return best;
}

function sittingOn(rows, kinds, last) {
  return rows.find((row) => kinds.has(row.kind) && samePrice(row.price, last)) || null;
}

function summarize(rows, last, neutral) {
  const below = nearest(rows, SUPPORT_KINDS, 'below', last);
  const above = nearest(rows, RESIST_KINDS, 'above', last);
  const onSupport = sittingOn(rows, SUPPORT_KINDS, last);
  const onResist = sittingOn(rows, RESIST_KINDS, last);
  const ma = rows.find((row) => row.kind === 'ma20');
  let place;
  if (onSupport) {
    place = above
      ? `目前落在支撐 ${formatLevel(onSupport.price)}，上方壓力 ${formatLevel(above.price)}`
      : `目前落在支撐 ${formatLevel(onSupport.price)}`;
  } else if (onResist) {
    place = below
      ? `目前落在壓力 ${formatLevel(onResist.price)}，下方支撐 ${formatLevel(below.price)}`
      : `目前落在壓力 ${formatLevel(onResist.price)}`;
  } else if (below && above) {
    place = `目前位於支撐 ${formatLevel(below.price)} 與壓力 ${formatLevel(above.price)} 之間`;
  } else if (below) {
    place = `目前在支撐 ${formatLevel(below.price)} 之上，上方沒有列出的壓力`;
  } else if (above) {
    place = `目前在壓力 ${formatLevel(above.price)} 之下，下方沒有列出的支撐`;
  } else {
    place = '目前沒有鄰近的支撐或壓力';
  }
  if (!ma) return place;
  let relation;
  if (samePrice(last, ma.price)) relation = neutral ? '價格接近 MA20' : '貼近 MA20';
  else if (last > ma.price) relation = neutral ? '價格高於 MA20' : '站上 MA20';
  else relation = neutral ? '價格低於 MA20' : '跌破 MA20';
  return `${place}，${relation}`;
}

export function levelLadder(payload) {
  const data = payload || {};
  const bars = Array.isArray(data.rows) ? data.rows : [];
  const levels = data.levels || {};
  const last = lastClose(bars);
  const neutral = pegatron(data);
  const voice = NOTES[neutral ? 'neutral' : 'trade'];
  const items = [];
  let order = 1;
  const add = (kind, price) => {
    const n = finite(price);
    if (n == null) return;
    items.push({
      kind,
      label: LABELS[kind],
      price: n,
      distance: last ? (n - last) / last : null,
      note: voice[kind],
      current: false,
      order,
    });
    order += 1;
  };

  const computedSwings = last != null ? swings(bars, last) : { resistance: [], support: [] };
  for (const item of listed(levels, 'resistance') || computedSwings.resistance) {
    add('resistance', item && item.price != null ? item.price : item);
  }
  for (const item of listed(levels, 'support') || computedSwings.support) {
    add('support', item && item.price != null ? item.price : item);
  }

  add('ma20', finite(levels.ma20) ?? lastOf(data.ma20) ?? sma(bars, 20));
  add('ma60', finite(levels.ma60) ?? lastOf(data.ma60) ?? sma(bars, 60));

  const prev = previousBar(bars);
  const given = levels.pivot || {};
  const pivot = finite(given.p) ?? (prev ? (prev.high + prev.low + prev.close) / 3 : null);
  add('pivot', pivot);
  add('r1', finite(given.r1) ?? (pivot != null && prev ? 2 * pivot - prev.low : null));
  add('s1', finite(given.s1) ?? (pivot != null && prev ? 2 * pivot - prev.high : null));
  add('r2', finite(given.r2) ?? (pivot != null && prev ? pivot + (prev.high - prev.low) : null));
  add('s2', finite(given.s2) ?? (pivot != null && prev ? pivot - (prev.high - prev.low) : null));
  add('high52', finite(levels.high_52w) ?? extreme(bars, 'h'));
  add('low52', finite(levels.low_52w) ?? extreme(bars, 'l'));

  if (last != null) {
    items.push({
      kind: 'current',
      label: LABELS.current,
      price: last,
      distance: 0,
      note: voice.current,
      current: true,
      order: 0,
    });
  }

  items.sort((a, b) => (b.price - a.price) || (a.order - b.order));
  return {
    neutral,
    last,
    summary: last == null ? '目前沒有足夠的價格可以計算價位' : summarize(items, last, neutral),
    disclaimer: LEVEL_DISCLAIMER,
    rows: items,
  };
}
