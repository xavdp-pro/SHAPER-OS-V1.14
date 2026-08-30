import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/README.md#materialise-before-mount
//
// Born from the v1.13.14 sealing run (report-seal5-muse, incident 1): with
// VAULT_MASTER_KEY missing and no ENV_FILE named, the halt-check's own
// message evaluated a bare $ENV_FILE under `set -u` and the script died with
// "ENV_FILE: unbound variable" — a shell error where a named, actionable
// halt was owed. A gate that crashes while speaking teaches nothing (0K).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, '../../../universes/_template/deploy/podman-up.sh');

test('the vault-key halt names the key and the fix — it does not crash on its own message', () => {
  const R = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-halt-'));
  fs.mkdirSync(path.join(R, 'repo/software/packages'), { recursive: true });
  fs.mkdirSync(path.join(R, 'repo/univ-dev/deploy'), { recursive: true });
  fs.copyFileSync(TEMPLATE, path.join(R, 'repo/univ-dev/deploy/podman-up.sh'));
  // A software/.env that exists but carries no vault key — the state the
  // sealing run met. ENV_FILE deliberately NOT set.
  fs.writeFileSync(path.join(R, 'repo/software/.env'), 'OPENCODE_MODEL=\n');
  fs.writeFileSync(path.join(R, 'repo/univ-dev/manifest.json'), '{"environment":"dev"}');

  let output = '';
  try {
    execFileSync('bash', [path.join(R, 'repo/univ-dev/deploy/podman-up.sh')], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, SHAPER_IMAGE_TAG: 'vX', SHAPER_REGISTRY: '127.0.0.1:1' },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.fail('podman-up.sh must halt when VAULT_MASTER_KEY is missing');
  } catch (err) {
    output = `${err.stdout || ''}${err.stderr || ''}`;
  }
  assert.doesNotMatch(output, /ENV_FILE[^=]*(unbound|sans liaison)/,
    `the halt crashed on its own message instead of speaking:\n${output}`);
  assert.match(output, /Set VAULT_MASTER_KEY/,
    `the halt does not name the missing key and the fix:\n${output}`);
});
