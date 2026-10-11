import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VaultUnitIdentity, deriveSigningKey } from '../unit-identity.js';
import { publicKeyId } from '../../pkg-auth/unit-credentials.js';

const universe = '550e8400-e29b-41d4-a716-446655440000';
const bootstrapToken = 'a'.repeat(64), masterKey = Buffer.alloc(32, 7), now = 1791186000000;
function fixture() {
  const row = { incarnation: 'inc-1', epoch: 1, grants: JSON.stringify({ logger: ['logger:ingest'] }),
    bootstrap_digest: createHash('sha256').update(bootstrapToken).digest('hex'), bootstrap_expiry: now/1000+600,
    revoked: 0, identity_revoked: 0, credential_revoked: 0 };
  const writes = [], conn = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    execute: async (sql, params) => { if (sql.startsWith('SELECT')) return [[row]]; writes.push(params); return [{}]; } };
  return { row, writes, service: new VaultUnitIdentity({ pool: { getConnection: async () => conn, execute: conn.execute }, masterKey, universe, now: () => now }) };
}

test('signing identity continues with matching recovery key and is universe-separated', () => {
  const id = publicKeyId(deriveSigningKey(masterKey, universe));
  assert.equal(publicKeyId(deriveSigningKey(masterKey, universe)), id);
  assert.notEqual(publicKeyId(deriveSigningKey(Buffer.alloc(32, 8), universe)), id);
  assert.notEqual(publicKeyId(deriveSigningKey(masterKey, '550e8400-e29b-41d4-a716-446655440001')), id);
});

test('issuance requires parent-bound bootstrap identity and persists only metadata plus evidence', async () => {
  const f = fixture();
  const input = { unit: 'queue', incarnation: 'inc-1', audience: 'logger', bootstrapToken };
  const { token, claims } = await f.service.issue(input);
  assert.equal((await f.service.check(token, 'logger')).credentialId, claims.credentialId);
  assert.equal(f.writes.length, 2);
  assert.doesNotMatch(JSON.stringify(f.writes), new RegExp(bootstrapToken));
  assert.equal(JSON.stringify(f.writes).includes(token), false);
  for (const change of [{ bootstrapToken: 'b'.repeat(64) }, { incarnation: 'inc-old' }, { audience: 'vault' }]) {
    await assert.rejects(f.service.issue({ ...input, ...change }));
  }
  f.row.bootstrap_expiry = now/1000;
  await assert.rejects(f.service.issue(input), { code: 'IDENTITY_ISSUE_DENIED' });
});

test('revoked credential, replaced incarnation and removed grant invalidate signed credentials', async () => {
  for (const change of [{ credential_revoked: 1 }, { identity_revoked: 1 }, { incarnation: 'inc-2' }, { epoch: 2 }, { grants: '{}' }]) {
    const f = fixture();
    const { token } = await f.service.issue({ unit: 'queue', incarnation: 'inc-1', audience: 'logger', bootstrapToken });
    Object.assign(f.row, change);
    await assert.rejects(f.service.check(token, 'logger'), { code: 'CREDENTIAL_REVOKED' });
  }
});

test('a hyphenated unit and audience are issued and checked under their own names (DECISIONS §K)', async () => {
  const f = fixture();
  f.row.grants = JSON.stringify({ 'brick-ipbx': ['ipbx:callctx:claim'] });
  const { token, claims } = await f.service.issue({ unit: 'brick-voice', incarnation: 'inc-1', audience: 'brick-ipbx', bootstrapToken });
  assert.deepEqual([claims.unit, claims.audience, claims.revocationRef], ['brick-voice', 'brick-ipbx', 'brick-voice:1']);
  assert.equal((await f.service.check(token, 'brick-ipbx')).unit, 'brick-voice');
  const stored = f.writes[0];
  assert.deepEqual([stored[2], stored[5]], ['brick-voice', 'brick-ipbx'], 'unit_credentials stores the names unchanged');
  for (const unit of ['brick-', '-voice', 'Brick-voice']) {
    await assert.rejects(f.service.issue({ unit, incarnation: 'inc-1', audience: 'brick-ipbx', bootstrapToken }), { code: 'IDENTITY_ISSUE_DENIED' });
  }
});
