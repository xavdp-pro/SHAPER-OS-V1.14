import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * The frame is explicit; the code is the variable.
 *
 * `INTENT.md` §16 gives carte blanche on implementation and none on the frame,
 * and Rule 35 says a test constrains this implementation while an intent
 * constrains every future one — the two are required and are not substitutes.
 *
 * Nothing enforced that. A guard test could carry a hard-won invariant in a
 * comment and nowhere else, and the lesson would leave with the next rewrite of
 * the file. Four of V1.11's most expensive findings lived exactly like that:
 * they were discovered by building and deploying, and they were recorded only
 * where a refactor would erase them.
 *
 * So a guard names the intent it proves:
 *
 *     // Intent: docs/architecture/NAMING.md#generic-boundary
 *
 * and this test refuses a guard that names none, or that names one which does
 * not exist. It cannot check that the prose is *right* — that is a human's
 * judgement. It can guarantee that the prose exists, is reachable, and was
 * written at the same moment as the guard.
 */

/** A test that exists to prevent a defect, rather than to exercise a feature. */
const GUARD_MARKERS = /non-regression|Non-regression|until v1|Until V1|used to |had been|the defect this|guard that was missing|must not be allowed/;

const INTENT_REFERENCE = /^\s*\/\/\s*Intent:\s*(\S+?)(?:#(\S+))?\s*$/gm;

function testFiles(dir = path.join(REPO, 'software/packages'), found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(absolute, found);
    else if (entry.name.endsWith('.test.js')) found.push(absolute);
  }
  return found;
}

/** Anchors a markdown file offers: explicit <a id>, and headings by their slug. */
function anchorsOf(text) {
  const anchors = new Set();
  for (const m of text.matchAll(/<a\s+id="([^"]+)"/g)) anchors.add(m[1]);
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    anchors.add(m[1].toLowerCase()
      .replace(/[`*_[\]()]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim().replace(/\s+/g, '-'));
  }
  return anchors;
}

test('every guard names the intent it proves', () => {
  const orphans = [];

  for (const file of testFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    if (!GUARD_MARKERS.test(text)) continue;
    if (!/\/\/\s*Intent:/.test(text)) {
      orphans.push(`${path.relative(REPO, file)}: carries a lesson and names no intent`);
    }
  }

  assert.deepEqual(orphans, [], `lessons that live only in code:\n  ${orphans.join('\n  ')}`);
});

test('every intent a guard names exists, and offers the anchor it points at', () => {
  const broken = [];

  for (const file of testFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(INTENT_REFERENCE)) {
      const [, target, anchor] = match;
      const resolved = path.join(REPO, target);
      const where = path.relative(REPO, file);

      if (!fs.existsSync(resolved)) {
        broken.push(`${where} → ${target} does not exist`);
        continue;
      }
      if (anchor && !anchorsOf(fs.readFileSync(resolved, 'utf8')).has(anchor)) {
        broken.push(`${where} → ${target}#${anchor} — the file exists, the anchor does not`);
      }
    }
  }

  assert.deepEqual(broken, [], `intents named but not reachable:\n  ${broken.join('\n  ')}`);
});

test('every package and brick states an intent, and states something', () => {
  const thin = [];

  for (const kind of ['packages', 'bricks']) {
    const root = path.join(REPO, 'software', kind);
    for (const name of fs.readdirSync(root).filter((n) => fs.statSync(path.join(root, n)).isDirectory())) {
      const intent = path.join(root, name, 'INTENT.md');
      if (!fs.existsSync(intent)) {
        thin.push(`${kind}/${name}: no INTENT.md`);
        continue;
      }
      // An intent that says nothing is an intent nobody can build from.
      const body = fs.readFileSync(intent, 'utf8').split('\n')
        .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('>')).join(' ');
      if (body.length < 120) thin.push(`${kind}/${name}: INTENT.md is a stub (${body.length} chars of substance)`);
    }
  }

  assert.deepEqual(thin, [], `artefacts without a usable intent:\n  ${thin.join('\n  ')}`);
});

// The same rule, applied to what the repository ships as code. A script is
// implementation frozen in a repository whose doctrine says implementation is
// the variable — so it has to earn its place by naming the frame it serves.
//
// V1.12 found 51 of 61 scripts referenced by nothing at all: one-off debugging
// sessions, catalogue-specific tooling, and a genuine guard that lived in
// `scripts/` and was therefore never run by `npm test`. Thirty-four left the
// repository; the guard became a test. What remains points at an intent.
test('every script names the intent it materialises', () => {
  const dir = path.join(REPO, 'software/scripts');
  const orphans = [];
  const broken = [];

  // Everything the repository ships as executable code, wherever it sits: a
  // universe's deploy scripts are shipped code exactly like scripts/ is.
  const shipped = fs.readdirSync(dir)
    .filter((n) => /\.(sh|mjs|js|py)$/.test(n))
    .map((n) => [`scripts/${n}`, path.join(dir, n)]);

  const universes = path.join(REPO, 'software/universes');
  for (const universe of fs.readdirSync(universes)) {
    const deploy = path.join(universes, universe, 'deploy');
    if (!fs.existsSync(deploy)) continue;
    for (const n of fs.readdirSync(deploy).filter((f) => /\.(sh|mjs|js|py)$/.test(f))) {
      shipped.push([`universes/${universe}/deploy/${n}`, path.join(deploy, n)]);
    }
  }

  for (const [name, absolute] of shipped) {
    const text = fs.readFileSync(absolute, 'utf8');
    const match = text.match(/^(?:#|\/\/)\s*Intent:\s*(\S+?)(?:#(\S+))?\s*$/m);

    if (!match) {
      orphans.push(`${name}: names no intent`);
      continue;
    }
    const [, target, anchor] = match;
    const resolved = path.join(REPO, target);
    if (!fs.existsSync(resolved)) {
      broken.push(`${name} → ${target} does not exist`);
    } else if (anchor && !anchorsOf(fs.readFileSync(resolved, 'utf8')).has(anchor)) {
      broken.push(`${name} → ${target}#${anchor} — the file exists, the anchor does not`);
    }
  }

  assert.deepEqual(orphans, [], `scripts with no declared purpose:\n  ${orphans.join('\n  ')}`);
  assert.deepEqual(broken, [], `scripts naming an unreachable intent:\n  ${broken.join('\n  ')}`);
});
