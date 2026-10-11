import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-7
// Intent: software/packages/pkg-bridge-cursor/INTENT.md#no-default-model
//
// Non-regression (Rule 29): the universe template used to hand the cursor
// container `CURSOR_MODEL="${CURSOR_MODEL:-composer-2.5}"` — a pinned version
// the bridge did not even read. The template then learnt to halt, and spoke,
// when the bridge was enabled and no model was measured.
//
// Since the base release (wave 3, 11 October 2026) the template starts no
// bridge at all: its units are univ-minimal's, and a cognition adapter joins a
// universe only as a unit of the one-container shape. The lesson stays where
// a bridge is still started: every universe deploy script of this tree that
// hands the cursor bridge a model halts without one, before podman, and names
// no default.

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const UNIVERSES = path.join(SOFTWARE, 'universes');

function deployScripts() {
  const found = [];
  for (const universe of fs.readdirSync(UNIVERSES)) {
    const deploy = path.join(UNIVERSES, universe, 'deploy');
    if (!fs.existsSync(deploy)) continue;
    for (const name of fs.readdirSync(deploy).filter((n) => n.endsWith('.sh'))) {
      found.push([`${universe}/deploy/${name}`, path.join(deploy, name)]);
    }
  }
  return found;
}

const handsTheModel = (text) => /CURSOR_MODEL/.test(text) && /podman run/.test(text);

test('bridge-cursor - the template starts no bridge', () => {
  for (const name of ['podman-up.sh', 'lib.sh', 'install-base.sh', 'proof.sh', 'base.sh']) {
    const text = fs.readFileSync(path.join(UNIVERSES, '_template/deploy', name), 'utf8');
    // The template starts nothing itself (the base's own script starts the base
    // units), and wires no engine.
    assert.doesNotMatch(text, /podman run|CURSOR_MODEL|AGY_MODEL|OPENCODE_MODEL|WITH_BRIDGE/, `_template/deploy/${name} starts a container or wires a bridge`);
  }
});

test('bridge-cursor - every deploy script that hands the bridge a model names no default', () => {
  const offenders = [];
  for (const [name, file] of deployScripts()) {
    const text = fs.readFileSync(file, 'utf8');
    if (!handsTheModel(text)) continue;
    for (const line of text.split('\n')) {
      if (/CURSOR_MODEL:-[^}"\s]/.test(line) || /CURSOR_MODEL=["']?[A-Za-z0-9]/.test(line)) offenders.push(`${name}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `a cursor model nobody measured (Rule 7):\n  ${offenders.join('\n  ')}`);
});

test('bridge-cursor - every deploy script that hands the bridge a model halts without one, before podman, and says why', () => {
  const scripts = deployScripts().filter(([, file]) => handsTheModel(fs.readFileSync(file, 'utf8')));
  assert.ok(scripts.length > 0, 'no deploy script starts the cursor bridge: retire this test with the last one');
  for (const [name, file] of scripts) {
    const text = fs.readFileSync(file, 'utf8');
    const halt = text.split('\n').find((l) => /\$\{CURSOR_MODEL:\?/.test(l));
    assert.ok(halt, `${name} passes CURSOR_MODEL without halting on its absence`);
    assert.ok(text.indexOf(halt) < text.indexOf('podman run'), `${name} reaches podman before the model halt`);
    // The halt line, run on its own without a model: it refuses, and names the variable and the rule.
    const r = spawnSync('bash', ['-c', `set -euo pipefail\n${halt}\necho passed`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.notEqual(r.status, 0, `${name}: the halt let an unmeasured engine through`);
    assert.match(r.stderr, /CURSOR_MODEL/);
    assert.match(r.stderr, /Rule 7/);
  }
});
