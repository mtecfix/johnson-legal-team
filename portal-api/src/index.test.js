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
