'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { _internal } = require('./index.js');
const { parseGroups, parseBody, str } = _internal;

test('parseGroups handles array', () => {
  assert.deepStrictEqual(parseGroups(['admin', 'client']), ['admin', 'client']);
});

test('parseGroups handles Cognito bracketed string', () => {
  assert.deepStrictEqual(parseGroups('[admin super_admin]'), ['admin', 'super_admin']);
});

test('parseGroups handles empty/undefined', () => {
  assert.deepStrictEqual(parseGroups(undefined), []);
  assert.deepStrictEqual(parseGroups(''), []);
});

test('parseBody parses JSON', () => {
  assert.deepStrictEqual(parseBody({ body: '{"a":1}' }), { a: 1 });
});

test('parseBody handles base64', () => {
  const b64 = Buffer.from('{"x":true}').toString('base64');
  assert.deepStrictEqual(parseBody({ body: b64, isBase64Encoded: true }), { x: true });
});

test('parseBody returns {} on garbage', () => {
  assert.deepStrictEqual(parseBody({ body: 'not json' }), {});
  assert.deepStrictEqual(parseBody({}), {});
});

test('str coerces and caps length', () => {
  assert.strictEqual(str(123), '123');
  assert.strictEqual(str(null), null);
  assert.strictEqual(str('a'.repeat(6000)).length, 5000);
});

// --- Authorization gating (returns before any DynamoDB call) ---------------
const { handler } = require('./index.js');

function evt({ method = 'GET', path = '/', claims = {}, body = null }) {
  return {
    requestContext: { http: { method, path }, authorizer: { jwt: { claims } } },
    rawPath: path,
    body: body ? JSON.stringify(body) : null,
  };
}

test('missing claims -> 401', async () => {
  const r = await handler(evt({ path: '/profile', claims: {} }));
  assert.strictEqual(r.statusCode, 401);
});

test('client hitting /admin/* -> 403', async () => {
  const r = await handler(evt({ path: '/admin/clients', claims: { sub: 'u1', email: 'c@x.com' } }));
  assert.strictEqual(r.statusCode, 403);
});

test('unknown route -> 404', async () => {
  const r = await handler(evt({ path: '/nope', claims: { sub: 'u1', email: 'c@x.com' } }));
  assert.strictEqual(r.statusCode, 404);
});

test('admin role passes /admin gate but unknown admin resource -> 404', async () => {
  const r = await handler(evt({
    path: '/admin/bogus',
    claims: { sub: 'a1', email: 'a@x.com', 'cognito:groups': '[admin]' },
  }));
  assert.strictEqual(r.statusCode, 404);
});

test('admin (not super) changing role -> 403', async () => {
  const r = await handler(evt({
    method: 'PUT', path: '/admin/users',
    claims: { sub: 'a1', email: 'a@x.com', 'cognito:groups': '[admin]' },
    body: { user_id: 'u2', role: 'super_admin' },
  }));
  assert.strictEqual(r.statusCode, 403);
});
