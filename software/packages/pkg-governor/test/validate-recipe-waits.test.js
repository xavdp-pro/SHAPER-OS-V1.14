import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECIPE = path.resolve(HERE, '../../../universes/_maker-template/recipes/lxd-validate.sh');

// Intent: software/universes/_maker-template/INTENT.md
//
// A newborn is given time to open its eyes. The first autonomous validation
// on terrain ran 500ms after the stamp and judged a connection the child had
// not yet offered — STAMPED means the container runs, the application inside
// boots on its own clock. The recipe must wait for the child's FIRST HTTP
// answer, bounded, before judging any of its promises.

function makeShims(dir) {
  const state = path.join(dir, 'curl-calls');
  fs.writeFileSync(state, '');
  // lxc: instance exists, has an address, and ships a spec.
  fs.writeFileSync(path.join(dir, 'lxc'), `#!/usr/bin/env bash
case "$1 $2" in
  "info "*) exit 0 ;;
  "list "*) echo "10.0.0.9 (eth0)"; exit 0 ;;
  "file pull") echo '{"checks":[{"goto":"/"}]}' > "\${@: -1}"; exit 0 ;;
  *) exit 0 ;;
esac
`);
  // curl: refuses twice, answers from the third call on — a booting child.
  fs.writeFileSync(path.join(dir, 'curl'), `#!/usr/bin/env bash
COUNT=$(wc -l < ${JSON.stringify(state)})
echo x >> ${JSON.stringify(state)}
[ "$COUNT" -ge 2 ] && exit 0 || exit 7
`);
  // podman: records that the verifier ran, and passes.
  fs.writeFileSync(path.join(dir, 'podman'), `#!/usr/bin/env bash
echo ran >> ${JSON.stringify(path.join(dir, 'podman-calls'))}
echo '{"passed":true,"steps":[]}'
exit 0
`);
  // sleep: instant, so the wait loop spins without real time passing.
  fs.writeFileSync(path.join(dir, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
  for (const f of ['lxc', 'curl', 'podman', 'sleep']) {
    fs.chmodSync(path.join(dir, f), 0o755);
  }
  return { state };
}

describe('the validate recipe waits for the newborn', () => {
  it('does not judge before the child answers, then judges exactly once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-wait-'));
    const { state } = makeShims(dir);
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      SHAPER_EVIDENCE_DIR: path.join(dir, 'evidence'),
      SHAPER_VALIDATE_BOOT_BUDGET: '10',
    };
    const { stdout } = await execFileP('bash', [
      RECIPE, 'inst-42', 'univ-demo-crm', 'demo-crm-nu', 'sha256:aa', 'A', 'demo',
    ], { env });

    const curlCalls = fs.readFileSync(state, 'utf8').trim().split('\n').filter(Boolean).length;
    assert.ok(curlCalls >= 3, `the recipe probed before judging (${curlCalls} probes)`);
    const podmanCalls = fs.readFileSync(path.join(dir, 'podman-calls'), 'utf8')
      .trim().split('\n').filter(Boolean).length;
    assert.equal(podmanCalls, 1, 'the verifier ran exactly once, after the child answered');
    assert.match(stdout.trim().split('\n').at(-1), /"passed":true/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a child that never answers is a loud failure, not a judged ghost', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-dead-'));
    makeShims(dir);
    // curl that never succeeds
    fs.writeFileSync(path.join(dir, 'curl'), '#!/usr/bin/env bash\nexit 7\n');
    fs.chmodSync(path.join(dir, 'curl'), 0o755);
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      SHAPER_EVIDENCE_DIR: path.join(dir, 'evidence'),
      SHAPER_VALIDATE_BOOT_BUDGET: '3',
    };
    const out = await execFileP('bash', [
      RECIPE, 'inst-43', 'univ-demo-crm', 'demo-crm-nu', 'sha256:aa', 'A', 'demo',
    ], { env }).catch((e) => e);
    assert.equal(out.code, 1);
    assert.match(out.stdout, /never answered HTTP/);
    const podmanRan = fs.existsSync(path.join(dir, 'podman-calls'));
    assert.equal(podmanRan, false, 'no verdict was pronounced on a silent child');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
