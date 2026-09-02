import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: docs/architecture/ARTIFACT-BOUNDARY.md#layer-earned
// Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
// Intent: docs/architecture/NAMING.md#naming-contract
// Intent: software/universes/README.md#materialise-before-mount
// Non-regression (Rule 29): the scripts that scaffold code are implementation
// of the frame, or they are nothing (INTENT.md §16). Until the 2 September
// audit shaper-tool-scaffold.mjs wrote packages/<slug>-engine (no such layer
// in NAMING.md), created data/<slug> on the host and bind-mounted it (the
// shared host tree abandoned in V1.13.1), pinned localhost/…:latest in the
// unit, copied the package from the build context, and shipped a test that
// asserted true === true; univ-factory.mjs wrote apps/<univ> and quadlet/ —
// directories the base does not have — and was run by nothing. The factory
// left; the scaffold now produces what the base's own guards accept, and is
// proven by RUNNING it in a throwaway class-shaped tree and then running the
// test it generated. Every case here fails on the unpatched scripts.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOFTWARE = path.resolve(HERE, '../../..');
const SCAFFOLD = path.join(SOFTWARE, 'scripts/shaper-tool-scaffold.mjs');

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-')); });
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** A throwaway tree shaped like a class repository: scripts/ holding a copy of the scaffold, and nothing else. */
function classRepo(name, extraFiles = {}) {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(SCAFFOLD, path.join(root, 'scripts/shaper-tool-scaffold.mjs'));
  for (const [rel, content] of Object.entries(extraFiles)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const scaffold = (root, args) => spawnSync(process.execPath, ['scripts/shaper-tool-scaffold.mjs', 'create', ...args], { cwd: root, encoding: 'utf8' });

describe('the tool scaffold writes the layers the naming contract knows, and nothing on the host', () => {
  let root; let run;
  before(() => {
    root = classRepo('class');
    run = scaffold(root, ['--slug', 'demo', '--name', 'Demo', '--desc', 'A demo tool', '--port', '8999']);
  });

  it('runs, and names the package by its layer', () => {
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/pkg-demo/package.json'), 'utf8'));
    assert.equal(manifest.name, '@shaper/pkg-demo');
    assert.equal(fs.existsSync(path.join(root, 'packages/demo-engine')), false, '<slug>-engine is not a layer NAMING.md declares');
  });

  it('creates no state directory on the host, and mounts none', () => {
    assert.equal(fs.existsSync(path.join(root, 'data')), false, 'state lives in a volume the universe owns, created by the deploy that mounts it');
    const units = fs.readdirSync(path.join(root, 'bricks/brick-demo')).filter((f) => f.endsWith('.container'));
    assert.equal(units.length, 1, 'every brick ships exactly one Quadlet unit');
    const unit = fs.readFileSync(path.join(root, 'bricks/brick-demo', units[0]), 'utf8');
    for (const volume of unit.split('\n').filter((l) => l.startsWith('Volume='))) {
      assert.doesNotMatch(volume, /^Volume=\//, `a host path bind: ${volume}`);
      assert.match(volume, /^Volume=vol-%i-/, `a volume the universe does not own: ${volume}`);
    }
    assert.match(unit, /^ContainerName=%i-ctr-demo$/m);
    const image = unit.split('\n').find((l) => l.startsWith('Image='));
    assert.equal(image, 'Image=@IMG@', 'the image is written by the universe from its lock, never a tag');
  });

  it('builds the brick the way the boundary demands: pinned source image, brick-only context', () => {
    const containerfile = fs.readFileSync(path.join(root, 'bricks/brick-demo/Containerfile'), 'utf8');
    assert.match(containerfile, /FROM \$\{SHAPER_BASE_IMAGE\} AS shaper_base/);
    assert.match(containerfile, /COPY --from=shaper_base \/shaper\/packages\/pkg-demo\/ \.\//);
    assert.doesNotMatch(containerfile, /COPY packages\//, 'a dependency satisfied by filesystem adjacency');
    const declared = JSON.parse(fs.readFileSync(path.join(root, 'bricks/brick-demo/brick.json'), 'utf8'));
    assert.equal(declared.brick, 'demo');
    assert.deepEqual(declared.buildPackages, ['pkg-demo']);
    assert.equal(fs.existsSync(path.join(root, 'topology.json')), false, 'the scaffold does not write the base topology');
  });

  it('ships a test that binds a socket — and that test passes on what was generated', () => {
    const generated = fs.readFileSync(path.join(root, 'packages/pkg-demo/test/demo.test.js'), 'utf8');
    assert.doesNotMatch(generated, /assert\.equal\(true,\s*true\)/, 'a test that asserts true === true is a green light for nothing (Rule 0G)');
    // A nested `node --test` inherits NODE_TEST_CONTEXT from this runner and
    // switches to the serialised reporter; asking for TAP keeps stdout legible.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout', 'packages/pkg-demo/test/demo.test.js'], { cwd: root, encoding: 'utf8', env });
    assert.equal(result.status, 0, `the generated test must pass on the generated brick:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^# pass 1$/m);
  });

  it('halts inside the base instead of adding a brick the boundary will refuse', () => {
    const base = classRepo('base', { 'artifact-boundary.json': JSON.stringify({ contractVersion: 2, base: { packages: [], bricks: ['brick-vault'] } }) });
    const out = scaffold(base, ['--slug', 'demo']);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /HALT/);
    assert.match(out.stderr, /artifact-boundary\.json/);
    assert.equal(fs.existsSync(path.join(base, 'bricks')), false, 'nothing may be written before the halt');
  });

  it('halts on a boundary file that is present but unreadable, instead of scaffolding past it', () => {
    // The first version of the guard above swallowed the parse error and
    // returned — the scaffold then wrote into the base it was refusing.
    const base = classRepo('base-truncated', { 'artifact-boundary.json': '{' });
    const out = scaffold(base, ['--slug', 'demo']);
    assert.notEqual(out.status, 0, 'an unreadable boundary must halt, not fall through (Rule 0J)');
    assert.match(out.stderr, /HALT/);
    assert.match(out.stderr, /artifact-boundary\.json.*unreadable/);
    assert.equal(fs.existsSync(path.join(base, 'bricks')), false, 'nothing may be written before the halt');
  });
});

describe('no shipped script materialises a tree the base does not have', () => {
  it('names neither apps/ nor quadlet/ as a target', () => {
    const dir = path.join(SOFTWARE, 'scripts');
    const found = [];
    for (const name of fs.readdirSync(dir).filter((n) => /\.(sh|mjs|js|py)$/.test(n))) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      const hit = text.match(/['"`/]apps\/|['"]apps['"]|quadlet\//);
      if (hit) found.push(`${name}: "${hit[0]}"`);
    }
    assert.deepEqual(found, [], `scripts writing into directories that do not exist in this repository:\n  ${found.join('\n  ')}`);
  });
});
