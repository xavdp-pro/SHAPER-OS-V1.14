import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SOFTWARE = path.join(REPO, 'software');
const boundary = JSON.parse(fs.readFileSync(path.join(SOFTWARE, 'artifact-boundary.json'), 'utf8'));

const directories = (kind, prefix = '') => fs.readdirSync(path.join(SOFTWARE, kind), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
  .map((entry) => entry.name.slice(prefix.length)).sort();

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sourceFiles(absolute);
    return entry.name.endsWith('.js') || entry.name.endsWith('.mjs') ? [absolute] : [];
  });
}

function siblingImports(packageName) {
  const imports = new Set();
  for (const file of sourceFiles(path.join(SOFTWARE, 'packages', packageName))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"]\.\.\/([^/'"]+)/g)) {
      imports.add(match[1]);
    }
  }
  return [...imports];
}

test('artifact boundary exactly describes the shipped base', () => {
  assert.deepEqual([...boundary.base.packages].sort(), directories('packages'));
  assert.deepEqual([...boundary.base.bricks].sort(), directories('bricks', 'brick-'));
  assert.equal(new Set(boundary.base.packages).size, boundary.base.packages.length);
  assert.equal(new Set(boundary.base.bricks).size, boundary.base.bricks.length);
});

test('base source has no hidden catalogue import', () => {
  const catalogue = new Set(boundary.catalog.packages);
  const violations = boundary.base.packages.flatMap((name) => siblingImports(name)
    .filter((dependency) => catalogue.has(dependency))
    .map((dependency) => `${name} -> ${dependency}`));
  assert.deepEqual(violations, [], `base packages import catalogue source:\n${violations.join('\n')}`);
});

test('vault declares the packages copied from the pinned base artifact', () => {
  const brick = JSON.parse(fs.readFileSync(path.join(SOFTWARE, 'bricks/brick-vault/brick.json'), 'utf8'));
  const containerfile = fs.readFileSync(path.join(SOFTWARE, 'bricks/brick-vault/Containerfile'), 'utf8');
  assert.equal(brick.distribution, 'base');
  assert.deepEqual(brick.buildPackages, ['pkg-logger', 'pkg-vault']);
  assert.match(containerfile, /FROM \$\{SHAPER_BASE_IMAGE\} AS shaper_base/);
  for (const packageName of brick.buildPackages) {
    assert.match(containerfile, new RegExp(`/shaper/packages/${packageName}/`));
  }
  assert.doesNotMatch(containerfile, /COPY packages\//);
});
