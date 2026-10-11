import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { runtimeAuthorizer, runtimeCredentialClient } from '../runtime-identity.js';
import { issueCredential } from '../unit-credentials.js';

test('renewal coalesces callers, caches a verified token and refuses unsafe runtime files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-identity-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const bootstrap = 'a'.repeat(64), universe = '550e8400-e29b-41d4-a716-446655440000';
  const env = { VAULT_URL: 'http://vault', SHAPER_UNIVERSE_ID: universe, SHAPER_UNIT_SLUG: 'queue',
    SHAPER_UNIT_INCARNATION: 'inc-1', UNIT_AUTH_PUBLIC_KEY_FILE: path.join(dir, 'public.pem'), UNIT_BOOTSTRAP_TOKEN_FILE: path.join(dir, 'bootstrap') };
  fs.writeFileSync(env.UNIT_AUTH_PUBLIC_KEY_FILE, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o444 });
  fs.writeFileSync(env.UNIT_BOOTSTRAP_TOKEN_FILE, bootstrap, { mode: 0o600 });
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, `Bearer ${bootstrap}`);
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body).sort(), ['audience', 'incarnation', 'unit']);
    assert.equal(options.body.includes(bootstrap), false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { token } = issueCredential({ universe, unit: 'queue', incarnation: 'inc-1', audience: body.audience,
      scopes: ['logger:ingest'], epoch: 1, revocationRef: 'queue:1' }, privateKey);
    return { ok: true, json: async () => ({ token }) };
  };
  try {
    const client = runtimeCredentialClient(env, fetchImpl);
    const [one, two] = await Promise.all([client.headers('logger'), client.headers('logger')]);
    assert.deepEqual(one, two); assert.equal(calls, 1);
    assert.deepEqual(await client.headers('logger'), one); assert.equal(calls, 1);
    fs.chmodSync(env.UNIT_BOOTSTRAP_TOKEN_FILE, 0o644);
    assert.throws(() => runtimeCredentialClient(env, fetchImpl), { code: 'IDENTITY_BOOTSTRAP_FILE_UNTRUSTED' });
    fs.chmodSync(env.UNIT_BOOTSTRAP_TOKEN_FILE, 0o600);
    assert.throws(() => runtimeCredentialClient({ ...env, SHAPER_UNIVERSE_ID: undefined }, fetchImpl), { code: 'IDENTITY_POLICY_MISSING' });
    fs.chmodSync(env.UNIT_AUTH_PUBLIC_KEY_FILE, 0o666);
    assert.throws(() => runtimeCredentialClient(env, fetchImpl), { code: 'IDENTITY_PUBLIC_KEY_UNTRUSTED' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Vault renews its own credential in-process through the same bootstrap, incarnation and verification', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-identity-local-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const universe = '550e8400-e29b-41d4-a716-446655440000', bootstrap = 'b'.repeat(64);
  const env = { SHAPER_UNIVERSE_ID: universe, SHAPER_UNIT_SLUG: 'vault', SHAPER_UNIT_INCARNATION: 'vault-1',
    UNIT_BOOTSTRAP_TOKEN_FILE: path.join(dir, 'bootstrap') };
  fs.writeFileSync(env.UNIT_BOOTSTRAP_TOKEN_FILE, bootstrap, { mode: 0o600 });
  const asked = [];
  const issuer = async (ask) => {
    asked.push(ask);
    return issueCredential({ universe, unit: ask.unit, incarnation: ask.incarnation, audience: ask.audience,
      scopes: ['logger:ingest'], epoch: 1, revocationRef: 'vault:1' }, privateKey);
  };
  try {
    const client = runtimeCredentialClient(env, async () => assert.fail('no HTTP for the local issuer'), { issuer, publicKey });
    assert.match((await client.headers('logger')).Authorization, /^Bearer /);
    assert.deepEqual(asked, [{ unit: 'vault', incarnation: 'vault-1', audience: 'logger', bootstrapToken: bootstrap }]);
    assert.throws(() => runtimeCredentialClient(env, fetch, { issuer }), { code: 'IDENTITY_CLIENT_CONFIG_REQUIRED' });
    const other = generateKeyPairSync('ed25519').publicKey;
    const wrongKey = runtimeCredentialClient(env, fetch, { issuer, publicKey: other });
    await assert.rejects(wrongKey.headers('logger'), { code: 'CREDENTIAL_SIGNATURE_INVALID' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a short credential lifetime is still cached for half of it, not renewed on every call', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-identity-short-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const universe = '550e8400-e29b-41d4-a716-446655440000';
  const env = { SHAPER_UNIVERSE_ID: universe, SHAPER_UNIT_SLUG: 'vault', SHAPER_UNIT_INCARNATION: 'vault-1',
    UNIT_BOOTSTRAP_TOKEN_FILE: path.join(dir, 'bootstrap') };
  fs.writeFileSync(env.UNIT_BOOTSTRAP_TOKEN_FILE, 'c'.repeat(64), { mode: 0o600 });
  let issued = 0;
  const issuer = async (ask) => {
    issued++;
    return issueCredential({ universe, unit: ask.unit, incarnation: ask.incarnation, audience: ask.audience,
      scopes: ['logger:ingest'], epoch: 1, revocationRef: 'vault:1' }, privateKey, { ttl: 20 });
  };
  try {
    const client = runtimeCredentialClient(env, fetch, { issuer, publicKey });
    await client.headers('logger');
    await client.headers('logger');
    await client.headers('logger');
    assert.equal(issued, 1, 'a 20 s credential is reused for its first 10 s');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an authority Vault cannot confirm is 503 whatever Vault answered; Vault\'s refusals keep their status', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-identity-check-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const universe = '550e8400-e29b-41d4-a716-446655440000';
  const env = { VAULT_URL: 'http://vault', SHAPER_UNIVERSE_ID: universe, SHAPER_UNIT_SLUG: 'queue', UNIT_AUTH_PUBLIC_KEY_FILE: path.join(dir, 'public.pem') };
  fs.writeFileSync(env.UNIT_AUTH_PUBLIC_KEY_FILE, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o444 });
  const { token } = issueCredential({ universe, unit: 'maestro', incarnation: 'm-1', audience: 'queue', scopes: ['queue:read'], epoch: 1, revocationRef: 'maestro:1' }, privateKey);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const vaultAnswering = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  try {
    for (const status of [500, 502, 404, 418]) {
      await assert.rejects(runtimeAuthorizer(env, vaultAnswering(status, { code: 'WHATEVER' }))(req, 'queue:read'), (err) => err.status === 503 && err.code === 'IDENTITY_UNAVAILABLE', String(status));
    }
    await assert.rejects(runtimeAuthorizer(env, vaultAnswering(403, { code: 'CREDENTIAL_REVOKED' }))(req, 'queue:read'), (err) => err.status === 403);
    await assert.rejects(runtimeAuthorizer(env, vaultAnswering(401, { code: 'CREDENTIAL_INVALID' }))(req, 'queue:read'), (err) => err.status === 401);
    assert.equal((await runtimeAuthorizer(env, vaultAnswering(200, { active: true }))(req, 'queue:read')).unit, 'maestro');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
