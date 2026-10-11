import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-7
// Intent: software/packages/pkg-bridge-agy/INTENT.md#no-default-model
//
// Non-regression (Rule 29): the universe template used to hand the agy
// container `AGY_MODEL="${AGY_MODEL:-gemini-3.7-flash-low}"` while the package
// fell back to a different version — two caches for one bridge, neither
// measured. The template then learnt to halt, and spoke, when the bridge was
// enabled and no model was measured.
//
// Since the base release (wave 3, 11 October 2026) the template starts no
// bridge at all: its units are univ-minimal's, and a cognition adapter joins a
// universe only as a unit of the one-container shape. The lesson stays over
// every universe deploy script of this tree: one that hands the agy bridge a
// model halts without one, before podman, and none names a default.

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const UNIVERSES = path.join(SOFTWARE, 'universes');

function deployScripts() {
  const found = [];
  for (const universe of fs.readdirSync(UNIVERSES)) {
    const deploy = path.join(UNIVERSES, universe, 'deploy');
    if (!fs.existsSync(deploy)) continue;
    for (const name of fs.readdirSync(deploy).filter((n) => n.endsWith('.sh'))) {
      found.push([`${universe}/deploy/${name}`, fs.readFileSync(path.join(deploy, name), 'utf8')]);
    }
  }
  return found;
}

test('bridge-agy - no deploy script names a default agy model', () => {
  const offenders = [];
  for (const [name, text] of deployScripts()) {
    for (const line of text.split('\n')) {
      if (/(AGY|ANTIGRAVITY)_MODEL:-[^}"\s]/.test(line) || /(AGY|ANTIGRAVITY)_MODEL=["']?[A-Za-z0-9]/.test(line)) offenders.push(`${name}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `an agy model nobody measured (Rule 7):\n  ${offenders.join('\n  ')}`);
});

test('bridge-agy - a deploy script that hands the bridge a model halts without one, before podman, and says why', () => {
  for (const [name, text] of deployScripts()) {
    if (!/AGY_MODEL/.test(text) || !/podman run/.test(text)) continue;
    const halt = text.split('\n').find((l) => /\$\{AGY_MODEL:\?/.test(l));
    assert.ok(halt, `${name} passes AGY_MODEL without halting on its absence`);
    assert.ok(text.indexOf(halt) < text.indexOf('podman run'), `${name} reaches podman before the model halt`);
    const r = spawnSync('bash', ['-c', `set -euo pipefail\n${halt}\necho passed`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.notEqual(r.status, 0, `${name}: the halt let an unmeasured engine through`);
    assert.match(r.stderr, /AGY_MODEL/);
    assert.match(r.stderr, /Rule 7/);
  }
});
