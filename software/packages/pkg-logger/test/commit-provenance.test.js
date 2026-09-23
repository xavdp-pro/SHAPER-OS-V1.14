import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Every commit declares whether an agent contributed (Rule 2).
 *
 * Normal Git trailers are preferred. Some tools wrote a truthful declaration
 * into the commit body using literal newline escapes, so trailer placement is
 * not the provenance guarantee. The declaration and its contributor are.
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

const agentPrefix = /^(?:Co-Authored-By|Agent-Assisted-By):/i;
const agentDeclaration = /^(?:Co-Authored-By|Agent-Assisted-By):[ \t]+.+?[ \t]+<[^<>\s@]+@[^<>\s@]+>[ \t]*$/i;
const humanOnlyPrefix = /^No-Agent-Assistance:/i;
const humanOnlyDeclaration = /^No-Agent-Assistance:[ \t]*true[ \t]*$/i;

function hasValidAuthorship(message) {
  // Literal backslash-n separators occur in commits from some CLI adapters.
  const lines = message.replace(/\\r\\n|\\n/g, '\n').split(/\r?\n/).map((line) => line.trim());
  const agentLines = lines.filter((line) => agentPrefix.test(line));
  const humanOnlyLines = lines.filter((line) => humanOnlyPrefix.test(line));
  if (agentLines.some((line) => !agentDeclaration.test(line))) return false;
  if (humanOnlyLines.some((line) => !humanOnlyDeclaration.test(line))) return false;
  return (agentLines.length > 0) !== (humanOnlyLines.length > 0);
}

test('authorship declarations preserve provenance across supported message formats', () => {
  assert.equal(hasValidAuthorship('Change\n\nCo-Authored-By: Example Agent 1.0 <noreply@example.invalid>'), true);
  assert.equal(hasValidAuthorship('Change\\n\\nCo-Authored-By: Example Agent 1.0 <noreply@example.invalid>'), true);
  assert.equal(hasValidAuthorship('Change\n\nAgent-Assisted-By: Example Agent <noreply@example.invalid>'), true);
  assert.equal(hasValidAuthorship('Change\n\nNo-Agent-Assistance: true'), true);
  assert.equal(hasValidAuthorship('Change'), false);
  assert.equal(hasValidAuthorship('Change\n\nCo-Authored-By: unspecified'), false);
  assert.equal(hasValidAuthorship('Change\n\nNo-Agent-Assistance: true\nCo-Authored-By: Example Agent <noreply@example.invalid>'), false);
});

test('every commit since the rule declares agent involvement or human-only authorship', () => {
  let range;
  try {
    git('cat-file', '-e', `${RULE_STARTS_AFTER}^{commit}`);
    range = `${RULE_STARTS_AFTER}..HEAD`;
  } catch {
    return; // shallow clone or grafted history: nothing to check here
  }

  const raw = git('log', '--format=%H%x1f%s%x1f%B%x1e', range);
  const commits = raw.split('\x1e').map((c) => c.trim()).filter(Boolean);
  if (commits.length === 0) return;

  // v1.14.0–v1.14.2 release sealing commits on main predate agent trailers on tags.
  const releaseSeal = /^v\d+\.\d+\.\d+:/;
  const unsigned = commits
    .map((c) => c.split('\x1f'))
    .filter(([, subject, message]) => !releaseSeal.test(subject || '') && !hasValidAuthorship(message || ''))
    .map(([sha, subject]) => `${sha.slice(0, 7)}  ${subject}`);

  assert.deepEqual(
    unsigned,
    [],
    'These commits lack a valid authorship declaration (Rule 2). Use a '
    + 'Co-Authored-By or Agent-Assisted-By line with an identified contributor, '
    + 'or No-Agent-Assistance: true for a wholly human commit:\n  '
    + `${unsigned.join('\n  ')}\n`,
  );
});
