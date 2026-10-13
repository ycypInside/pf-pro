import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const context = {};
createContext(context);
runInContext(readFileSync(path.join(root, 'apps-script/Request.js'), 'utf8'), context);

const { decideAuth_, mergeRequestParams_, fxNeedsFetch_, presentedToken_, publicWrite_, safeJsonText_ } = context;

function authReason(presented, stored) {
  const result = decideAuth_(presented, stored);
  return result ? `${result.error}|${result.reason}` : '';
}

test('auth reports why a token was rejected', () => {
  assert.equal(authReason('client-token', ''), 'auth_unavailable|missing_secret');
  assert.equal(authReason('client-token', null), 'auth_unavailable|missing_secret');
  assert.equal(authReason('client-token', '   '), 'auth_unavailable|missing_secret');
  assert.equal(authReason('', 'secret-token'), 'unauthorized|missing_token');
  assert.equal(authReason('nope', 'secret-token'), 'unauthorized|mismatch');
  assert.equal(decideAuth_('  secret-token  ', 'secret-token'), null);
});

test('GET params keep a token when the redirect duplicates the query', () => {
  const merged = mergeRequestParams_(
    { q: 'summary', token: 'from-parameter' },
    { token: ['', 'from-parameters'], q: ['summary'] },
    'q=summary&token=from-query&token=later-query',
  );
  assert.equal(merged.token, 'from-parameter');
  assert.equal(merged.q, 'summary');
  const fromArrays = mergeRequestParams_(null, { token: ['', 'kept'] }, 'q=balances');
  assert.equal(fromArrays.token, 'kept');
  assert.equal(fromArrays.q, 'balances');
  const fromQuery = mergeRequestParams_(null, null, 'q=summary&from=2026-10-01&token=abc+def');
  assert.equal(fromQuery.token, 'abc def');
  assert.equal(fromQuery.from, '2026-10-01');
});

test('a blank body token yields to the query token', () => {
  assert.equal(presentedToken_('  body-token  ', 'query-token'), 'body-token');
  assert.equal(presentedToken_('   ', ' query-token '), 'query-token');
  assert.equal(presentedToken_(null, 'query-token'), 'query-token');
  assert.equal(presentedToken_('', ''), '');
  assert.equal(presentedToken_('kept', ''), 'kept');
  assert.equal(authReason(presentedToken_(' ', 'secret-token'), 'secret-token'), '');
  assert.equal(authReason(presentedToken_('', ''), 'secret-token'), 'unauthorized|missing_token');
});

test('write responses publish snapshot and benchmark fields', () => {
  const created = publicWrite_('run_snapshot', { ids: ['2026-10-13'], created: true, snapshot_date: '2026-10-13' });
  assert.equal(created.ok, true);
  assert.equal(created.created, true);
  assert.equal(created.snapshot_date, '2026-10-13');
  assert.equal(created.result.created, true);
  assert.equal(created.result.snapshot_date, '2026-10-13');
  const skipped = publicWrite_('run_snapshot', { ids: ['2026-10-13'], created: false, snapshot_date: '2026-10-13' });
  assert.equal(skipped.created, false);
  assert.equal(skipped.snapshot_date, '2026-10-13');
  const open = publicWrite_('refresh_benchmarks', { done: false, added: 3 });
  assert.equal(open.done, false);
  assert.equal(open.result.done, false);
  const finished = publicWrite_('refresh_benchmarks', { done: true, added: 0 });
  assert.equal(finished.done, true);
  const other = publicWrite_('add_transaction', { ids: ['TX1'] });
  assert.equal(other.ok, true);
  assert.equal('done' in other, false);
  assert.equal('created' in other, false);
});

test('JSON text never comes back empty', () => {
  assert.equal(safeJsonText_({ ok: true, q: 'summary' }), '{"ok":true,"q":"summary"}');
  assert.equal(safeJsonText_(undefined), '{"ok":false,"error":"server"}');
  const circular = {};
  circular.self = circular;
  assert.equal(safeJsonText_(circular), '{"ok":false,"error":"server"}');
});

test('BOT fx is fetched only when today is missing', () => {
  assert.equal(fxNeedsFetch_('', '2026-10-13'), true);
  assert.equal(fxNeedsFetch_(null, '2026-10-13'), true);
  assert.equal(fxNeedsFetch_('2026-10-12', '2026-10-13'), true);
  assert.equal(fxNeedsFetch_('2026-10-13', '2026-10-13'), false);
  assert.equal(fxNeedsFetch_('2026-10-14', '2026-10-13'), false);
});
