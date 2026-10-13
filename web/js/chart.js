const NS = 'http://www.w3.org/2000/svg';

function el(tag, props, ...kids) {
  const node = document.createElementNS(NS, tag);
  Object.entries(props || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    node.setAttribute(key, String(value));
  });
  kids.flat().forEach((kid) => {
    if (kid == null || kid === false) return;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  });
  return node;
}

function tick(value, percent) {
  if (percent) return `${(Number(value) * 100).toFixed(0)}%`;
  return Number(value).toFixed(2);
}

export function lineChart(series, options = {}) {
  const width = 320;
  const height = options.height || 168;
  const pad = { l: 32, r: 8, t: 12, b: 20 };
  const dates = [];
  series.forEach((item) => item.points.forEach((point) => {
    const y = Number(point.y);
    if (!Number.isFinite(y)) return;
    if (!dates.includes(point.date)) dates.push(point.date);
  }));
  dates.sort();
  if (dates.length < 2) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = '資料點不足，還畫不出曲線。';
    return note;
  }
  let min = Infinity;
  let max = -Infinity;
  series.forEach((item) => item.points.forEach((point) => {
    const y = Number(point.y);
    if (!Number.isFinite(y)) return;
    if (y < min) min = y;
    if (y > max) max = y;
  }));
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min || 1;
  const xOf = (date) => pad.l + (dates.indexOf(date) / (dates.length - 1)) * (width - pad.l - pad.r);
  const yOf = (value) => pad.t + (1 - (Number(value) - min) / span) * (height - pad.t - pad.b);
  const ticks = [max, (max + min) / 2, min];
  const lines = series.map((item) => {
    const points = item.points
      .filter((point) => Number.isFinite(Number(point.y)))
      .map((point) => `${xOf(point.date).toFixed(1)},${yOf(point.y).toFixed(1)}`)
      .join(' ');
    return el('polyline', { points, fill: 'none', stroke: item.color, 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  });
  const caption = options.label || '走勢';
  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': caption },
    el('title', {}, caption),
    ticks.map((value) => el('line', { x1: pad.l, x2: width - pad.r, y1: yOf(value), y2: yOf(value), stroke: '#e4d8c6' })),
    lines,
    ticks.map((value) => el('text', { x: 0, y: yOf(value) + 3, fill: '#667069', 'font-size': '9' }, tick(value, options.percent))),
    el('text', { x: pad.l, y: height - 4, fill: '#667069', 'font-size': '9' }, dates[0].slice(5)),
    el('text', { x: width - pad.r, y: height - 4, fill: '#667069', 'font-size': '9', 'text-anchor': 'end' }, dates[dates.length - 1].slice(5)));
  const wrap = document.createElement('div');
  const legend = document.createElement('div');
  legend.className = 'legend';
  series.forEach((item) => {
    const bit = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.className = 'swatch';
    swatch.style.background = item.color;
    bit.append(swatch, document.createTextNode(item.name));
    legend.append(bit);
  });
  wrap.append(svg, legend);
  return wrap;
}
