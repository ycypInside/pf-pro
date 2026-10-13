function grouped(value, digits) {
  const abs = Math.abs(Number(value));
  const [whole, frac] = abs.toFixed(digits).split('.');
  const body = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return digits ? `${body}.${frac}` : body;
}

export function formatTwd(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}NT$${grouped(n, 2)}`;
}

export function formatMoney(value, currency, digits = 2) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}${grouped(n, digits)} ${currency || ''}`.trim();
}

export function formatQty(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const text = grouped(n, 4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return sign + text;
}

export function formatPct(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const pct = n * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${grouped(Math.abs(pct), 2)}%`;
}

export function formatRate(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return grouped(n, 4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
