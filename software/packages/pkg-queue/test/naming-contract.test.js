import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: docs/architecture/NAMING.md#naming-contract
// Intent: software/packages/pkg-logger/INTENT.md#identity

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SOFTWARE = path.join(REPO, 'software');
const NAMING = path.join(REPO, 'docs/architecture/NAMING.md');

const dirs = (relative) => fs.readdirSync(path.join(SOFTWARE, relative), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

test('V1.11 names every base artefact by its layer', () => {
  assert.ok(dirs('packages').every((name) => name.startsWith('pkg-')));
  assert.ok(dirs('bricks').every((name) => name.startsWith('brick-')));
  // An underscored directory is a mold, not a living universe: `_template`
  // seeded the convention, `_maker-template` follows it (one maker per
  // machine is stamped FROM it, and it belongs to no project).
  assert.ok(dirs('universes').every((name) => name.startsWith('univ-') || name.startsWith('_')));

  for (const directory of dirs('packages')) {
    const manifest = JSON.parse(fs.readFileSync(path.join(SOFTWARE, 'packages', directory, 'package.json'), 'utf8'));
    assert.equal(manifest.name, `@shaper/${directory}`, `${directory} publishes itself under another name`);
  }
});

// The prefix table is the contract every other test leans on. If a row is
// dropped from the page, the layer it named stops being enforceable anywhere.
test('the naming contract still declares every layer the repository uses', () => {
  const page = fs.readFileSync(NAMING, 'utf8');
  const BACKTICK = String.fromCharCode(96);
  for (const prefix of ['univ-', 'brick-', 'pkg-', 'img-', 'ctr-', 'vol-', 'cfg-', 'ctx-', 'task-', 'proof-']) {
    assert.ok(
      page.includes(BACKTICK + prefix + BACKTICK),
      `NAMING.md no longer declares the ${prefix} layer`,
    );
  }
});

// univ-base is what an agent is told to imitate, so what it contains is a promise.
test('univ-base is the five-brick base cell, and carries every file it declares', () => {
  const dir = path.join(SOFTWARE, 'universes/univ-base');
  const universe = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

  assert.equal(universe.universe, 'univ-base');
  assert.equal(universe.profile, 'agent');
  assert.deepEqual(Object.keys(universe.bricks).sort(), [
    'brick-bridge-opencode', 'brick-logger', 'brick-maestro', 'brick-queue', 'brick-vault',
  ]);

  for (const field of ['intent', 'agentDeploy', 'context', 'tasks', 'configuration', 'imageLock']) {
    const declared = universe[field];
    assert.ok(declared, `univ-base declares no ${field}`);
    assert.ok(
      fs.existsSync(path.join(dir, declared)),
      `univ-base declares ${field} → ${declared}, which does not exist`,
    );
  }
});

// The generic boundary, checked in the source rather than in the prose that
// claims it. Renaming `mailbox` to `label` is what V1.11 did; it left the mail
// model in place and the guard passed anyway, because the guard read words.
test('the generic base carries no mail-product behaviour', () => {
  const source = [
    'packages/pkg-agent-runtime/index.js',
    'packages/pkg-maestro/index.js',
    'packages/pkg-maestro/server.js',
    'packages/pkg-maestro/queue-beat.js',
    'packages/pkg-logger/events.js',
  ].map((rel) => fs.readFileSync(path.join(SOFTWARE, rel), 'utf8')).join('\n');

  for (const forbidden of ['imap', 'smtp', 'mailbox', 'mailHandler', 'podmail', 'registerPodMail']) {
    assert.doesNotMatch(source, new RegExp(forbidden, 'i'), `the base still speaks of ${forbidden}`);
  }
});

// A service announces itself on /api/health and /api/vitals, and the supervisor
// reads that name to decide what it is looking at. Until V1.11 four bricks
// announced `vault-v1`, `logger-v1`, `queue-v1` and `maestro-v1` — a version
// suffix frozen at v1 through eleven releases, and a layer the reader had to
// infer. Maestro was renamed and the other three were not, which is worse than
// leaving all four alone: the fleet then spoke two vocabularies at once.
test('every base service announces itself by its brick identity', () => {
  const offences = [];

  for (const packageName of dirs('packages')) {
    const dir = path.join(SOFTWARE, 'packages', packageName);
    for (const file of fs.readdirSync(dir).filter((f) => /\.[cm]?js$/.test(f))) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const match of text.matchAll(/service:\s*'([^']+)'/g)) {
        const announced = match[1];
        if (announced.startsWith('brick-')) continue;
        if (/^\$\{|^this\./.test(announced)) continue;
        offences.push(`${packageName}/${file}: announces "${announced}", not a brick- identity`);
      }
    }
  }

  assert.deepEqual(offences, [], `services announcing a name outside the contract:\n  ${offences.join('\n  ')}`);
});

// The README's opening diagram is the first thing anyone sees, and until V1.12
// it drew the cell as `pkg-auth` and `pkg-supervisor` with no bridge at all —
// two packages that are not bricks, and a missing brick that is the only thing
// in the cell able to spend work. It contradicted univ-base's own manifest for
// releases, in the most-read file of the repository.
test('the README draws the cell univ-base actually declares', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  const diagram = readme.slice(readme.indexOf('```mermaid'), readme.indexOf('```', readme.indexOf('```mermaid') + 10));
  assert.ok(diagram.length > 0, 'the README opens with no diagram');

  const universe = JSON.parse(fs.readFileSync(path.join(SOFTWARE, 'universes/univ-base/manifest.json'), 'utf8'));
  for (const brick of Object.keys(universe.bricks)) {
    // The bridge is drawn generically: a universe selects exactly one.
    const drawn = brick.startsWith('brick-bridge-') ? 'brick-bridge-' : brick;
    assert.ok(diagram.includes(drawn), `the README diagram omits ${brick}`);
  }

  for (const notABrick of ['pkg-auth<', 'pkg-supervisor<', 'brick-auth', 'brick-agent-runtime']) {
    assert.ok(!diagram.includes(notABrick), `the README diagram draws ${notABrick} as part of the cell`);
  }
});
