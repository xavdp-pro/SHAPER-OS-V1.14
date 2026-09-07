import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveContextPath, resolveCheckpointPath } from '../task-paths.js';

/**
 * Both layouts are built on disk rather than mocked: the incident this test
 * guards was a wrong number of directory levels, and a mock that agrees with
 * the code about levels would have reproduced the bug faithfully and passed.
 */
let root, univBase, template, shaperRoot;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-paths-'));
  shaperRoot = path.join(root, 'software');

  // univ-base: the schedule sits at the universe root, beside its context file.
  univBase = path.join(shaperRoot, 'universes', 'univ-base');
  fs.mkdirSync(univBase, { recursive: true });
  fs.writeFileSync(path.join(univBase, 'task-schedule.json'), '{"tasks":[]}');
  fs.writeFileSync(path.join(univBase, 'ctx-base.md'), 'base context');

  // _template: the schedule sits one level down, in tasks/.
  template = path.join(shaperRoot, 'universes', '_template');
  fs.mkdirSync(path.join(template, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(template, 'context'), { recursive: true });
  fs.writeFileSync(path.join(template, 'tasks', 'task-schedule.json'), '{"tasks":[]}');
  fs.writeFileSync(path.join(template, 'context', 'ctx-universe.md'), 'universe context');
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe('resolving a task context file', () => {
  it('finds a context declared beside a schedule at the universe root', () => {
    const r = resolveContextPath('./ctx-base.md', {
      scheduleDir: univBase, shaperRoot,
    });
    assert.equal(r.found, true);
    assert.equal(r.path, path.join(univBase, 'ctx-base.md'));
    assert.equal(fs.readFileSync(r.path, 'utf8'), 'base context');
  });

  it('still finds a context one level above a schedule kept in tasks/', () => {
    const r = resolveContextPath('./context/ctx-universe.md', {
      scheduleDir: path.join(template, 'tasks'), shaperRoot,
    });
    assert.equal(r.found, true);
    assert.equal(r.path, path.join(template, 'context', 'ctx-universe.md'));
  });

  it('reproduces the container layout, where the universe is mounted at /data/univ', () => {
    // MAESTRO_TASKS_FILE=/data/univ/task-schedule.json — resolving two levels
    // up gave /data/ctx-base.md and skipped every beat as context_unreadable.
    const mount = path.join(root, 'data', 'univ');
    fs.mkdirSync(mount, { recursive: true });
    fs.writeFileSync(path.join(mount, 'task-schedule.json'), '{"tasks":[]}');
    fs.writeFileSync(path.join(mount, 'ctx-base.md'), 'base context');

    const r = resolveContextPath('./ctx-base.md', { scheduleDir: mount, shaperRoot });
    assert.equal(r.found, true);
    assert.equal(r.path, path.join(mount, 'ctx-base.md'));
  });

  it('leaves an absolute declaration untouched and reports whether it exists', () => {
    const absent = resolveContextPath('/nowhere/ctx.md', { scheduleDir: univBase, shaperRoot });
    assert.equal(absent.path, '/nowhere/ctx.md');
    assert.equal(absent.found, false);
  });

  it('names every place it looked when the file is nowhere', () => {
    const r = resolveContextPath('./absent.md', {
      scheduleDir: path.join(template, 'tasks'), shaperRoot,
    });
    assert.equal(r.found, false);
    assert.equal(r.tried.length, 3);
    assert.equal(r.path, path.join(template, 'tasks', 'absent.md'));
    for (const candidate of r.tried) assert.ok(path.isAbsolute(candidate));
  });
});

describe('resolving a task checkpoint file', () => {
  it('resolves beside the schedule even though the file does not exist yet', () => {
    const resolved = resolveCheckpointPath('./state/checkpoint.json', { scheduleDir: univBase });
    assert.equal(resolved, path.join(univBase, 'state', 'checkpoint.json'));
    assert.equal(fs.existsSync(resolved), false);
  });

  it('leaves an absolute checkpoint and an absent one alone', () => {
    assert.equal(resolveCheckpointPath('/data/univ/checkpoint.json', { scheduleDir: univBase }), '/data/univ/checkpoint.json');
    assert.equal(resolveCheckpointPath(null, { scheduleDir: univBase }), null);
  });
});
