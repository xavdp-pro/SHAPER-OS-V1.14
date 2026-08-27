import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
// Intent: docs/architecture/ARTIFACT-BOUNDARY.md#layer-earned
// Intent: software/packages/pkg-logger/INTENT.md#sibling-paths

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SOFTWARE = path.join(REPO, 'software');
const boundary = JSON.parse(fs.readFileSync(path.join(SOFTWARE, 'artifact-boundary.json'), 'utf8'));

// V1.11: the boundary names artefacts by their full layer identity — `pkg-vault`,
// `brick-vault` — never by a bare component name the reader has to place.
const directories = (kind, prefix = '') => fs.readdirSync(path.join(SOFTWARE, kind), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
  .map((entry) => entry.name).sort();

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

test('every brick is buildable, and declares what it is built from', () => {
  const bricks = directories('bricks', 'brick-');
  assert.ok(bricks.length > 0);

  for (const brick of bricks) {
    const dir = path.join(SOFTWARE, 'bricks', brick);

    // A `brick-` directory is an OCI service definition (docs/architecture/NAMING.md).
    // Until V1.11 two of them shipped an INTENT and a Quadlet unit but no
    // Containerfile: nothing could build them, and an agent reading the tree
    // planned containers that would never exist. The layer now has to be earned.
    assert.ok(
      fs.existsSync(path.join(dir, 'Containerfile')),
      `${brick} carries the brick- prefix but no Containerfile — it is a package, not a brick`,
    );
    assert.ok(
      fs.existsSync(path.join(dir, 'brick.json')),
      `${brick} does not declare what it is built from`,
    );

    const declared = JSON.parse(fs.readFileSync(path.join(dir, 'brick.json'), 'utf8'));
    const containerfile = fs.readFileSync(path.join(dir, 'Containerfile'), 'utf8');

    assert.equal(declared.brick, brick.replace(/^brick-/, ''));
    assert.equal(declared.distribution, 'base');
    assert.ok(Array.isArray(declared.buildPackages) && declared.buildPackages.length > 0);

    for (const packageName of declared.buildPackages) {
      assert.ok(
        boundary.base.packages.includes(packageName),
        `${brick} builds from ${packageName}, which the base does not ship`,
      );
      assert.match(
        containerfile,
        new RegExp(`/shaper/packages/${packageName}/`),
        `${brick} declares ${packageName} but never copies it from the base image`,
      );
    }

    // The dependency becomes physical inside the image being built, and nowhere
    // else. A `COPY packages/` would satisfy it by filesystem adjacency instead
    // — which is how `software/.env` used to reach every build context.
    assert.match(containerfile, /FROM \$\{SHAPER_BASE_IMAGE\} AS shaper_base/, `${brick} does not build from the pinned base image`);
    assert.doesNotMatch(containerfile, /COPY packages\//, `${brick} still reads packages from the build context`);
  }
});

test('no build script publishes a mutable tag', () => {
  const scripts = fs.readdirSync(path.join(SOFTWARE, 'scripts'))
    .filter((name) => /^build-(brick-|base-image|all-bricks)/.test(name));
  assert.ok(scripts.length > 0);

  for (const name of scripts) {
    const text = fs.readFileSync(path.join(SOFTWARE, 'scripts', name), 'utf8');
    assert.doesNotMatch(text, /-t\s+\S*:latest/, `${name} tags an image :latest, which cfg-image-lock.json forbids`);
    assert.match(text, /SHAPER_IMAGE_TAG:\?/, `${name} does not demand an explicit image tag`);
  }
});

test('no Quadlet unit pins a mutable image tag', () => {
  const units = [];
  for (const brick of directories('bricks', 'brick-')) {
    const dir = path.join(SOFTWARE, 'bricks', brick);
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.container'))) {
      units.push([`${brick}/${name}`, fs.readFileSync(path.join(dir, name), 'utf8')]);
    }
  }
  assert.equal(units.length, directories('bricks', 'brick-').length, 'every brick ships exactly one Quadlet unit');

  for (const [where, text] of units) {
    const image = text.split('\n').find((line) => line.startsWith('Image='));
    assert.ok(image, `${where} declares no image`);
    assert.doesNotMatch(image, /:latest\s*$/, `${where} pins :latest, which cfg-image-lock.json forbids`);
  }
});

// The guard that was missing, and its cost: V1.10 renamed the packages to
// `pkg-*`, which changed every sibling import to `../pkg-logger/…`, while the
// COPY that placed the logger kept writing it to `/logger/`. Every image built
// that way threw `Cannot find module '/pkg-logger/vitals.js'` the first time it
// imported anything — and the test above passed throughout, because it only
// checked that the Containerfile *mentioned* the package, never where it put it.
test('a package is copied to the path its importers actually resolve', () => {
  const problems = [];

  for (const brick of directories('bricks', 'brick-')) {
    const dir = path.join(SOFTWARE, 'bricks', brick);
    const containerfile = fs.readFileSync(path.join(dir, 'Containerfile'), 'utf8');
    const declared = JSON.parse(fs.readFileSync(path.join(dir, 'brick.json'), 'utf8'));

    // Which package is flattened into WORKDIR — its siblings resolve from there.
    const flattened = declared.buildPackages.find((name) => new RegExp(`/shaper/packages/${name}/ \\./?$`, 'm').test(containerfile));
    if (!flattened) continue;

    const siblings = new Set();
    const packageDir = path.join(SOFTWARE, 'packages', flattened);
    const scan = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'test' || entry.name === 'node_modules') continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) { scan(absolute); continue; }
        if (!/\.[cm]?js$/.test(entry.name)) continue;
        for (const m of fs.readFileSync(absolute, 'utf8').matchAll(/from\s+['"]\.\.\/([^/'"]+)\//g)) siblings.add(m[1]);
      }
    };
    scan(packageDir);

    for (const sibling of siblings) {
      // A flattened package at /app resolves `../<name>/` to `/<name>/`.
      const expected = new RegExp(`COPY --from=shaper_base /shaper/packages/${sibling}/ /${sibling}/`);
      if (!expected.test(containerfile)) {
        problems.push(`${brick}: ${flattened} imports ../${sibling}/, which must be copied to /${sibling}/`);
      }
    }
  }

  assert.deepEqual(problems, [], `images whose imports will not resolve at runtime:\n  ${problems.join('\n  ')}`);
});
