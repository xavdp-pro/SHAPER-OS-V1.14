import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createUnitAuthorizer, issueCredential, verifyCredential } from '../unit-credentials.js';

const universe = '550e8400-e29b-41d4-a716-446655440000';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const identity = { universe, unit: 'queue', incarnation: 'inc-1', audience: 'logger',
  scopes: ['logger:ingest'], epoch: 1, revocationRef: 'queue:1' };
const now = 1791186000000;

test('credential binds identity, incarnation, audience, scope and bounded validity', () => {
  const { token, claims } = issueCredential(identity, privateKey, { now });
  assert.deepEqual(verifyCredential(token, publicKey, { universe, audience: 'logger', scope: 'logger:ingest', now }), claims);
  for (const options of [{ audience: 'queue' }, { universe: '550e8400-e29b-41d4-a716-446655440001' }, { scope: 'logger:observe' }]) {
    assert.throws(() => verifyCredential(token, publicKey, { universe, audience: 'logger', now, ...options }), (err) => err.status === 403);
  }
  assert.throws(() => verifyCredential(token, publicKey, { universe, audience: 'logger', now: now+300000 }), { code: 'CREDENTIAL_EXPIRED' });
  assert.throws(() => verifyCredential(token, publicKey, { universe, audience: 'logger', now: now-1000 }), { code: 'CREDENTIAL_EXPIRED' });
});

test('payload tampering, another key, malformed token and unbounded grants are refused', () => {
  const { token } = issueCredential(identity, privateKey, { now });
  const [payload, signature] = token.split('.');
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), unit: 'vault' })).toString('base64url');
  for (const bad of [`${tampered}.${signature}`, 'unsigned', token+'=', 'x'.repeat(20000)]) {
    assert.throws(() => verifyCredential(bad, publicKey, { universe, audience: 'logger', now }));
  }
  assert.throws(() => verifyCredential(token, generateKeyPairSync('ed25519').publicKey, { universe, audience: 'logger', now }), { code: 'CREDENTIAL_SIGNATURE_INVALID' });
  assert.throws(() => issueCredential({ ...identity, scopes: ['*'] }, privateKey), { code: 'CREDENTIAL_INVALID' });
  assert.throws(() => issueCredential({ ...identity, unit: undefined }, privateKey), { code: 'CREDENTIAL_INVALID' });
  assert.throws(() => issueCredential(identity, privateKey, { ttl: 301 }), { code: 'CREDENTIAL_TTL_INVALID' });
});

test('valid signature cannot bypass current revocation or an unavailable verifier', async () => {
  const { token } = issueCredential(identity, privateKey, { now });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const options = { publicKey, universe, audience: 'logger', now: () => now };
  await assert.rejects(createUnitAuthorizer({ ...options, checkCurrent: async () => false })(req, 'logger:ingest'), { code: 'CREDENTIAL_REVOKED' });
  await assert.rejects(createUnitAuthorizer({ ...options, checkCurrent: async () => { throw new Error('unavailable'); } })(req, 'logger:ingest'));
  assert.throws(() => createUnitAuthorizer(options), { code: 'IDENTITY_CURRENT_CHECK_REQUIRED' });
});
