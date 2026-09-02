import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { SCRIPTS, scratch, run } from './script-harness.js';

// Intent: software/RULES.md#rule-11

/**
 * Until V1.13 restore-universe.sh printed "Universe restored successfully"
 * the moment tar returned — which says the bytes were written and nothing
 * about whether the universe they form can run. Rule 11: restoration ends
 * with the universe's own deploy/proof.sh; a restore nobody proved is a claim.
 * A snapshot with a passing proof restores with exit 0, a failing proof
 * hands its exit code up, and no proof at all is "restored, NOT proven".
 */

let tmp;
before(() => {
  tmp = scratch('shaper-restore-');
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('restore-universe.sh — a restore nobody proved is a claim', () => {
  const script = path.join(SCRIPTS, 'restore-universe.sh');

  /** A snapshot the way snapshot-universe.sh makes one: the universe as one top-level directory. */
  function snapshot(name, proof) {
    const parent = path.join(tmp, `src-${name}`);
    const univ = path.join(parent, 'univ-r-dev');
    fs.mkdirSync(path.join(univ, 'deploy'), { recursive: true });
    fs.writeFileSync(path.join(univ, 'manifest.json'), '{}');
    if (proof !== null) fs.writeFileSync(path.join(univ, 'deploy/proof.sh'), proof, { mode: 0o755 });
    const tar = path.join(tmp, `${name}.tar.gz`);
    execFileSync('tar', ['-czf', tar, '-C', parent, 'univ-r-dev']);
    return tar;
  }

  it('runs the universe\'s own deploy/proof.sh and answers with its verdict', () => {
    const passing = snapshot('proven', '#!/usr/bin/env bash\ntest -f manifest.json && echo "PROOF OK from $(pwd)"\n');
    const dest = path.join(tmp, 'dest-proven');
    const ok = run(script, [passing, dest], { PATH: process.env.PATH, HOME: tmp }, tmp);
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /PROOF OK from .*univ-r-dev/, 'the proof runs from inside the restored universe');
    assert.match(ok.out, /restored .* AND proven/);

    const failing = snapshot('refuted', '#!/usr/bin/env bash\necho "brick-vault does not answer" >&2\nexit 3\n');
    const bad = run(script, [failing, path.join(tmp, 'dest-refuted')], { PATH: process.env.PATH, HOME: tmp }, tmp);
    assert.equal(bad.status, 3, 'the exit code is the proof\'s verdict');
    assert.match(bad.out, /brick-vault does not answer/, 'the proof\'s own error is shown, unedited');
    assert.doesNotMatch(bad.out, /restored successfully/);
  });

  it('says "restored, NOT proven" and exits non-zero when the snapshot carries no proof', () => {
    const blind = snapshot('unproven', null);
    const dest = path.join(tmp, 'dest-unproven');
    const r = run(script, [blind, dest], { PATH: process.env.PATH, HOME: tmp }, tmp);
    assert.notEqual(r.status, 0, 'no proof, no success');
    assert.match(r.out, /restored, NOT proven/);
    assert.ok(fs.existsSync(path.join(dest, 'univ-r-dev/manifest.json')), 'the bytes are back all the same');
  });
});
