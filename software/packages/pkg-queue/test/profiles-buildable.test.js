import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Everything the profiles page calls buildable must be buildable.
 *
 * The page carries two tables: what exists, and where the product is going. The
 * second is useful — a vocabulary settles before its bricks exist. But the line
 * between them rots silently: an option gets added to the wrong table, an agent
 * is asked for it, raises the floor correctly and then stops at a brick that was
 * only ever a specification, having spent the operator's time.
 *
 * So the boundary is checked: every brick named under "Buildable today" or
 * "Available today" must exist as a brick directory or a package.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const PAGE = path.join(REPO, 'docs/architecture/UNIVERSE-PROFILES.md');

/** Names that are not SHAPER bricks: third-party images and in-process packages. */
const NOT_A_BRICK = new Set([
  'nginx/static', 'tunnel', 'cloudflared', 'vitals', 'manager-gateway',
  'supervisor', 'bridge', 'auth',
  // the profile vocabulary itself: floors and archetype aliases are not bricks
  'passive', 'agent', 'store', 'document-hub', 'fleet-manager', 'watchdog',
  'brochure', 'telephony-hub', 'field-service', 'accounting-vault', 'helpdesk',
  'booking-engine', 'academy',
]);

function existsAsBrickOrPackage(name) {
  const clean = name.replace(/^@shaper\//, '').replace(/^brick-/, '');
  return fs.existsSync(path.join(REPO, 'software/bricks', `brick-${clean}`))
    || fs.existsSync(path.join(REPO, 'software/packages', clean));
}

/** The sections that promise something deployable. */
function todaySections(text) {
  const out = [];
  const lines = text.split('\n');
  let capturing = false;
  for (const line of lines) {
    if (/^###\s/.test(line)) capturing = /With this repository alone|In this repository/i.test(line);
    else if (/^##\s/.test(line)) capturing = false;
    else if (capturing) out.push(line);
  }
  return out.join('\n');
}

test('bricks named as buildable today actually exist', () => {
  const text = fs.readFileSync(PAGE, 'utf8');
  const section = todaySections(text);
  assert.ok(section.length > 0, 'expected a "with this repository alone" section on the profiles page');

  const named = new Set();
  for (const m of section.matchAll(/`(?:@shaper\/)?(brick-[a-z0-9-]+|[a-z][a-z0-9-]*)`/g)) {
    named.add(m[1]);
  }

  const missing = [...named]
    .filter((n) => !NOT_A_BRICK.has(n) && !n.startsWith('+') && n.length > 2)
    .filter((n) => !existsAsBrickOrPackage(n));

  assert.deepEqual(
    missing.sort(),
    [],
    'The profiles page presents these as buildable today, and they do not exist. '
    + 'Move them under the catalogue or roadmap heading, or build them here:\n  ' + missing.join('\n  ') + '\n',
  );
});
