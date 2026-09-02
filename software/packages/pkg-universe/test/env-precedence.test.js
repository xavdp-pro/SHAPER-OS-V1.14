import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/README.md#materialise-before-mount
// Non-regression (Rule 29): until V1.13.5 the template's `source .env` clobbered
// whatever the operator had exported, so the engine measured at runbook step
// 4.2b was silently replaced by the empty OPENCODE_MODEL in .env and the deploy
// halted on its own halt-check. Two independent cold testers hit it; one reported
// patching the shipped script (a run with no on-disk report). A file carries DEFAULTS — an explicit
// export always wins (the same principle the vault's storage file was given).

const TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../universes/_template/deploy/podman-up.sh',
);

/** Runs the script's own env-precedence blocks against a fixture .env. */
function resolveWith({ exported, fileLines, print = ['OPENCODE_MODEL', 'VAULT_MASTER_KEY'] }) {
  const script = fs.readFileSync(TEMPLATE, 'utf8');
  const keep = script.match(/KEEP_VARS=\(([\s\S]*?)\)/);
  assert.ok(keep, 'the template must declare KEEP_VARS — the list an export may not lose');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-envprec-'));
  fs.writeFileSync(path.join(tmp, 'env'), fileLines.join('\n') + '\n');
  const probe = `
set -euo pipefail
KEEP_VARS=(${keep[1].trim().split(/\s+/).join(' ')})
for v in "\${KEEP_VARS[@]}"; do declare -g "__KEEP_$v=\${!v:-}"; done
set -a; source "${path.join(tmp, 'env')}"; set +a
for v in "\${KEEP_VARS[@]}"; do k="__KEEP_$v"; [[ -n "\${!k}" ]] && export "$v=\${!k}"; done
${print.map((v) => `echo "${v}=\${${v}:-}"`).join('\n')}
`;
  const out = execFileSync('bash', ['-c', probe], {
    encoding: 'utf8',
    env: { ...process.env, ...exported },
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  return Object.fromEntries(out.trim().split('\n').map((l) => l.split('=')));
}

describe('a .env carries defaults — an operator export outlives it', () => {
  it('keeps the exported engine when the file would blank it', () => {
    const r = resolveWith({
      exported: { OPENCODE_MODEL: 'measured-from-this-host' },
      fileLines: ['OPENCODE_MODEL=', 'VAULT_MASTER_KEY=from-file'],
    });
    assert.equal(r.OPENCODE_MODEL, 'measured-from-this-host',
      'the measured engine must survive — this is the halt two cold testers hit');
  });

  it('still takes from the file what was never exported', () => {
    const r = resolveWith({
      exported: { OPENCODE_MODEL: 'measured-from-this-host' },
      fileLines: ['OPENCODE_MODEL=', 'VAULT_MASTER_KEY=from-file'],
    });
    assert.equal(r.VAULT_MASTER_KEY, 'from-file', 'the file is still the default source');
  });

  it('lists the engine and the registry among the variables an export may not lose', () => {
    const script = fs.readFileSync(TEMPLATE, 'utf8');
    for (const v of ['OPENCODE_MODEL', 'SHAPER_REGISTRY', 'SHAPER_IMAGE_TAG']) {
      assert.match(script, new RegExp(`KEEP_VARS=\\([^)]*${v}`, 's'), `${v} must be protected`);
    }
  });

  // The Rule 7 sweep gave the cursor and agy bridges the opencode contract —
  // no default, a halt without a measured model — but KEEP_VARS still listed
  // only OPENCODE_MODEL. A `CURSOR_MODEL=` or `AGY_MODEL=` left in a .env
  // therefore blanked the engine an operator had exported, and the template
  // halted on its own halt-check: the very defect this file guards, met
  // again one bridge over. Every model variable a template bridge reads is
  // protected, under each name the bridge accepts.
  it('protects the model of every bridge the template can start, under every name the bridge reads', () => {
    const script = fs.readFileSync(TEMPLATE, 'utf8');
    for (const v of ['CURSOR_MODEL', 'AGY_MODEL', 'ANTIGRAVITY_MODEL']) {
      assert.match(script, new RegExp(`KEEP_VARS=\\([^)]*\\b${v}\\b`, 's'), `${v} must be protected`);
    }
    const r = resolveWith({
      exported: { CURSOR_MODEL: 'measured-from-this-host', AGY_MODEL: 'measured-too' },
      fileLines: ['CURSOR_MODEL=', 'AGY_MODEL=', 'OPENCODE_MODEL=', 'VAULT_MASTER_KEY=from-file'],
      print: ['CURSOR_MODEL', 'AGY_MODEL'],
    });
    assert.equal(r.CURSOR_MODEL, 'measured-from-this-host', 'the measured cursor engine must survive the file');
    assert.equal(r.AGY_MODEL, 'measured-too', 'the measured agy engine must survive the file');
  });
});
