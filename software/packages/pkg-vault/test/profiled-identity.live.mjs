/**
 * Live (real private MariaDB, real Vault HTTP server): decision N's rights
 * profiles end to end, with the Clinic profiles of pkg-auth PROFILES.md §3.
 *
 * The parent registers brick-tools, brick-voice and brick-ipbx through the
 * registration tool's statements, applied by root with the mariadb client
 * (the path podman-up.sh and extra-identity.sh use). Then, from Node and from
 * Python (python/shaper_unit_auth.py, the exchange's language):
 *   - each holder acquires one credential per (audience, profile), carrying
 *     only that profile's scopes; a read credential attempting a write is 403;
 *   - receivers verify signature, universe, audience, scope and current
 *     authority with Vault; another audience is 403;
 *   - a profile the parent did not register is refused at issuance;
 *   - a new incarnation ends the old one's credentials and issuance (403);
 *   - a revocation, one transaction with its evidence, ends them too;
 *   - Vault down: 503 for issuance and every check, from both languages, no
 *     fallback.
 *
 * Run through software/packages/pkg-db/test/live/run-live.mjs.
 * Intent: software/packages/pkg-auth/PROFILES.md
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminQuery, liveEnv, resetUnit, unitDb } from '../../pkg-db/test/live/live-env.mjs';
import { createVaultServer } from '../index.js';
import { MariaDbVaultStore } from '../mariadb-store.js';
import { VaultUnitIdentity } from '../unit-identity.js';
import { registrationStatement, revocationStatement, signingPublicKeyPem, writeBootstrapToken } from '../unit-registration.js';
import { runtimeAuthorizer, runtimeCredentialClient } from '../../pkg-auth/runtime-identity.js';

const UNIVERSE = '550e8400-e29b-41d4-a716-446655440000';
const PYTHON_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../pkg-auth/python');
// pkg-auth PROFILES.md §3, as the kit registers it.
const PROFILES = {
  'brick-tools': { 'brick-voice': { read: ['voice:read'], write: ['voice:read', 'voice:write', 'voice:actor'] },
    'brick-ipbx': { read: ['ipbx:read'], write: ['ipbx:read', 'ipbx:write', 'ipbx:actor'] } },
  'brick-voice': { 'brick-ipbx': { callctx: ['ipbx:callctx:claim'] },
    'brick-tools': { 'planning-faq': ['tools:planning:read', 'tools:planning:write', 'tools:faq:read'] } },
  'brick-ipbx': { 'brick-tools': { routing: ['tools:routing:read'] } },
};

let vaultStore, server, vaultUrl, dir, masterKey;
const incarnation = {};

/** Root's path into Vault's database: the mariadb client, a statement on standard input. */
function rootApply(text) {
  const { socketPath } = liveEnv();
  return execFileSync(path.join(process.env.MARIADB_BASEDIR, 'usr/bin/mariadb'),
    ['--no-defaults', '-S', socketPath, '-uroot', '-N', '-B', 'vault'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function register(unit, inc) {
  const file = path.join(dir, unit, 'bootstrap');
  fs.rmSync(file, { force: true });
  const bootstrapToken = writeBootstrapToken(file);
  rootApply(registrationStatement({ universe: UNIVERSE, unit, incarnation: inc, grants: PROFILES[unit], bootstrapToken, ttlSeconds: 3600 }).text);
  incarnation[unit] = inc;
}

const envOf = (unit, extra = {}) => ({
  VAULT_URL: vaultUrl, SHAPER_UNIVERSE_ID: UNIVERSE, SHAPER_UNIT_SLUG: unit, SHAPER_UNIT_INCARNATION: incarnation[unit],
  UNIT_BOOTSTRAP_TOKEN_FILE: path.join(dir, unit, 'bootstrap'), UNIT_AUTH_PUBLIC_KEY_FILE: path.join(dir, 'vault-signing.pub'), ...extra,
});
const req = (headers) => ({ headers: { authorization: headers.Authorization } });
const outcome = async (promise) => {
  try { const claims = await promise; return claims.unit; } catch (err) { return [err.status, err.code]; }
};

/** The Python module, run as a unit would: its environment, one JSON request, one JSON answer. */
const PY = `
import json, sys
import shaper_unit_auth as s
ask = json.loads(sys.stdin.read())
out = []
try:
    if ask["role"] == "client":
        client = s.CredentialClient()
        for audience, profile in ask["want"]:
            try:
                out.append(client.headers(audience, profile)["Authorization"])
            except s.CredentialError as err:
                out.append([err.status, err.code])
    else:
        authorize = s.Authorizer()
        for header, scope in ask["check"]:
            try:
                out.append(authorize(header, scope)["unit"])
            except s.CredentialError as err:
                out.append([err.status, err.code])
except s.CredentialError as err:
    out = [err.status, err.code]
print(json.dumps(out))
`;
// Asynchronous: Vault serves from this very process, so a synchronous child
// would freeze the server it asks.
function python(env, ask) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-B', '-c', PY], { cwd: PYTHON_DIR, env: { PATH: process.env.PATH, ...env } });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`python exited ${code}: ${err}`))));
    child.stdin.end(JSON.stringify(ask));
  });
}

before(async () => {
  await resetUnit('vault');
  masterKey = crypto.randomBytes(32).toString('hex');
  vaultStore = await MariaDbVaultStore.open({ masterKey, slug: 'vault', db: unitDb() });
  const identityService = new VaultUnitIdentity({ pool: vaultStore.pool, masterKey: vaultStore.masterKey, universe: UNIVERSE });
  server = createVaultServer({ port: 0, host: '127.0.0.1', vaultStore, identityService, universe: UNIVERSE });
  await new Promise((resolve) => server.once('listening', resolve));
  vaultUrl = `http://127.0.0.1:${server.address().port}`;
  dir = fs.mkdtempSync(path.join(liveEnv().workDir, 'profiles-'));
  fs.writeFileSync(path.join(dir, 'vault-signing.pub'), signingPublicKeyPem({ masterKey, universe: UNIVERSE }), { mode: 0o444 });
  for (const unit of Object.keys(PROFILES)) register(unit, `${unit}-0123456789abcdef`);
});
after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vaultStore?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('decision N: rights profiles through the real Vault', () => {
  it('Vault holds the three registrations with their profiles, by digest only', async () => {
    const rows = await adminQuery('SELECT unit_id AS unit, grants, epoch FROM vault.unit_identities ORDER BY unit_id');
    assert.deepEqual(rows.map((r) => [r.unit, JSON.parse(r.grants), Number(r.epoch)]),
      Object.keys(PROFILES).sort().map((u) => [u, PROFILES[u], 1]));
  });

  it('tools holds a read and a write credential for voice; the read one cannot write', async () => {
    const tools = runtimeCredentialClient(envOf('brick-tools'));
    const voice = runtimeAuthorizer(envOf('brick-voice', { UNIT_BOOTSTRAP_TOKEN_FILE: undefined }));
    const read = await tools.headers('brick-voice', 'read');
    const write = await tools.headers('brick-voice', 'write');
    assert.equal(await outcome(voice(req(read), 'voice:read')), 'brick-tools');
    assert.deepEqual(await outcome(voice(req(read), 'voice:write')), [403, 'CREDENTIAL_SCOPE_DENIED'], 'a read credential attempting a write');
    assert.deepEqual(await outcome(voice(req(read), 'voice:actor')), [403, 'CREDENTIAL_SCOPE_DENIED'], 'no actor delegation on a read credential');
    const claims = await voice(req(write), 'voice:write');
    assert.deepEqual([claims.profile, claims.scopes], ['write', ['voice:read', 'voice:write', 'voice:actor']]);
    // Another audience's receiver refuses it.
    const ipbx = runtimeAuthorizer(envOf('brick-ipbx'));
    assert.deepEqual(await outcome(ipbx(req(write), 'ipbx:read')), [403, 'CREDENTIAL_BOUNDARY_DENIED'], 'wrong audience');
    // Issuance evidence names each profile; no token or bootstrap in it.
    const issued = await adminQuery(`SELECT body FROM vault.event_outbox WHERE JSON_VALUE(body, '$.event') = 'UNIT_CREDENTIAL_ISSUED'
      AND JSON_VALUE(body, '$.data.unit') = 'brick-tools' ORDER BY created_at`);
    assert.deepEqual(issued.map((r) => JSON.parse(r.body).data.profile), ['read', 'write']);
    const all = JSON.stringify(issued);
    for (const secret of [read.Authorization.slice(7), write.Authorization.slice(7), fs.readFileSync(path.join(dir, 'brick-tools/bootstrap'), 'utf8')]) {
      assert.equal(all.includes(secret), false);
    }
  });

  it('a profile or audience the parent did not register is refused at issuance; a malformed request is 400', async () => {
    const ask = (body, token = fs.readFileSync(path.join(dir, 'brick-voice/bootstrap'), 'utf8')) => fetch(`${vaultUrl}/api/identity/issue`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit: 'brick-voice', incarnation: incarnation['brick-voice'], ...body }) }).then(async (r) => [r.status, (await r.json()).code]);
    assert.deepEqual(await ask({ audience: 'brick-ipbx', profile: 'write' }), [403, 'IDENTITY_PROFILE_DENIED']);
    assert.deepEqual(await ask({ audience: 'brick-ipbx' }), [403, 'IDENTITY_PROFILE_DENIED'], 'a profiled audience is never issued whole');
    assert.deepEqual(await ask({ audience: 'brick-voice', profile: 'read' }), [403, 'IDENTITY_AUDIENCE_DENIED']);
    assert.deepEqual(await ask({ audience: 'brick-ipbx', profile: 'callctx', scopes: ['ipbx:write'] }), [400, 'IDENTITY_REQUEST_INVALID'], 'no caller names its scopes');
    assert.deepEqual(await ask({ audience: 'brick-ipbx', profile: 'callctx' }).then(([s]) => s), 200);
  });

  it('Python acquires its profile and verifies Node\'s credentials against the same Vault; a callctx credential cannot write', async () => {
    // The exchange (Python) asks tools for routing.
    const [routing, denied] = await python(envOf('brick-ipbx'), { role: 'client', want: [['brick-tools', 'routing'], ['brick-tools', 'planning-faq']] });
    assert.match(routing, /^Bearer /);
    assert.deepEqual(denied, [403, 'IDENTITY_PROFILE_DENIED']);
    const tools = runtimeAuthorizer(envOf('brick-tools'));
    const claims = await tools({ headers: { authorization: routing } }, 'tools:routing:read');
    assert.deepEqual([claims.unit, claims.profile, claims.scopes], ['brick-ipbx', 'routing', ['tools:routing:read']]);
    assert.deepEqual(await outcome(tools({ headers: { authorization: routing } }, 'tools:planning:read')), [403, 'CREDENTIAL_SCOPE_DENIED']);
    // The exchange as receiver: voice's claim credential, tools' read and write ones.
    const callctx = await runtimeCredentialClient(envOf('brick-voice')).headers('brick-ipbx', 'callctx');
    const toolsClient = runtimeCredentialClient(envOf('brick-tools'));
    const ipbxRead = await toolsClient.headers('brick-ipbx', 'read');
    const ipbxWrite = await toolsClient.headers('brick-ipbx', 'write');
    const voiceWrite = await toolsClient.headers('brick-voice', 'write');
    assert.deepEqual(await python(envOf('brick-ipbx'), { role: 'receiver', check: [
      [callctx.Authorization, 'ipbx:callctx:claim'], [callctx.Authorization, 'ipbx:write'],
      [ipbxRead.Authorization, 'ipbx:read'], [ipbxRead.Authorization, 'ipbx:write'],
      [ipbxWrite.Authorization, 'ipbx:write'], [ipbxWrite.Authorization, 'ipbx:actor'],
      [voiceWrite.Authorization, 'ipbx:read'], [null, 'ipbx:read'], [`${ipbxRead.Authorization}x`, 'ipbx:read'],
    ] }), ['brick-voice', [403, 'CREDENTIAL_SCOPE_DENIED'], 'brick-tools', [403, 'CREDENTIAL_SCOPE_DENIED'],
      'brick-tools', 'brick-tools', [403, 'CREDENTIAL_BOUNDARY_DENIED'], [401, 'CREDENTIAL_INVALID'], [401, 'CREDENTIAL_SIGNATURE_INVALID']]);
  });

  it('a new incarnation ends the old one: its credentials 403 at the receiver, its issuance 403', async () => {
    const oldEnv = envOf('brick-voice');
    const old = await runtimeCredentialClient(oldEnv).headers('brick-tools', 'planning-faq');
    const tools = runtimeAuthorizer(envOf('brick-tools'));
    assert.equal(await outcome(tools(req(old), 'tools:faq:read')), 'brick-voice');
    const oldBootstrap = path.join(dir, 'brick-voice-old-bootstrap');
    fs.copyFileSync(oldEnv.UNIT_BOOTSTRAP_TOKEN_FILE, oldBootstrap);
    register('brick-voice', 'brick-voice-fedcba9876543210');
    const [[row]] = [await adminQuery("SELECT incarnation, epoch FROM vault.unit_identities WHERE unit_id = 'brick-voice'")];
    assert.deepEqual([row.incarnation, Number(row.epoch)], ['brick-voice-fedcba9876543210', 2]);
    assert.deepEqual(await outcome(tools(req(old), 'tools:faq:read')), [403, 'CREDENTIAL_REVOKED'], 'old incarnation refused');
    await assert.rejects(runtimeCredentialClient({ ...oldEnv, UNIT_BOOTSTRAP_TOKEN_FILE: oldBootstrap }).headers('brick-tools', 'planning-faq'),
      { status: 403, code: 'IDENTITY_ISSUE_DENIED' });
    const fresh = await runtimeCredentialClient(envOf('brick-voice')).headers('brick-tools', 'planning-faq');
    assert.equal((await tools(req(fresh), 'tools:planning:write')).incarnation, 'brick-voice-fedcba9876543210');
  });

  it('a revocation is one transaction with its evidence; every credential and issuance stop, from both languages', async () => {
    const toolsClient = runtimeCredentialClient(envOf('brick-tools'));
    const write = await toolsClient.headers('brick-voice', 'write');
    const ipbxRead = await toolsClient.headers('brick-ipbx', 'read');
    const voice = runtimeAuthorizer(envOf('brick-voice'));
    assert.equal(await outcome(voice(req(write), 'voice:write')), 'brick-tools');
    const revocationId = crypto.randomUUID();
    assert.equal(rootApply(revocationStatement({ universe: UNIVERSE, unit: 'brick-tools', revocationId })).trim(), 'brick-tools\trevoked\t1');
    assert.deepEqual(await outcome(voice(req(write), 'voice:write')), [403, 'CREDENTIAL_REVOKED']);
    assert.deepEqual(await python(envOf('brick-ipbx'), { role: 'receiver', check: [[ipbxRead.Authorization, 'ipbx:read']] }), [[403, 'CREDENTIAL_REVOKED']]);
    toolsClient.invalidate('brick-voice', 'write');
    await assert.rejects(toolsClient.headers('brick-voice', 'write'), { status: 403, code: 'IDENTITY_ISSUE_DENIED' });
    const [evidence] = await adminQuery('SELECT body FROM vault.event_outbox WHERE event_id = ?', [revocationId]);
    assert.deepEqual(JSON.parse(evidence.body).data, { revocationId, universe: UNIVERSE, unit: 'brick-tools', incarnation: incarnation['brick-tools'], epoch: 1 });
    // Nothing live to revoke: the client fails, nothing is committed.
    assert.throws(() => rootApply(revocationStatement({ universe: UNIVERSE, unit: 'brick-tools', revocationId: crypto.randomUUID() })), /no live identity of brick-tools/);
    assert.equal((await adminQuery("SELECT COUNT(*) AS n FROM vault.event_outbox WHERE JSON_VALUE(body, '$.event') = 'UNIT_IDENTITY_REVOKED'"))[0].n, 1);
    // Only a new registration brings it back, under a new epoch.
    register('brick-tools', 'brick-tools-0aa0aa0aa0aa0aa0');
    const back = await runtimeCredentialClient(envOf('brick-tools')).headers('brick-voice', 'read');
    assert.equal((await voice(req(back), 'voice:read')).epoch, 2);
  });

  it('Vault down: 503 for issuance and every check, from Node and Python; nothing falls back', async () => {
    const tools = runtimeCredentialClient(envOf('brick-tools'));
    const read = await tools.headers('brick-voice', 'read');
    const callctx = await runtimeCredentialClient(envOf('brick-voice')).headers('brick-ipbx', 'callctx');
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
    const voice = runtimeAuthorizer(envOf('brick-voice'));
    assert.deepEqual(await outcome(voice(req(read), 'voice:read')), [503, 'IDENTITY_UNAVAILABLE']);
    assert.deepEqual(await outcome(voice(req(read), 'voice:write')), [403, 'CREDENTIAL_SCOPE_DENIED'], 'a local refusal stays a refusal');
    await assert.rejects(tools.headers('brick-ipbx', 'write'), { status: 503, code: 'IDENTITY_UNAVAILABLE' });
    assert.deepEqual(await python(envOf('brick-ipbx'), { role: 'receiver', check: [[callctx.Authorization, 'ipbx:callctx:claim']] }), [[503, 'IDENTITY_UNAVAILABLE']]);
    assert.deepEqual(await python(envOf('brick-ipbx'), { role: 'client', want: [['brick-tools', 'routing']] }), [[503, 'IDENTITY_UNAVAILABLE']]);
  });
});
