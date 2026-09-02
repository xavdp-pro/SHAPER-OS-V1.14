import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: INTENT.md#one-canonical-copy

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const at = (rel) => path.join(REPO, rel);

/**
 * INTENT.md §14: no document exists twice in this repository. A text
 * reachable from two places has one canonical location and one reference
 * to it, because a corrected duplicate is worse than no duplicate.
 *
 * Non-regression. Two texts had been shipping twice. The manifesto lived as
 * `software/MANIFESTO.md` — the copy README.md, AGENTS.md and the doc index
 * cite — and again as `software/docs/SHAPER-OS-MANIFESTO.md`, identical but
 * for two link paths. The environment template lived as
 * `software/.env.example` — the record the key map and the script-contract
 * guard read — and again as `.env.example` at the root, which called itself
 * "Same as software/.env.example" and had drifted 69 lines behind it: the
 * bridge variables, the database, the PRA key and the registry account
 * were documented in one and absent from the other, so which copy an
 * operator opened decided what they learned. The guard is targeted, not
 * general: these two texts, one canonical copy each, and the other
 * location a pointer.
 */

test('the manifesto has one canonical copy, software/MANIFESTO.md', () => {
  const canonical = at('software/MANIFESTO.md');
  assert.ok(fs.existsSync(canonical), 'software/MANIFESTO.md is the copy README.md and AGENTS.md cite');
  assert.match(fs.readFileSync(canonical, 'utf8'), /^# SHAPER OS — The Foundational Manifesto/m);

  const shadow = at('software/docs/SHAPER-OS-MANIFESTO.md');
  if (!fs.existsSync(shadow)) return; // removed outright: also one copy
  const text = fs.readFileSync(shadow, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim());
  assert.ok(lines.length <= 3, `software/docs/SHAPER-OS-MANIFESTO.md is a second copy of the manifesto (${lines.length} lines), not a pointer to it`);
  assert.match(text, /\]\(\.\.\/MANIFESTO\.md\)/, 'the pointer must link the canonical copy');
});

test('the environment template has one canonical copy, software/.env.example', () => {
  const canonical = at('software/.env.example');
  assert.ok(fs.existsSync(canonical), 'software/.env.example is the record the key map reads');
  assert.equal(fs.lstatSync(canonical).isSymbolicLink(), false, 'the canonical copy is a real file');

  const root = at('.env.example');
  const stat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!stat) return; // removed outright: also one copy
  assert.ok(stat.isSymbolicLink(), '.env.example at the root is a second copy of software/.env.example, not a pointer to it — every documented `cp .env.example software/.env` must keep running as written, so the pointer is a symlink');
  assert.equal(fs.readlinkSync(root), 'software/.env.example', 'the root pointer must resolve to the canonical copy');
});
