import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { registrationStatement, renewalReadbackStatement, renewalStatement, revocationStatement, signingPublicKeyPem, validateRecord } from '../unit-registration.js';
import { VaultUnitIdentity } from '../unit-identity.js';
import { normalizeMasterKey } from '../index.js';

// Intent: software/packages/pkg-vault/INTENT.md#parent-registration
// The parent's steps are proven live through the evidence stack
// (pkg-logger/test/live/evidence-stack.mjs uses both); these checks hold the
// command and the statement without a database.

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '../unit-registration.js');
const universe = '550e8400-e29b-41d4-a716-446655440000';

describe('the parent pins the key Vault will sign with', () => {
  it('derives exactly the public key the running Vault uses', () => {
    const masterKey = 'e'.repeat(64);
    const service = new VaultUnitIdentity({ pool: null, masterKey: normalizeMasterKey(masterKey), universe });
    assert.equal(signingPublicKeyPem({ masterKey, universe }), service.publicKey.export({ type: 'spki', format: 'pem' }));
    assert.notEqual(signingPublicKeyPem({ masterKey, universe: '550e8400-e29b-41d4-a716-446655440001' }), signingPublicKeyPem({ masterKey, universe }));
  });

  it('prints it from a private master-key file, and refuses a readable one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-reg-'));
    try {
      const key = path.join(dir, 'master.key');
      fs.writeFileSync(key, 'e'.repeat(64), { mode: 0o400 });
      const ok = spawnSync(process.execPath, [CLI, 'public-key'], { env: { VAULT_MASTER_KEY_FILE: key, SHAPER_UNIVERSE_ID: universe }, encoding: 'utf8' });
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /^-----BEGIN PUBLIC KEY-----/);
      fs.chmodSync(key, 0o644);
      const refused = spawnSync(process.execPath, [CLI, 'public-key'], { env: { VAULT_MASTER_KEY_FILE: key, SHAPER_UNIVERSE_ID: universe }, encoding: 'utf8' });
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /VAULT_KEY_FILE_UNTRUSTED/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the parent registers an incarnation without exposing its bootstrap', () => {
  it('builds one statement from validated values, carrying only the token digest', () => {
    const token = 'a'.repeat(64);
    const { params, text } = registrationStatement({ universe, unit: 'queue', incarnation: 'queue-1', grants: { logger: ['logger:ingest'] }, bootstrapToken: token });
    assert.equal(params[4], crypto.createHash('sha256').update(token).digest('hex'));
    assert.doesNotMatch(text, new RegExp(token));
    // A revoked identity never comes back with the credentials issued before it was revoked.
    assert.match(text, /ON DUPLICATE KEY UPDATE epoch = IF\(incarnation = VALUES\(incarnation\) AND NOT revoked, epoch, epoch \+ 1\)/);
    for (const bad of [{ unit: 'Queue' }, { incarnation: "q'1" }, { grants: { logger: ['*'] } }, { grants: {} }, { universe: 'nope' }, { ttlSeconds: 10 }]) {
      assert.throws(() => registrationStatement({ universe, unit: 'queue', incarnation: 'queue-1', grants: { logger: ['logger:ingest'] }, bootstrapToken: token, ...bad }), { code: 'REGISTRATION_INVALID' });
    }
  });

  it('registers a hyphenated unit and audience under their own names (DECISIONS §K)', () => {
    const { params, text } = registrationStatement({ universe, unit: 'brick-voice', incarnation: 'brick-voice-1',
      grants: { 'brick-ipbx': ['ipbx:callctx:claim'], logger: ['logger:ingest'] }, bootstrapToken: 'b'.repeat(64) });
    assert.equal(params[1], 'brick-voice');
    assert.deepEqual(JSON.parse(params[3]), { 'brick-ipbx': ['ipbx:callctx:claim'], logger: ['logger:ingest'] });
    assert.match(text, /'brick-voice', 'brick-voice-1', 1, '\{"brick-ipbx":\["ipbx:callctx:claim"\]/);
    for (const bad of [{ unit: 'brick-' }, { unit: 'brick_voice;' }, { grants: { '-ipbx': ['x'] } }]) {
      assert.throws(() => registrationStatement({ universe, unit: 'brick-voice', incarnation: 'v-1', grants: { logger: ['logger:ingest'] }, bootstrapToken: 'b'.repeat(64), ...bad }), { code: 'REGISTRATION_INVALID' });
    }
  });

  it('writes the token owner-only, prints the statement, and never overwrites a token', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-reg-'));
    try {
      const file = path.join(dir, 'queue', 'bootstrap');
      const args = [CLI, 'register', '--unit', 'queue', '--incarnation', 'queue-1', '--grant', 'logger=logger:ingest', '--bootstrap-file', file];
      const r = spawnSync(process.execPath, args, { env: { SHAPER_UNIVERSE_ID: universe }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const token = fs.readFileSync(file, 'utf8');
      assert.match(token, /^[0-9a-f]{64}$/);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.match(r.stdout, /^INSERT INTO unit_identities/);
      assert.ok(r.stdout.includes(crypto.createHash('sha256').update(token).digest('hex')));
      assert.doesNotMatch(r.stdout, new RegExp(token));
      const again = spawnSync(process.execPath, args, { env: { SHAPER_UNIVERSE_ID: universe }, encoding: 'utf8' });
      assert.equal(again.status, 1);
      assert.equal(fs.readFileSync(file, 'utf8'), token, 'the delivered token is untouched');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the parent renews each consistent bootstrap from its records, never from a secret (decision L)', () => {
  const record = { unit: 'queue', incarnation: 'queue-0123456789abcdef', epoch: 3, grants: { logger: ['logger:ingest'] }, bootstrapDigest: 'a'.repeat(64) };
  const renewalId = '550e8400-e29b-41d4-a716-4466554400aa';

  it('checks every recorded field against Vault and extends a due one from its current expiry, guarded on all of them', () => {
    const text = renewalStatement({ universe, records: [record], renewalId });
    assert.match(text, /^DELIMITER \/\/$/m);
    assert.match(text, /WHEN revoked THEN 'revoked'/);
    assert.match(text, /WHEN incarnation <> 'queue-0123456789abcdef' OR epoch <> 3 OR grants <> '\{"logger":\["logger:ingest"\]\}' OR bootstrap_digest <> 'a{64}' THEN 'inconsistent'/);
    assert.match(text, /WHEN bootstrap_expires_at <= UTC_TIMESTAMP\(3\) THEN 'expired'/);
    assert.match(text, /TIMESTAMPADD\(SECOND, 604800, UTC_TIMESTAMP\(3\)\) THEN 'current'/, 'due within 7 days');
    assert.match(text, /FROM unit_identities WHERE universe_id = '[^']+' AND unit_id = 'queue' FOR UPDATE;/, 'the row is locked');
    assert.match(text, /SET bootstrap_expires_at = TIMESTAMPADD\(SECOND, 2592000, bootstrap_expires_at\)\n\s+WHERE .* AND incarnation = 'queue-0123456789abcdef' AND epoch = 3 AND grants = .*\n\s+AND bootstrap_digest = 'a{64}' AND NOT revoked AND bootstrap_expires_at = e0;/,
      'extended by 30 days from its current expiry, only the row that was checked');
    assert.match(text, /IF ROW_COUNT\(\) <> 1 THEN SIGNAL SQLSTATE '45000'/);
    assert.doesNotMatch(text, /INSERT INTO unit_identities|SET (incarnation|epoch|grants|revoked)\b/, 'creates no identity, changes no incarnation, epoch, grant or revocation');
  });

  it('one transaction: any SQL error rolls it all back; the universe must be known; a blocked identity commits a correlated partial alert', () => {
    const text = renewalStatement({ universe, records: [record], expected: ['vault', 'queue'], renewalId });
    assert.match(text, /DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;\n\s+START TRANSACTION;/);
    assert.match(text, /IF known = 0 THEN[\s\S]*UNIT_BOOTSTRAP_RENEWAL_HALTED[\s\S]*'universe-unknown'[\s\S]*ELSE/);
    assert.match(text, /DECLARE s0 VARCHAR\(16\) DEFAULT 'missing';\n\s+DECLARE d0 VARCHAR\(64\) DEFAULT 'no-record';/, 'an expected unit without a record is missing');
    assert.match(text, /IF blocked > 0 THEN\n\s+SET @shaper_renewal_alert := JSON_OBJECT\('pod', 'vault', 'event', 'UNIT_BOOTSTRAP_RENEWAL_PARTIAL', 'level', 'ERROR', 'executionId', '550e8400-e29b-41d4-a716-4466554400aa', 'correlationId', '550e8400-e29b-41d4-a716-4466554400aa'/);
    assert.match(text, /'event', 'UNIT_BOOTSTRAP_RENEWED', 'level', 'INFO', 'executionId', '550e8400-e29b-41d4-a716-4466554400aa:1', 'correlationId', '550e8400-e29b-41d4-a716-4466554400aa'/);
    assert.match(text, /COMMIT;\n\s+SELECT 'vault', s0,[\s\S]*UNION ALL SELECT '\*', IF\(blocked > 0, 'partial', 'complete'\), renewed, blocked;/);
    // No ROLLBACK path other than the error handler: a blocked identity never undoes another's renewal.
    assert.equal(text.match(/ROLLBACK/g).length, 1);
  });

  it('a record outside the composition is unexpected, never renewed', () => {
    const text = renewalStatement({ universe, records: [record], expected: ['vault'], renewalId });
    assert.match(text, /DECLARE s1 VARCHAR\(16\) DEFAULT 'unexpected';/);
    assert.doesNotMatch(text, /UPDATE unit_identities/);
  });

  it('refuses a record outside the grammar, so no value can carry SQL', () => {
    for (const bad of [{ unit: "q'; DROP" }, { incarnation: "x' OR 1" }, { epoch: 0 }, { epoch: '3' }, { bootstrapDigest: 'zz' },
      { grants: {} }, { grants: { logger: ['*'] } }, { grants: { "l'x": ['a'] } }]) {
      assert.throws(() => validateRecord({ ...record, ...bad }), { code: 'RECORD_INVALID' }, JSON.stringify(bad));
    }
    assert.throws(() => renewalStatement({ universe, records: [record, record], renewalId }), { code: 'RENEWAL_INVALID' });
    assert.throws(() => renewalStatement({ universe, records: [record], renewalId, withinSeconds: 10 }), { code: 'RENEWAL_INVALID' });
    assert.throws(() => renewalStatement({ universe: 'nope', records: [record], renewalId }), { code: 'RENEWAL_INVALID' });
    assert.throws(() => renewalStatement({ universe, records: [record], expected: ["v'x"], renewalId }), { code: 'RENEWAL_INVALID' });
    assert.throws(() => renewalStatement({ universe, records: [record], expected: ['queue', 'queue'], renewalId }), { code: 'RENEWAL_INVALID' });
    assert.throws(() => renewalStatement({ universe, records: [], renewalId }), { code: 'RENEWAL_INVALID' }, 'nothing to renew is not a run');
    assert.throws(() => renewalReadbackStatement({ renewalId: "x' OR 1" }), { code: 'RENEWAL_INVALID' });
  });

  it('the readback names one run\'s proofs and its alert, and proves it ran', () => {
    const text = renewalReadbackStatement({ renewalId });
    assert.match(text, /event_id LIKE '550e8400-e29b-41d4-a716-4466554400aa:%' AND JSON_VALUE\(body, '\$\.event'\) = 'UNIT_BOOTSTRAP_RENEWED'/);
    assert.match(text, /WHERE event_id = '550e8400-e29b-41d4-a716-4466554400aa' AND JSON_VALUE\(body, '\$\.event'\) IN \('UNIT_BOOTSTRAP_RENEWAL_PARTIAL', 'UNIT_BOOTSTRAP_RENEWAL_HALTED'\)/);
    assert.match(text, /SELECT '#', 'read', '-', '-';\n$/);
  });

  it('the command reads owner-only records, keeps the run id it is given, and halts on a record it cannot trust', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-renew-'));
    try {
      const file = path.join(dir, 'queue.json');
      fs.writeFileSync(file, JSON.stringify({ ...record, registeredAt: '2026-10-11T00:00:00Z' }), { mode: 0o600 });
      const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { env: { SHAPER_UNIVERSE_ID: universe }, encoding: 'utf8' });
      const ok = run('renew', '--expect', 'vault', '--expect', 'queue', '--record', file, '--within-seconds', '86400', '--renewal-id', renewalId);
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /TIMESTAMPADD\(SECOND, 86400, UTC_TIMESTAMP\(3\)\)/);
      assert.match(ok.stdout, /renewal 550e8400-e29b-41d4-a716-4466554400aa /);
      assert.match(ok.stdout, /DEFAULT 'no-record'/, 'vault expected, no record');
      // Only expected units and no record at all: every one missing, still a run.
      assert.equal(run('renew', '--expect', 'vault', '--renewal-id', renewalId).status, 0);
      const back = run('readback', '--renewal-id', renewalId);
      assert.equal(back.status, 0, back.stderr);
      assert.match(back.stdout, /SELECT '#', 'read'/);
      const other = path.join(dir, 'maestro.json');
      fs.writeFileSync(other, JSON.stringify(record), { mode: 0o600 });
      const misnamed = run('renew', '--expect', 'queue', '--record', other);
      assert.equal(misnamed.status, 1);
      assert.match(misnamed.stderr, /RECORD_INVALID: .*records another unit/);
      fs.chmodSync(file, 0o644);
      const refused = run('renew', '--expect', 'queue', '--record', file);
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /RECORD_UNTRUSTED/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('rights profiles are registered by the parent (decision N, pkg-auth PROFILES.md)', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { env: { SHAPER_UNIVERSE_ID: universe, ...env }, encoding: 'utf8' });

  it('--profile builds audience → profile → exact scopes; --grant keeps the whole-audience form', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-reg-profiles-'));
    try {
      const r = run(['register', '--unit', 'brick-tools', '--incarnation', 'brick-tools-0123456789abcdef',
        '--profile', 'brick-voice/read=voice:read',
        '--profile', 'brick-voice/write=voice:read', '--profile', 'brick-voice/write=voice:write', '--profile', 'brick-voice/write=voice:actor',
        '--grant', 'logger=logger:ingest', '--bootstrap-file', path.join(dir, 'bootstrap')]);
      assert.equal(r.status, 0, r.stderr);
      const grants = JSON.parse(/'(\{.*\})'/.exec(r.stdout)[1]);
      assert.deepEqual(grants, { 'brick-voice': { read: ['voice:read'], write: ['voice:read', 'voice:write', 'voice:actor'] }, logger: ['logger:ingest'] });
      assert.doesNotMatch(r.stdout, new RegExp(fs.readFileSync(path.join(dir, 'bootstrap'), 'utf8')));
      for (const [bad, why] of [
        [['--grant', 'brick-voice=voice:read', '--profile', 'brick-voice/read=voice:read'], /both whole/],
        [['--profile', 'brick-voice/read=voice:read', '--grant', 'brick-voice=voice:read'], /both whole/],
        [['--profile', 'brick-voice=voice:read'], /audience\/profile=scope/],
        [['--profile', 'brick-voice/Read=voice:read'], /audience\/profile=scope/],
        [['--profile', 'brick-voice/read/x=voice:read'], /audience\/profile=scope/],
        [['--profile', 'brick-voice/read=voice:read', '--profile', 'brick-voice/read=voice:read'], /distinct/],
        [['--profile', 'brick-voice/read=*'], /non-wildcard/],
        [['--grant', 'brick-voice/read=voice:read'], /--grant takes audience=scope/],
      ]) {
        const refused = run(['register', '--unit', 'brick-tools', '--incarnation', 'i-1', ...bad, '--bootstrap-file', path.join(dir, 'never')]);
        assert.equal(refused.status, 1, bad.join(' '));
        assert.match(refused.stderr, why, bad.join(' '));
        assert.equal(fs.existsSync(path.join(dir, 'never')), false, 'nothing is written before the grants are valid');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the renewal and its records take profiled grants exactly as Vault stores them', () => {
    const grants = { 'brick-ipbx': { callctx: ['ipbx:callctx:claim'] }, 'brick-tools': { 'planning-faq': ['tools:planning:read', 'tools:faq:read'] } };
    const record = { unit: 'brick-voice', incarnation: 'brick-voice-0123456789abcdef', epoch: 2, grants, bootstrapDigest: 'b'.repeat(64) };
    assert.deepEqual(validateRecord(record).grants, grants);
    const text = renewalStatement({ universe, records: [record], renewalId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8' });
    assert.ok(text.includes(`grants <> '${JSON.stringify(grants)}'`), 'compared as the registration wrote it');
    const { params } = registrationStatement({ universe, unit: 'brick-voice', incarnation: record.incarnation, grants, bootstrapToken: 'c'.repeat(64) });
    assert.equal(params[3], JSON.stringify(grants));
    for (const bad of [{ 'brick-ipbx': { callctx: [] } }, { 'brick-ipbx': {} }, { 'brick-ipbx': { Callctx: ['a'] } }]) {
      assert.throws(() => validateRecord({ ...record, grants: bad }), { code: 'RECORD_INVALID' }, JSON.stringify(bad));
    }
  });

  it('revocation is one transaction with its evidence, refused when nothing live is there', () => {
    const revocationId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
    const text = revocationStatement({ universe, unit: 'brick-voice', revocationId });
    assert.match(text, /DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;\n  START TRANSACTION;/);
    assert.match(text, /SELECT incarnation, epoch INTO inc, ep FROM unit_identities WHERE universe_id = '550e8400-e29b-41d4-a716-446655440000' AND unit_id = 'brick-voice' AND NOT revoked FOR UPDATE;/);
    assert.match(text, /IF inc IS NULL THEN SIGNAL SQLSTATE '45000'/);
    assert.match(text, /UPDATE unit_identities SET revoked = TRUE WHERE .* AND NOT revoked;\n  IF ROW_COUNT\(\) <> 1 THEN SIGNAL/);
    assert.match(text, /'event', 'UNIT_IDENTITY_REVOKED', 'level', 'WARN'/);
    assert.match(text, new RegExp(`INSERT INTO event_outbox \\(event_id, body, body_digest\\) VALUES \\('${revocationId}'`));
    assert.match(text, /COMMIT;\n  SELECT 'brick-voice', 'revoked', ep;/);
    assert.doesNotMatch(text, /INSERT INTO unit_identities|SET (incarnation|epoch|grants)\b/, 'it revokes, nothing else');
    for (const bad of [{ unit: "x'y" }, { universe: 'nope' }, { revocationId: 'r1' }]) {
      assert.throws(() => revocationStatement({ universe, unit: 'brick-voice', revocationId, ...bad }), { code: 'REVOCATION_INVALID' });
    }
    const cli = run(['revoke', '--unit', 'brick-voice', '--revocation-id', revocationId]);
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout, text);
    assert.equal(run(['revoke', '--unit', 'Brick']).status, 1);
  });
});
