import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECIPE = path.resolve(HERE, '../../../universes/_maker-template/recipes/lxd-stamp.sh');

// Intent: software/universes/_maker-template/INTENT.md
//
// Found on terrain, first two-instance birth: two simultaneous stamps of the
// SAME digest both saw the image alias absent, both imported, and the loser
// died mid-import — one visitor's demo was silently never born. The recipe
// must serialise the import per digest. This test runs the real recipe twice
// in parallel against a shim lxc that records every import and makes each
// one slow enough for the race to happen; on the unpatched recipe it counts
// two imports, on the patched one exactly one.

function makeShim(dir, log) {
  // A fake lxc: `image info` says absent until an import completed; `image
  // import` takes 300ms and appends to the log; everything else succeeds
  // fast. The recipe's later steps (launch, exec, list) are irrelevant here —
  // the run is cut after the import by making `launch` fail loudly.
  const shim = path.join(dir, 'lxc');
  fs.writeFileSync(shim, `#!/usr/bin/env bash
LOG=${JSON.stringify(log)}
case "$1 $2" in
  "image info")
    [ -s "$LOG" ] && exit 0 || exit 1 ;;
  "image import")
    sleep 0.3
    echo "import" >> "$LOG"
    exit 0 ;;
  *)
    # Stop the recipe here: the import behaviour is what this test measures.
    exit 7 ;;
esac
`);
  fs.chmodSync(shim, 0o755);
}

describe('the stamp recipe imports one matrix once, even under contention', () => {
  it('two concurrent stamps of the same digest perform a single import', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-lock-'));
    const log = path.join(dir, 'imports.log');
    makeShim(dir, log);

    // A real matrix file whose digest matches its name, as the recipe demands.
    const bytes = Buffer.from('matrix-under-test');
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    const matrices = path.join(dir, 'matrices');
    fs.mkdirSync(matrices);
    fs.writeFileSync(path.join(matrices, `${sha}.tar.gz`), bytes);

    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      SHAPER_MATRICES_DIR: matrices,
      SHAPER_LOCK_DIR: dir,
    };
    const run = (row) => execFileP('bash', [
      RECIPE, row, 'univ-demo-crm', 'demo-crm-atelier', `sha256:${sha}`, 'Compte Test', 'demo',
    ], { env }).catch((err) => err); // the shim cuts the run at launch (exit 7)

    await Promise.all([run('inst-1'), run('inst-2')]);

    const imports = fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    assert.equal(
      imports.length, 1,
      `expected exactly one import under contention, saw ${imports.length} — the race is back`,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
