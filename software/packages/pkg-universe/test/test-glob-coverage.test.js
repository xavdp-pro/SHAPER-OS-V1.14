import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: INTENT.md#no-orphan-lesson

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SOFTWARE = path.join(REPO, 'software');

/**
 * A test nobody runs is a test that does not exist.
 *
 * `npm test` is one glob in `software/package.json`. Until V1.13.2 three test
 * files of `pkg-opencode-server` sat at the package root as `*.test.mjs`,
 * outside that glob, and had been green for nobody: the package's own
 * `npm test` reached them, the repository's did not, and the repository's is
 * the one every gate runs. V1.12 had already met the same shape once — a
 * genuine guard living in `scripts/`, where `npm test` never looked — and
 * fixed the instance, not the class.
 *
 * So this guard reads the glob from `package.json` (not a copy of it: a copy
 * would drift the same way) and refuses any file that looks like a test and
 * is not reached by it. The fix is always to move the file, never to widen
 * the glob to whatever happens to be on disk.
 */

/** The glob `npm test` actually runs, read from the script itself. */
function npmTestGlob() {
  const pkg = JSON.parse(fs.readFileSync(path.join(SOFTWARE, 'package.json'), 'utf8'));
  const script = pkg.scripts && pkg.scripts.test;
  assert.ok(script, 'software/package.json declares no "test" script');
  const match = script.match(/node --test\s+(\S+)/);
  assert.ok(match, `cannot read a glob out of the test script: "${script}"`);
  return match[1];
}

/** The subset of glob syntax package.json uses: `*` within one path segment. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/** Every file under software/packages that presents itself as a test. */
function testLikeFiles(dir = path.join(SOFTWARE, 'packages'), found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) testLikeFiles(absolute, found);
    else if (/\.test\.[cm]?js$/.test(entry.name)) found.push(path.relative(SOFTWARE, absolute));
  }
  return found;
}

test('every test file under packages/ is reached by the npm test glob', () => {
  const glob = npmTestGlob();
  const reached = globToRegExp(glob);
  const files = testLikeFiles();

  assert.ok(files.length > 0, 'no test files found under software/packages — the walk is wrong');
  assert.ok(files.some((f) => reached.test(f)), `the glob "${glob}" reaches no test file at all`);

  const orphans = files.filter((f) => !reached.test(f));
  assert.deepEqual(
    orphans,
    [],
    `test files "npm test" never runs (glob is "${glob}"; move them to packages/<pkg>/test/ and name them *.test.js — the packages are ESM, so .js is the module form; do not widen the glob):\n  ${orphans.join('\n  ')}`,
  );
});
