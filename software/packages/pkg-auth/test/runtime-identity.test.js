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

/** A caller's files and a Vault that issues each profile its own scopes. */
function profiledVault({ universe = '550e8400-e29b-41d4-a716-446655440000', ttl = 300, override = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-identity-profiles-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const env = { VAULT_URL: 'http://vault', SHAPER_UNIVERSE_ID: universe, SHAPER_UNIT_SLUG: 'brick-tools',
    SHAPER_UNIT_INCARNATION: 'brick-tools-1', UNIT_AUTH_PUBLIC_KEY_FILE: path.join(dir, 'public.pem'), UNIT_BOOTSTRAP_TOKEN_FILE: path.join(dir, 'bootstrap') };
  fs.writeFileSync(env.UNIT_AUTH_PUBLIC_KEY_FILE, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o444 });
  fs.writeFileSync(env.UNIT_BOOTSTRAP_TOKEN_FILE, 'd'.repeat(64), { mode: 0o600 });
  const profiles = { read: ['voice:read'], write: ['voice:read', 'voice:write', 'voice:actor'] };
  const asked = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    asked.push(body);
    const { token } = issueCredential({ universe, unit: body.unit, incarnation: body.incarnation, audience: body.audience,
      ...(body.profile ? { profile: body.profile } : {}), scopes: profiles[body.profile] || ['logger:ingest'], epoch: 1,
      revocationRef: `${body.unit}:1`, ...override }, privateKey, { ttl });
    return { ok: true, status: 200, json: async () => ({ token }) };
  };
  return { dir, env, asked, fetchImpl, privateKey, publicKey, universe, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('one credential per (audience, profile): each carries only its profile, cached apart, dropped on demand (PROFILES.md §5)', async () => {
  const v = profiledVault();
  try {
    const client = runtimeCredentialClient(v.env, v.fetchImpl);
    const read = await client.headers('brick-voice', 'read');
    const write = await client.headers('brick-voice', { profile: 'write' });
    assert.notDeepEqual(read, write);
    assert.deepEqual(v.asked.map((b) => b.profile), ['read', 'write']);
    assert.deepEqual(Object.keys(v.asked[0]).sort(), ['audience', 'incarnation', 'profile', 'unit']);
    const claimsOf = (h) => JSON.parse(Buffer.from(h.Authorization.slice(7).split('.')[0], 'base64url'));
    assert.deepEqual([claimsOf(read).profile, claimsOf(read).scopes], ['read', ['voice:read']]);
    assert.deepEqual(await client.headers('brick-voice', 'read'), read, 'cached');
    assert.equal(v.asked.length, 2);
    await client.headers('logger');
    assert.equal('profile' in v.asked[2], false, 'a whole audience is asked without a profile');
    client.invalidate('brick-voice', 'read');
    assert.notDeepEqual(await client.headers('brick-voice', 'read'), read);
    assert.equal(v.asked.length, 4);
    assert.deepEqual(await client.headers('brick-voice', 'write'), write, 'the other profile is untouched');
    for (const bad of ['Read', { profile: 'read', minValiditySeconds: 241 }, { minValiditySeconds: -1 }]) {
      await assert.rejects(client.headers('brick-voice', bad), { code: 'IDENTITY_REQUEST_INVALID', status: 400 });
    }
  } finally { v.done(); }
});

test('a credential of another profile, or none, is never cached for the profile asked', async () => {
  for (const override of [{ profile: 'write' }, { profile: undefined }]) {
    const v = profiledVault({ override });
    try {
      const client = runtimeCredentialClient(v.env, v.fetchImpl);
      await assert.rejects(client.headers('brick-voice', 'read'), { code: 'IDENTITY_RENEWAL_MISMATCH', status: 403 });
      await assert.rejects(client.headers('brick-voice', 'read'), { code: 'IDENTITY_RENEWAL_MISMATCH' });
      assert.equal(v.asked.length, 2, 'nothing was kept');
    } finally { v.done(); }
  }
});

test('a session caller asks for a credential that covers it, or is told it cannot have one', async () => {
  const v = profiledVault({ ttl: 120 });
  try {
    const client = runtimeCredentialClient(v.env, v.fetchImpl);
    await client.headers('brick-voice', 'write');
    await client.headers('brick-voice', { profile: 'write', minValiditySeconds: 100 });
    assert.equal(v.asked.length, 1, '120 s left covers 100 s');
    await assert.rejects(client.headers('brick-voice', { profile: 'write', minValiditySeconds: 200 }), { code: 'CREDENTIAL_LIFETIME_SHORT', status: 503 });
    assert.equal(v.asked.length, 2, 'a fresh one was tried first');
  } finally { v.done(); }
});

test('a held session ends at expiry, at revocation, or when Vault cannot confirm; never silently (PROFILES.md §7)', async () => {
  const v = profiledVault();
  const t0 = Date.now();
  let clock = t0;
  const { token } = issueCredential({ universe: v.universe, unit: 'brick-tools', incarnation: 'brick-tools-1', audience: 'brick-voice',
    profile: 'write', scopes: ['voice:read', 'voice:write', 'voice:actor'], epoch: 1, revocationRef: 'brick-tools:1' }, v.privateKey, { now: t0, ttl: 3 });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const env = { ...v.env, SHAPER_UNIT_SLUG: 'brick-voice' };
  const vault = (answer) => async () => answer();
  const ok = () => ({ ok: true, status: 200, json: async () => ({ active: true }) });
  // The guard's timers are unref'd (the stream it holds keeps a process
  // alive); here nothing else would.
  const keepAlive = setInterval(() => {}, 1000);
  const ended = (authorize, options = {}) => new Promise((resolve, reject) => {
    authorize.session(req, 'voice:write', { intervalSeconds: 1, onEnd: resolve, ...options }).catch(reject);
  });
  try {
    // Expiry: confirmed each second, ended once the credential's 3 s are over.
    let checks = 0;
    const live = runtimeAuthorizer(env, vault(() => { checks++; clock = Date.now(); return ok(); }), { now: () => clock });
    assert.equal(await ended(live), 'credential_expired');
    assert.ok(checks >= 2, `re-confirmed while it lasted (${checks})`);
    // Revocation after the handshake.
    let n = 0;
    const revoked = runtimeAuthorizer(env, vault(() => (n++ ? { ok: false, status: 403, json: async () => ({ code: 'CREDENTIAL_REVOKED' }) } : ok())), { now: () => t0 });
    assert.equal(await ended(revoked), 'authority_revoked');
    // Vault gone after the handshake: unverifiable, the session ends.
    let m = 0;
    const down = runtimeAuthorizer(env, vault(() => { if (m++) throw new Error('ECONNREFUSED'); return ok(); }), { now: () => t0 });
    assert.equal(await ended(down), 'authority_unverifiable');
    // Ended by the receiver itself: onEnd is not called, nothing keeps running.
    const quiet = runtimeAuthorizer(env, vault(ok), { now: () => t0 });
    let calls = 0;
    const held = await quiet.session(req, 'voice:write', { intervalSeconds: 1, onEnd: () => calls++ });
    assert.equal(held.claims.profile, 'write');
    held.end();
    await new Promise((r) => setTimeout(r, 1300));
    assert.equal(calls, 0);
    // The handshake is authorized like any request: a read scope is not a write.
    await assert.rejects(quiet.session({ headers: { authorization: `Bearer ${issueCredential({ universe: v.universe, unit: 'brick-tools', incarnation: 'brick-tools-1',
      audience: 'brick-voice', profile: 'read', scopes: ['voice:read'], epoch: 1, revocationRef: 'brick-tools:1' }, v.privateKey, { now: t0 }).token}` } },
    'voice:write', { onEnd() {} }), { code: 'CREDENTIAL_SCOPE_DENIED', status: 403 });
    await assert.rejects(quiet.session(req, 'voice:write', {}), { code: 'IDENTITY_SESSION_CONFIG_INVALID' });
  } finally { clearInterval(keepAlive); v.done(); }
});
