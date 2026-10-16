import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ESTIMATE_NOTE,
  fxView,
  priceDateRange,
  quoteMarks,
  taipeiStamp,
  valuationFacts,
} from './valuation.js';

test('quote marks stay blank when the new fields are missing', () => {
  for (const row of [null, undefined, {}, { price_basis: 'nope', estimate: false, price_date: 1 }]) {
    const marks = quoteMarks(row);
    assert.equal(marks.basis, '');
    assert.equal(marks.date, '');
    assert.equal(marks.estimate, false);
    assert.equal(marks.pending, false);
    assert.deepEqual(marks.badges, []);
  }
  assert.equal(priceDateRange(null), '');
  assert.equal(priceDateRange([{ price_date: 'yesterday' }, {}]), '');
  const empty = valuationFacts();
  assert.equal(empty.dates, '');
  assert.equal(empty.estimate, false);
  assert.equal(empty.fx.rate, null);
  assert.equal(empty.fx.asOf, '');
  assert.equal(empty.fx.source, '');
});

test('each price basis badge is independent of a missing estimate flag', () => {
  assert.deepEqual(quoteMarks({ price_basis: 'close', price_date: '2026-10-14' }).badges, []);
  assert.deepEqual(quoteMarks({ price_basis: 'intraday', price_date: '2026-10-14' }).badges, [
    { id: 'intraday', label: '盤中' },
  ]);
  assert.deepEqual(quoteMarks({ price_basis: 'nav', price_date: '2026-10-01', estimate: true }).badges, [
    { id: 'estimate', label: '估' },
  ]);
  const pending = quoteMarks({ price_basis: 'manual_pending', price_date: '2026-09-01', estimate: 'TRUE' });
  assert.equal(pending.pending, true);
  assert.equal(pending.date, '2026-09-01');
  assert.deepEqual(pending.badges, [
    { id: 'estimate', label: '估' },
    { id: 'manual', label: '待手動' },
  ]);
  assert.equal(quoteMarks({ price_basis: 'nav' }).estimate, false);
});

test('valuation lines use the price date range and the FX stamp', () => {
  assert.equal(priceDateRange([
    { price_date: '2026-10-14' },
    { price_date: '2026-08-01' },
    { price_date: '2026-10-14' },
  ]), '2026-08-01–2026-10-14');
  assert.equal(priceDateRange([{ price_date: '2026-10-14' }]), '2026-10-14');
  assert.equal(taipeiStamp('2026-10-14T01:30:00Z'), '2026-10-14 09:30');
  assert.equal(taipeiStamp(''), '');
  const facts = valuationFacts({
    quotes: {
      a: { price_date: '2026-10-14', price_basis: 'close' },
      b: { price_date: '2026-08-01', estimate: true, kind: 'fx', value: 31 },
    },
    holdings: [{ price_date: 'not-a-date' }],
    books: [{ fx_as_of: '2026-10-14T01:30:00Z', fx_source: 'BOT' }, { fx_rate: 32.15 }],
  });
  assert.equal(facts.dates, '2026-08-01–2026-10-14');
  assert.equal(facts.estimate, true);
  assert.equal(facts.fx.rate, 32.15);
  assert.equal(facts.fx.source, 'BOT');
  assert.equal(facts.fx.time, '2026-10-14 09:30');
  assert.equal(fxView([{ fx_source: 'BOT' }], { usd: { kind: 'fx', value: 32.5 } }).rate, 32.5);
  assert.match(ESTIMATE_NOTE, /超過 2 天/);
});
