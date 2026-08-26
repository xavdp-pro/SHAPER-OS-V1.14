import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A commit made with an agent names both parties (Rule 2).
 *
 * The human is the author — they decided it. The agent is a Co-Authored-By
 * trailer carrying its engine and version. A repository whose doctrine rests on
 * provenance cannot keep a history that hides who wrote what: when a defect
 * surfaces months later, the first useful question is whether it came from a
 * human decision, an agent derivation, or a misunderstanding between the two.
 * That answer cannot be reconstructed afterwards.
 *
 * The rule applies from the commit that introduced it, never retroactively:
 * rewriting shared history to satisfy a new rule would break every clone, and
 * the operator has three.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Last commit written before the rule existed. Everything after it must comply. */
const RULE_STARTS_AFTER = '9f7abe3';

function git(...args) {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

test('every commit since the rule names the agent that helped write it', () => {
  let range;
  try {
    git('cat-file', '-e', `${RULE_STARTS_AFTER}^{commit}`);
    range = `${RULE_STARTS_AFTER}..HEAD`;
  } catch {
    return; // shallow clone or grafted history: nothing to check here
  }

  const raw = git('log', '--format=%H%x1f%s%x1f%(trailers:key=Co-Authored-By,valueonly)%x1e', range);
  const commits = raw.split('\x1e').map((c) => c.trim()).filter(Boolean);
  if (commits.length === 0) return;

  const unsigned = commits
    .map((c) => c.split('\x1f'))
    .filter(([, , trailer]) => !String(trailer || '').trim())
    .map(([sha, subject]) => `${sha.slice(0, 7)}  ${subject}`);

  assert.deepEqual(
    unsigned,
    [],
    'These commits do not say which agent helped write them (Rule 2). Add a '
    + 'trailer such as "Co-Authored-By: <engine and version> <noreply@vendor>" '
    + 'and amend:\n  ' + `${unsigned.join('\n  ')}\n`,
  );
});
