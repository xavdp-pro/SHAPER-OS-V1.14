import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/universes/_template/AGENT-DEPLOY.md
// Intent: docs/architecture/ARTIFACT-BOUNDARY.md#registry-contract
//
// Non-regression (Rule 29). scripts/build-all-bricks.sh read
// SHAPER_FORCE_REBUILD=1 as "build and push every image", whatever the
// registry already served: a clean-sheet run pointed at a published tag pushed
// over it, and every lock that pinned its digests named images the tag no
// longer served. Its probe also read "the registry did not answer" as "not
// published" and pushed. The script now asks every repository before it
// builds anything, and only a 404 lets a push happen — the fence the univ-base
// bootstrap already carries. The cases marked (fails unpatched) fail on the
// script before this change.
//
// The real script and the real image-name ladder run from a scratch copy of
// scripts/, whose build-*.sh are stubs that only record that they were called;
// the registry is an HTTP server of this process answering a status per
// repository.

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPOS = ['base', 'brick-vault', 'brick-logger', 'brick-queue', 'brick-maestro',
  'brick-bridge-opencode', 'brick-bridge-agy', 'brick-bridge-cursor', 'brick-bridge-deepseek'];
const TAG = 'v-test-1';

let server;
let registry;
const answers = new Map();      // repo -> HTTP status; unlisted repos answer 404
const asked = [];

before(async () => {
  server = http.createServer((req, res) => {
    const m = req.url.match(/^\/v2\/shaper\/([^/]+)\/manifests\/([^/]+)$/);
    if (!m) { res.statusCode = 400; res.end(); return; }
    asked.push(m[1]);
    res.statusCode = m[2] === TAG ? (answers.get(m[1]) ?? 404) : 404;
    res.end(res.statusCode === 200 ? '{}' : '');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  registry = `127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/** A scratch software/ whose build scripts record their call and do nothing else. */
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-all-bricks-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const f of ['build-all-bricks.sh', 'deploy-image-resolve.sh']) {
    fs.copyFileSync(path.join(SOFTWARE, 'scripts', f), path.join(dir, 'scripts', f));
  }
  const log = path.join(dir, 'built.log');
  const stub = (name) => fs.writeFileSync(path.join(dir, 'scripts', name),
    `#!/usr/bin/env bash\necho "${name.replace(/^build-|\.sh$/g, '').replace(/-image$/, '')}" >> "${log}"\n`);
  stub('build-base-image.sh');
  for (const repo of REPOS.slice(1)) stub(`build-${repo}.sh`);
  return { dir, log };
}

function run(env, { reachable = true } = {}) {
  const { dir, log } = scratch();
  asked.length = 0;
  const fullEnv = {
    ...process.env,
    SHAPER_REGISTRY: reachable ? registry : '127.0.0.1:1',
    SHAPER_IMAGE_TAG: TAG,
    SHAPER_TLS_VERIFY: 'false',
    ...env,
  };
  delete fullEnv.SHAPER_BASE_IMAGE;
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete fullEnv[k];
  return new Promise((resolve) => {
    execFile('bash', [path.join(dir, 'scripts/build-all-bricks.sh')], { env: fullEnv, encoding: 'utf8' }, (error, stdout, stderr) => {
      const built = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code: error ? error.code : 0, stdout, stderr, built, asked: [...asked] });
    });
  });
}

describe('build-all-bricks never pushes over a tag the registry already serves', () => {
  it('SHAPER_FORCE_REBUILD=1 on a served tag halts before anything is built (fails unpatched)', async () => {
    answers.clear();
    answers.set('brick-vault', 200);
    const r = await run({ SHAPER_FORCE_REBUILD: '1' });
    assert.notEqual(r.code, 0, 'a forced rebuild of a published tag must halt');
    assert.deepEqual(r.built, [], `nothing may be built or pushed, and ${r.built.join(', ')} was`);
    assert.match(r.stderr, /shaper\/brick-vault/, 'the halt names the repository the registry serves');
    assert.match(r.stderr, /never moved/);
    assert.match(r.stderr, /new SHAPER_IMAGE_TAG/i, 'the halt says what to do instead');
  });

  it('SHAPER_FORCE_REBUILD=1 on a tag the registry has never served builds every image', async () => {
    answers.clear();
    const r = await run({ SHAPER_FORCE_REBUILD: '1' });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.built, REPOS);
    assert.deepEqual([...new Set(r.asked)].sort(), [...REPOS].sort(), 'every repository is asked before the build');
  });

  it('a registry that does not answer halts, under SHAPER_FORCE_REBUILD=1 or not (fails unpatched)', async () => {
    for (const force of ['1', undefined]) {
      const r = await run({ SHAPER_FORCE_REBUILD: force }, { reachable: false });
      assert.notEqual(r.code, 0, `no answer is not "not published" (SHAPER_FORCE_REBUILD=${force})`);
      assert.deepEqual(r.built, []);
      assert.match(r.stderr, /cannot be told/);
    }
  });

  it('an answer other than 200 or 404 halts before anything is built (fails unpatched)', async () => {
    answers.clear();
    answers.set('brick-queue', 500);
    const r = await run({});
    assert.notEqual(r.code, 0);
    assert.deepEqual(r.built, []);
    assert.match(r.stderr, /brick-queue:v-test-1 \(HTTP 500\)/);
  });

  it('operating (no force): what the registry serves is reused, the rest is built', async () => {
    answers.clear();
    answers.set('base', 200);
    answers.set('brick-logger', 200);
    const r = await run({});
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.built, REPOS.filter((repo) => !['base', 'brick-logger'].includes(repo)));
    assert.match(r.stdout, /shaper\/base:v-test-1 already published — REUSED/);
  });

  it('SHAPER_PUSH=0 publishes nothing, so it builds every image without asking the registry', async () => {
    answers.clear();
    const r = await run({ SHAPER_PUSH: '0', SHAPER_FORCE_REBUILD: '1' }, { reachable: false });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.built, REPOS);
    assert.deepEqual(r.asked, []);
  });
});
