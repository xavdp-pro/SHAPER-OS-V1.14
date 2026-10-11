import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { registrationStatement, renewalStatement, signingPublicKeyPem, validateRecord } from '../unit-registration.js';
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

describe('the parent renews bootstraps from its records, never from a secret (DECISIONS §D)', () => {
  const record = { unit: 'queue', incarnation: 'queue-0123456789abcdef', epoch: 3, grants: { logger: ['logger:ingest'] }, bootstrapDigest: 'a'.repeat(64) };
  const renewalId = '550e8400-e29b-41d4-a716-4466554400aa';

  it('checks every recorded field against Vault, renews only when all hold, and alerts otherwise', () => {
    const text = renewalStatement({ universe, records: [record], renewalId });
    assert.match(text, /^DELIMITER \/\/$/m);
    assert.match(text, /WHEN revoked THEN 'revoked'/);
    assert.match(text, /WHEN incarnation <> 'queue-0123456789abcdef' OR epoch <> 3 OR grants <> '\{"logger":\["logger:ingest"\]\}'\n\s+OR bootstrap_digest <> 'a{64}' THEN 'mismatch'/);
    assert.match(text, /WHEN bootstrap_expires_at <= UTC_TIMESTAMP\(3\) THEN 'expired'/);
    assert.match(text, /TIMESTAMPADD\(SECOND, 604800, UTC_TIMESTAMP\(3\)\) THEN 'current'/, 'due within 7 days');
    assert.match(text, /SET bootstrap_expires_at = TIMESTAMPADD\(SECOND, 2592000, bootstrap_expires_at\)/, 'extended by 30 days');
    assert.match(text, /IF halted > 0 THEN\n\s+ROLLBACK;[\s\S]*UNIT_BOOTSTRAP_RENEWAL_HALTED[\s\S]*ELSE[\s\S]*UNIT_BOOTSTRAP_RENEWED[\s\S]*COMMIT;/);
    assert.doesNotMatch(text, /INSERT INTO unit_identities|SET (incarnation|epoch|grants|revoked)\b/, 'creates no identity, changes no incarnation, epoch, grant or revocation');
  });

  it('refuses a record outside the grammar, so no value can carry SQL', () => {
    for (const bad of [{ unit: "q'; DROP" }, { incarnation: "x' OR 1" }, { epoch: 0 }, { epoch: '3' }, { bootstrapDigest: 'zz' },
      { grants: {} }, { grants: { logger: ['*'] } }, { grants: { "l'x": ['a'] } }]) {
      assert.throws(() => validateRecord({ ...record, ...bad }), { code: 'RECORD_INVALID' }, JSON.stringify(bad));
    }
    assert.throws(() => renewalStatement({ universe, records: [record, record], renewalId }), { code: 'RENEWAL_INVALID' });
    assert.throws(() => renewalStatement({ universe, records: [record], renewalId, withinSeconds: 10 }), { code: 'RENEWAL_INVALID' });
    assert.throws(() => renewalStatement({ universe: 'nope', records: [record], renewalId }), { code: 'RENEWAL_INVALID' });
  });

  it('the command reads owner-only records and prints the statement', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-renew-'));
    try {
      const file = path.join(dir, 'queue.json');
      fs.writeFileSync(file, JSON.stringify({ ...record, registeredAt: '2026-10-11T00:00:00Z' }), { mode: 0o600 });
      const ok = spawnSync(process.execPath, [CLI, 'renew', '--record', file, '--within-seconds', '86400'], { env: { SHAPER_UNIVERSE_ID: universe }, encoding: 'utf8' });
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /TIMESTAMPADD\(SECOND, 86400, UTC_TIMESTAMP\(3\)\)/);
      fs.chmodSync(file, 0o644);
      const refused = spawnSync(process.execPath, [CLI, 'renew', '--record', file], { env: { SHAPER_UNIVERSE_ID: universe }, encoding: 'utf8' });
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /RECORD_UNTRUSTED/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
