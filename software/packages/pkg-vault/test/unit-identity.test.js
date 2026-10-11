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

test('a rights profile is issued alone: a read credential carries no write scope (decision N, PROFILES.md)', async () => {
  const f = fixture();
  f.row.grants = JSON.stringify({ logger: ['logger:ingest'],
    'brick-voice': { read: ['voice:read'], write: ['voice:read', 'voice:write', 'voice:actor'] } });
  const input = { unit: 'brick-tools', incarnation: 'inc-1', audience: 'brick-voice', bootstrapToken };
  const read = await f.service.issue({ ...input, profile: 'read' });
  assert.deepEqual([read.claims.profile, read.claims.scopes], ['read', ['voice:read']]);
  const write = await f.service.issue({ ...input, profile: 'write' });
  assert.deepEqual([write.claims.profile, write.claims.scopes], ['write', ['voice:read', 'voice:write', 'voice:actor']]);
  assert.equal((await f.service.check(read.token, 'brick-voice')).profile, 'read');
  // The issuance evidence names the profile; the token never enters it.
  const evidence = f.writes.filter((w) => typeof w[1] === 'string' && w[1].includes('UNIT_CREDENTIAL_ISSUED')).map((w) => JSON.parse(w[1]));
  assert.deepEqual(evidence.map((e) => e.data.profile), ['read', 'write']);
  assert.equal(JSON.stringify(f.writes).includes(read.token), false);
  // A whole audience keeps its form, without a profile.
  const whole = await f.service.issue({ ...input, audience: 'logger' });
  assert.equal('profile' in whole.claims, false);
  assert.equal('profile' in (await f.service.issue({ ...input, audience: 'logger', profile: null })).claims, false, 'null is no profile');
  // What the parent did not register is refused, typed for Vault's evidence only.
  for (const [ask, reason] of [[{}, 'PROFILE_REQUIRED'], [{ profile: 'admin' }, 'PROFILE_NOT_GRANTED'],
    [{ audience: 'logger', profile: 'read' }, 'PROFILE_ON_WHOLE_AUDIENCE']]) {
    await assert.rejects(f.service.issue({ ...input, ...ask }), (err) => err.code === 'IDENTITY_PROFILE_DENIED' && err.status === 403
      && err.reason === reason && err.authenticated === true, reason);
  }
  await assert.rejects(f.service.issue({ ...input, audience: 'brick-ipbx', profile: 'read' }), { code: 'IDENTITY_AUDIENCE_DENIED' });
  for (const profile of ['Read', '', 7, '-x']) {
    await assert.rejects(f.service.issue({ ...input, profile }), { code: 'IDENTITY_ISSUE_DENIED' }, String(profile));
  }
});

test('a profile narrowed, removed or regrouped by the parent ends the credentials issued under it', async () => {
  const profiled = { 'brick-voice': { read: ['voice:read'], write: ['voice:read', 'voice:write'] } };
  for (const [after, current] of [
    [profiled, true],
    [{ 'brick-voice': { read: ['voice:read'], write: ['voice:read'] } }, false],
    [{ 'brick-voice': { read: ['voice:read'] } }, false],
    [{ 'brick-voice': ['voice:read', 'voice:write'] }, false],
    [{ 'brick-voice': { other: ['voice:read', 'voice:write'] } }, false],
  ]) {
    const f = fixture();
    f.row.grants = JSON.stringify(profiled);
    const { token } = await f.service.issue({ unit: 'brick-tools', incarnation: 'inc-1', audience: 'brick-voice', profile: 'write', bootstrapToken });
    f.row.grants = JSON.stringify(after);
    if (current) assert.equal((await f.service.check(token, 'brick-voice')).profile, 'write');
    else await assert.rejects(f.service.check(token, 'brick-voice'), { code: 'CREDENTIAL_REVOKED', status: 403 }, JSON.stringify(after));
  }
});
