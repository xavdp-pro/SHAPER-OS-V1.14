import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { registrationStatement, signingPublicKeyPem } from '../unit-registration.js';
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
