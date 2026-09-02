import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: docs/architecture/BRICKS.md#one-port-family

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * One stack, one port family.
 *
 * The core bricks answer on 8610 (vault), 8620 (logger), 8630 (maestro),
 * 8640 (queue) and 4440 (bridge, 4441 for its internal serve). That is the
 * family the doctrine states, the template manifest declares, and the nine
 * beta-campaign seals curled. Until V1.13 a second family — 85x0 and 434x —
 * survived in univ-base, the brick Containerfiles and quadlets, every
 * package's default port, the topology intent and the delivery script, and
 * one bootstrap script mixed the two on a single line. Beta finding F5 was the
 * consequence: the manifest said one family, the deploy script another, and
 * `test:live` failed exactly as documented. V1.13.1 made the template read the
 * manifest; it did not touch the half of the tree that still carried the old
 * numbers, so the next clean sheet built from a brick met the wall again.
 *
 * This guard walks the tracked tree and refuses any old-family port. It is a
 * lexical scan, so it looks only at numbers standing on their own — not inside
 * a hash, an identifier or a longer number — and it skips the dated proof
 * readings, which record what a past run saw and must not be rewritten.
 */

/** The retired family. Written as a pattern so this file does not trip itself. */
const OLD_FAMILY = /(?<![0-9A-Za-z_.])(?:85[1-4]0|434[01])(?![0-9A-Za-z])/g;

/** A line that carries this marker is an explicit fixture of the old family. */
const FIXTURE_MARKER = 'one-port-family: fixture';

/** Never scanned: version control, dependencies, dated proof readings. */
const SKIPPED_DIRS = new Set(['.git', 'node_modules']);
const SKIPPED_PATHS = [/^docs\/proof\//];

function textFiles(dir = REPO, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(REPO, absolute);
    if (SKIPPED_PATHS.some((re) => re.test(relative))) continue;
    if (entry.isDirectory()) { textFiles(absolute, found); continue; }
    if (!entry.isFile()) continue;
    const buffer = fs.readFileSync(absolute);
    if (buffer.subarray(0, 8192).includes(0)) continue; // binary, not prose or code
    found.push([relative, buffer.toString('utf8')]);
  }
  return found;
}

test('one port family: no 85x0 or 434x port survives outside the dated proofs', () => {
  const survivors = [];

  for (const [file, text] of textFiles()) {
    text.split('\n').forEach((line, index) => {
      if (line.includes(FIXTURE_MARKER)) return;
      const hits = line.match(OLD_FAMILY);
      if (hits) survivors.push(`${file}:${index + 1}: ${hits.join(', ')} — "${line.trim().slice(0, 80)}"`);
    });
  }

  assert.deepEqual(
    survivors,
    [],
    `the retired port family is still declared here (canonical: 8610/8620/8630/8640, 4440/4441):\n  ${survivors.join('\n  ')}`,
  );
});
