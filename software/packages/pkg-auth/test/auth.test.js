import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBearerToken, verifyBearerToken, bearerAuthHeaders } from '../index.js';

test('auth - extract and verify bearer token', () => {
  const req = { headers: { authorization: 'Bearer secret-token' } };
  assert.equal(extractBearerToken(req), 'secret-token');
  assert.deepEqual(verifyBearerToken(req, 'secret-token'), { ok: true });
  assert.equal(verifyBearerToken(req, 'wrong').status, 403);
  assert.equal(verifyBearerToken({ headers: {} }, 'secret-token').status, 401);
  assert.deepEqual(verifyBearerToken(req, ''), { ok: true });
});

test('auth - bearerAuthHeaders', () => {
  assert.deepEqual(bearerAuthHeaders('tok'), { Authorization: 'Bearer tok' });
  assert.deepEqual(bearerAuthHeaders(''), {});
});
