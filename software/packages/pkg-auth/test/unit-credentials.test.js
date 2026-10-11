import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createUnitAuthorizer, isUnitName, issueCredential, UNIT_NAME_PATTERN, verifyCredential } from '../unit-credentials.js';

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

test('a hyphenated functional slug is a unit and an audience as it is, never an alias (DECISIONS §K)', async () => {
  const voice = { ...identity, unit: 'brick-voice', audience: 'brick-ipbx', scopes: ['ipbx:callctx:claim'], revocationRef: 'brick-voice:1' };
  const { token, claims } = issueCredential(voice, privateKey, { now });
  assert.equal(claims.unit, 'brick-voice');
  assert.deepEqual(verifyCredential(token, publicKey, { universe, audience: 'brick-ipbx', scope: 'ipbx:callctx:claim', now }), claims);
  assert.throws(() => verifyCredential(token, publicKey, { universe, audience: 'brick_ipbx', now }), { code: 'CREDENTIAL_BOUNDARY_DENIED' });
  const authorize = createUnitAuthorizer({ publicKey, universe, audience: 'brick-ipbx', checkCurrent: async () => true, now: () => now });
  assert.equal((await authorize({ headers: { authorization: `Bearer ${token}` } }, 'ipbx:callctx:claim')).unit, 'brick-voice');
  for (const name of ['-voice', 'voice-', 'Brick-voice', '1brick', 'brick voice', 'a'.repeat(33)]) {
    assert.equal(isUnitName(name), false, name);
    assert.throws(() => issueCredential({ ...voice, unit: name }, privateKey, { now }), { code: 'CREDENTIAL_INVALID' }, name);
    assert.throws(() => verifyCredential(token, publicKey, { universe, audience: name, now }), { code: 'IDENTITY_POLICY_MISSING' }, name);
  }
});

test('pkg-auth, pkg-db and the unit runtime hold one functional-slug grammar', async () => {
  const { SLUG_PATTERN: db } = await import('../../pkg-db/index.js');
  const { SLUG_PATTERN: runtime } = await import('../../../runtime/unit-mariadb/lib.mjs');
  assert.equal(db.source, UNIT_NAME_PATTERN.source);
  assert.equal(runtime.source, UNIT_NAME_PATTERN.source);
  assert.equal(db.flags, UNIT_NAME_PATTERN.flags);
  assert.equal(runtime.flags, UNIT_NAME_PATTERN.flags);
});
