/** Canvas chart for one holding. Taiwan colors: red up, green down. */

const UP = '#9c4036';
const DOWN = '#1d6b4f';
const MA20 = '#8a5a12';
const MA60 = '#1f2a5c';
const GRID = '#e4d8c6';
const INK = '#667069';

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function collect(payload) {
  const rows = (payload && payload.rows) || [];
  const levels = (payload && payload.levels) || {};
  const extras = [];
  for (const band of [levels.resistance, levels.support]) {
    for (const item of band || []) {
      const price = finite(item && (item.price != null ? item.price : item));
      if (price != null) extras.push(price);
    }
  }
  const pivot = levels.pivot || {};
  for (const key of ['p', 'r1', 's1']) {
    const price = finite(pivot[key]);
    if (price != null) extras.push(price);
  }
  return { rows, extras, levels };
}

export function paintChart(canvas, payload, mode) {
  const { rows, extras } = collect(payload);
  if (!canvas || !rows.length) return false;
  const width = Math.max(280, canvas.clientWidth || 320);
  const height = 220;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = '100%';
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const pad = { l: 44, r: 8, t: 12, b: 22 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const values = [];
  rows.forEach((row, index) => {
    for (const key of ['h', 'l', 'c', 'o']) {
      const n = finite(row[key]);
      if (n != null) values.push(n);
    }
    const ma20 = finite(payload.ma20 && payload.ma20[index]);
    const ma60 = finite(payload.ma60 && payload.ma60[index]);
    if (ma20 != null) values.push(ma20);
    if (ma60 != null) values.push(ma60);
  });
  values.push(...extras);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min || 1;
  const xOf = (index) => pad.l + (rows.length === 1 ? plotW / 2 : (index / (rows.length - 1)) * plotW);
  const yOf = (value) => pad.t + (1 - (value - min) / span) * plotH;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  [max, (max + min) / 2, min].forEach((value) => {
    const y = yOf(value);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(value.toFixed(2), 0, y + 3);
  });
  const levels = payload.levels || {};
  const lines = [];
  for (const item of levels.resistance || []) lines.push(finite(item.price != null ? item.price : item));
  for (const item of levels.support || []) lines.push(finite(item.price != null ? item.price : item));
  const pivot = levels.pivot || {};
  lines.push(finite(pivot.p), finite(pivot.r1), finite(pivot.s1));
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = INK;
  lines.forEach((price) => {
    if (price == null) return;
    const y = yOf(price);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
  });
  ctx.restore();
  function strokeSeries(series, color) {
    ctx.beginPath();
    let started = false;
    series.forEach((value, index) => {
      const n = finite(value);
      if (n == null) {
        started = false;
        return;
      }
      const x = xOf(index);
      const y = yOf(n);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  if (mode === 'candle') {
    const slot = plotW / Math.max(rows.length, 1);
    const body = Math.max(2, slot * 0.6);
    rows.forEach((row, index) => {
      const open = finite(row.o);
      const close = finite(row.c);
      const high = finite(row.h);
      const low = finite(row.l);
      if (close == null) return;
      const up = close >= (open == null ? close : open);
      ctx.strokeStyle = up ? UP : DOWN;
      ctx.fillStyle = up ? UP : DOWN;
      const x = xOf(index);
      if (high != null && low != null) {
        ctx.beginPath();
        ctx.moveTo(x, yOf(high));
        ctx.lineTo(x, yOf(low));
        ctx.stroke();
      }
      const top = yOf(Math.max(open == null ? close : open, close));
      const bottom = yOf(Math.min(open == null ? close : open, close));
      ctx.fillRect(x - body / 2, top, body, Math.max(1, bottom - top));
    });
  } else {
    strokeSeries(rows.map((row) => row.c), DOWN);
  }
  if (payload.ma20) strokeSeries(payload.ma20, MA20);
  if (payload.ma60) strokeSeries(payload.ma60, MA60);
  ctx.fillStyle = INK;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(rows[0].d || '').slice(5), pad.l, height - 6);
  ctx.textAlign = 'right';
  ctx.fillText(String(rows[rows.length - 1].d || '').slice(5), width - pad.r, height - 6);
  return true;
}

export function rangeMarker(levels, last) {
  const low = finite(levels && levels.low_52w);
  const high = finite(levels && levels.high_52w);
  const price = finite(last);
  if (low == null || high == null || price == null || high <= low) return null;
  const t = Math.min(1, Math.max(0, (price - low) / (high - low)));
  return { low, high, price, left: `${t * 100}%` };
}
