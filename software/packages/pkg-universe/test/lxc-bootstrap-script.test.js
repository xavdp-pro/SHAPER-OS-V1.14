import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md#no-host-data-tree
// Intent: software/universes/README.md#materialise-before-mount
// Non-regression (Rule 29): the one-click LXC bootstrap and the guide beside
// it disagreed. The guide said "nothing to create by hand, no chmod 777" —
// /data/… are paths seen from inside the containers — while the script still
// ran `mkdir -p /data/{…}` and `chmod -R 777` on the host, seeded a journal
// under /data/workspaces/<author>/_kovzu/ that nothing reads, ran under
// `set -e` alone, and left the slug unquoted in every path. Found by the
// 2 September audit. Every check here fails on the unpatched script.

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(SOFTWARE, 'scripts/shaper-lxc-bootstrap.sh');
const text = fs.readFileSync(SCRIPT, 'utf8');
const code = text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

describe('the one-click LXC bootstrap does what its guide says', () => {
  it('parses, and runs under set -euo pipefail', () => {
    execFileSync('bash', ['-n', SCRIPT], { stdio: 'pipe' });
    assert.match(code, /^set -euo pipefail$/m, 'set -e alone lets an unset variable and a failed pipe stage pass silently');
  });

  it('creates nothing under /data on the host, and opens nothing to the world', () => {
    assert.doesNotMatch(code, /mkdir\s+(-p\s+)?\/data/, '/data/… is a container path; the deploy script creates what it mounts, under the universe');
    assert.doesNotMatch(code, /chmod\s+(-R\s+)?777/, 'world-writable directories that nothing uses');
    // The author's first name is deliberately NOT in this pattern: a tracked file
    // that spells the identifier it wants gone reintroduces it (Boot Contract 10b).
    assert.doesNotMatch(code, /\/data\/workspaces|_kovzu/, 'a host journal in workspaces named after the author — nothing in the repository reads it');
  });

  it('quotes the slug in every path it builds', () => {
    const unquoted = [];
    code.split('\n').forEach((line, index) => {
      let from = 0;
      for (;;) {
        const at = line.indexOf('${UNIV_SLUG}', from);
        if (at < 0) break;
        // Inside a double-quoted string iff an odd number of " precede it —
        // counted from the nearest `$(`, because a command substitution opens
        // a fresh quoting context: in `X="$(podman exec "${UNIV_SLUG}-x" …)"`
        // the inner pair is what quotes the slug, not the outer one.
        const context = line.slice(line.lastIndexOf('$(', at) + 1, at);
        const quotes = (context.match(/"/g) || []).length;
        if (quotes % 2 === 0) unquoted.push(`${index + 1}: ${line.trim()}`);
        from = at + 1;
      }
    });
    assert.deepEqual(unquoted, [], `slug expansions a space or a glob character would split:\n  ${unquoted.join('\n  ')}`);
  });

  // Non-regression (Rule 29), lot BASE-DOCS (11 October 2026): until the base
  // release the script made an SSH key pair for the OpenCode bridge, put the
  // bridge's public key in root's authorized_keys and copied a `podman` wrapper
  // (`ssh root@localhost podman …`) into it — an AI container holding root's
  // podman over the universe container. The base units run no bridge; nothing
  // grants a unit the universe's podman. Both checks fail on the unpatched script.
  it('wires no bridge: no SSH key for a container, no podman wrapper, no authorized_keys', () => {
    assert.doesNotMatch(code, /bridge-opencode/, 'the base units run no bridge');
    assert.doesNotMatch(code, /ssh-keygen|authorized_keys/, 'no key pair is made, and no container key reaches root');
    assert.doesNotMatch(code, /podman\s+cp\b|podman-wrapper|root@localhost/, 'no container receives a path to the universe\'s podman');
  });

  it('runs the template universe\'s own scripts, preflight first, and ends on the proof', () => {
    const order = ['deploy/install-base.sh', 'deploy/podman-up.sh" --preflight', 'deploy/podman-up.sh"\n',
      'deploy/base.sh" install-renewal-timer.sh', 'deploy/proof.sh'];
    const at = order.map((needle) => code.indexOf(needle));
    assert.ok(at.every((i) => i !== -1), `missing: ${order.filter((_, i) => at[i] === -1).join(', ')}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'install the base, preflight, bring up, renewal, then prove — in that order');
    assert.doesNotMatch(code, /universes\/\$\{UNIV_SLUG\}\/deploy\/podman-up\.sh/, 'a universe is not run from inside this repository');
  });

  it('halts when the universe does not exist instead of warning and carrying on', () => {
    assert.doesNotMatch(code, /check execution directory/, 'a warning that scrolls by, followed by four steps reporting on containers never born');
    assert.match(code, /not found[\s\S]{0,400}exit 1/, 'a missing universe must be a halt naming what to derive');
  });
});

// The flow itself, run: apt-get and systemctl are stubs on PATH, and the
// universe's deploy scripts are stubs that record their arguments, in order.
describe('the one-click bootstrap drives a template universe, and stops on what is missing', () => {
  function universe({ base = false, settings = true, derived = true } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lxc-bootstrap-'));
    const bin = path.join(dir, 'bin');
    const univ = path.join(dir, 'univ-demo-dev');
    const log = path.join(dir, 'calls.log');
    fs.mkdirSync(bin);
    for (const tool of ['apt-get', 'systemctl']) {
      fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    fs.mkdirSync(path.join(univ, 'deploy'), { recursive: true });
    if (derived) {
      for (const script of ['install-base.sh', 'podman-up.sh', 'base.sh', 'proof.sh']) {
        fs.writeFileSync(path.join(univ, 'deploy', script), `echo "${script} $*" >> "${log}"\n`);
      }
    }
    if (settings) fs.writeFileSync(path.join(univ, 'cfg-universe.env'), 'SHAPER_UNIVERSE=univ-demo-dev\n');
    if (base) {
      fs.mkdirSync(path.join(univ, 'base'));
      fs.writeFileSync(path.join(univ, 'base', '.shaper-revision'), `${'a'.repeat(40)}\n`);
    }
    const r = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, UNIV_SLUG: 'univ-demo-dev', UNIV_DIR: univ },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((c) => c.trimEnd()) : [];
    fs.rmSync(dir, { recursive: true, force: true });
    return { ...r, calls };
  }

  it('installs the base from this checkout at HEAD, then preflight, birth, renewal, proof', (t) => {
    let head;
    try {
      head = execFileSync('git', ['-C', SOFTWARE, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      t.skip('not a git checkout: the bootstrap installs the base from one revision of one');
      return;
    }
    const r = universe();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.calls, [
      `install-base.sh --shaper-repo ${path.resolve(SOFTWARE, '..')} --shaper-commit ${head}`,
      'podman-up.sh --preflight',
      'podman-up.sh',
      'base.sh install-renewal-timer.sh',
      'proof.sh',
    ]);
  });

  it('keeps an installed base as it is', () => {
    const r = universe({ base: true });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.calls.some((c) => c.startsWith('install-base.sh')), false, 'an installed base/ is never reinstalled by the bootstrap');
    assert.equal(r.calls[0], 'podman-up.sh --preflight');
  });

  it('halts before anything runs when the universe is not derived from the template, or has no settings', () => {
    for (const shape of [{ derived: false }, { settings: false }]) {
      const r = universe(shape);
      assert.equal(r.status, 1, JSON.stringify(shape));
      assert.deepEqual(r.calls, []);
      assert.match(r.stderr, /HALT/);
    }
  });
});
