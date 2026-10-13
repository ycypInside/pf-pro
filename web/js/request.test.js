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

const { decideAuth_, mergeRequestParams_, fxNeedsFetch_ } = context;

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

test('BOT fx is fetched only when today is missing', () => {
  assert.equal(fxNeedsFetch_('', '2026-10-13'), true);
  assert.equal(fxNeedsFetch_(null, '2026-10-13'), true);
  assert.equal(fxNeedsFetch_('2026-10-12', '2026-10-13'), true);
  assert.equal(fxNeedsFetch_('2026-10-13', '2026-10-13'), false);
  assert.equal(fxNeedsFetch_('2026-10-14', '2026-10-13'), false);
});
