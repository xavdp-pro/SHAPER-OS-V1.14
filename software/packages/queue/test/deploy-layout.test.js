import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const deployScript = new URL('../../../../examples/deploy/podman-up.sh', import.meta.url);

test('clean-sheet deploy creates queue persistence before mounting it', async () => {
  const script = await readFile(deployScript, 'utf8');
  const mkdir = script.indexOf('"$UNIV/sav/queue"');
  const mount = script.indexOf('-v "$UNIV/sav/queue:/sav/queue:Z"');

  assert.notEqual(mkdir, -1);
  assert.notEqual(mount, -1);
  assert.ok(mkdir < mount, 'queue persistence must be created before podman mounts it');
});
