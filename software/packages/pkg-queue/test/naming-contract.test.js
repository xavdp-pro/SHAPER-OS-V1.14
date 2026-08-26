import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SOFTWARE = path.join(REPO, 'software');
const NAMING = path.join(REPO, 'docs/architecture/NAMING.md');

const dirs = (relative) => fs.readdirSync(path.join(SOFTWARE, relative), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

test('V1.11 names every base artefact by its layer', () => {
  assert.ok(dirs('packages').every((name) => name.startsWith('pkg-')));
  assert.ok(dirs('bricks').every((name) => name.startsWith('brick-')));
  assert.ok(dirs('universes').every((name) => name.startsWith('univ-') || name === '_template'));

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
