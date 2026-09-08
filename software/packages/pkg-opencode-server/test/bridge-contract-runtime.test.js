import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, '..');
const root = path.resolve(packageDir, '../..');

test('the OpenCode image carries and uses the provider-neutral bridge contract', () => {
  const server = fs.readFileSync(path.join(packageDir, 'server.mjs'), 'utf8');
  const containerfile = fs.readFileSync(
    path.join(root, 'bricks/brick-bridge-opencode/Containerfile'), 'utf8',
  );

  assert.match(server, /import \{ bridgeStatus \} from '\.\.\/pkg-bridge-contract\/index\.js'/);
  assert.match(server, /bridgeStatus\(\{/);
  assert.match(containerfile, /pkg-bridge-contract\/ \.\/pkg-bridge-contract\//);
});
