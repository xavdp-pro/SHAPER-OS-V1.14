/**
 * The Python client/verifier (python/shaper_unit_auth.py, PROFILES.md §5–6)
 * against credentials Node's crypto signs, and its own suite. A Python unit
 * (the exchange) verifies exactly what Vault issues, with the same refusals.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { issueCredential } from '../unit-credentials.js';

const PYTHON_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'python');
const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
const skip = python.status === 0 ? false : 'python3 is not installed here';
const universe = '550e8400-e29b-41d4-a716-446655440000';

const VERIFY = `
import json, sys
import shaper_unit_auth as s
key = s.load_public_key(sys.argv[1])
out = []
for line in sys.stdin.read().split():
    try:
        c = s.verify_credential(line, key, sys.argv[2], sys.argv[3], sys.argv[4] or None)
        out.append({"unit": c["unit"], "profile": c.get("profile"), "scopes": c["scopes"]})
    except s.CredentialError as err:
        out.append({"status": err.status, "code": err.code})
print(json.dumps(out))
`;

test('Python verifies what Node signs, with the same 401/403 refusals', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-auth-py-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pem = path.join(dir, 'vault-signing.pub');
    fs.writeFileSync(pem, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o444 });
    const base = { universe, unit: 'brick-voice', incarnation: 'brick-voice-0123456789abcdef', audience: 'brick-ipbx', epoch: 3, revocationRef: 'brick-voice:3' };
    const callctx = issueCredential({ ...base, profile: 'callctx', scopes: ['ipbx:callctx:claim'] }, privateKey).token;
    const whole = issueCredential({ ...base, scopes: ['ipbx:read'] }, privateKey).token;
    const foreign = issueCredential({ ...base, audience: 'brick-tools', profile: 'planning-faq', scopes: ['tools:faq:read'] }, privateKey).token;
    const otherKey = issueCredential({ ...base, profile: 'callctx', scopes: ['ipbx:callctx:claim'] }, generateKeyPairSync('ed25519').privateKey).token;
    const [payload, signature] = callctx.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), scopes: ['ipbx:callctx:claim', 'ipbx:write'] })).toString('base64url')}.${signature}`;
    const run = (scope, tokens) => {
      const r = spawnSync('python3', ['-B', '-c', VERIFY, pem, universe, 'brick-ipbx', scope], { cwd: PYTHON_DIR, input: tokens.join('\n'), encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };
    assert.deepEqual(run('ipbx:callctx:claim', [callctx, foreign, otherKey, forged]), [
      { unit: 'brick-voice', profile: 'callctx', scopes: ['ipbx:callctx:claim'] },
      { status: 403, code: 'CREDENTIAL_BOUNDARY_DENIED' },
      { status: 401, code: 'CREDENTIAL_SIGNATURE_INVALID' },
      { status: 401, code: 'CREDENTIAL_SIGNATURE_INVALID' },
    ]);
    assert.deepEqual(run('ipbx:write', [callctx, whole]), [
      { status: 403, code: 'CREDENTIAL_SCOPE_DENIED' },
      { status: 403, code: 'CREDENTIAL_SCOPE_DENIED' },
    ], 'a callctx credential cannot write');
    assert.deepEqual(run('', [whole]), [{ unit: 'brick-voice', profile: null, scopes: ['ipbx:read'] }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Python module\'s own suite passes', { skip }, () => {
  const r = spawnSync('python3', ['-B', '-m', 'unittest', '-q', 'test_shaper_unit_auth'], { cwd: PYTHON_DIR, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /\nOK\n?$/);
});
