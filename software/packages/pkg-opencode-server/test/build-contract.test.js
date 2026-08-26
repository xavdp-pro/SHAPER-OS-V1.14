import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const buildScript = new URL('../../../scripts/build-brick-bridge-opencode.sh', import.meta.url);
const containerfile = new URL('../../../bricks/brick-bridge-opencode/Containerfile', import.meta.url);

test('bridge-opencode clean-sheet build acquires its pinned CLI inside the image', async () => {
  const [script, image] = await Promise.all([
    readFile(buildScript, 'utf8'),
    readFile(containerfile, 'utf8'),
  ]);

  assert.doesNotMatch(script, /OPENCODE_SOURCE|Missing opencode binary|bin\/opencode/);
  assert.match(image, /ARG OPENCODE_VERSION=\d+\.\d+\.\d+/);
  assert.match(image, /VERSION="\$\{OPENCODE_VERSION\}"/);
  assert.match(image, /opencode --version/);
});
