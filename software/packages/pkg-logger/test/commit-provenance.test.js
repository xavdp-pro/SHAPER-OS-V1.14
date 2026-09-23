import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/** Every commit declares whether an agent contributed (Rule 2). */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RULE_STARTS_AFTER = '9f7abe3';
// The one pre-existing malformed message is documented in doctrine/CONVERGENCE-STATE.md.
const HISTORICAL_EXCEPTION = '2ee0b84722e30de274369f1e976c7d0d17f4eba6';
const releaseSeal = /^v\d+\.\d+\.\d+:/;
const agentValue = /^.+?[ \t]+<[^<>\s@]+@[^<>\s@]+>$/;

function git(...args) {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function values(field) {
  return field.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function hasValidAuthorship(coAuthors, assisted, humanOnly) {
  const agents = [...values(coAuthors), ...values(assisted)];
  const humans = values(humanOnly);
  if (agents.some((value) => !agentValue.test(value))) return false;
  if (humans.some((value) => value !== 'true')) return false;
  return (agents.length > 0) !== (humans.length > 0);
}

function parsedMessageTrailers(message) {
  const parsed = execFileSync('git', ['interpret-trailers', '--parse'], {
    encoding: 'utf8', input: message,
  });
  const fields = { 'co-authored-by': [], 'agent-assisted-by': [], 'no-agent-assistance': [] };
  for (const line of parsed.split(/\r?\n/).filter(Boolean)) {
    const match = /^([^:]+):[ \t]*(.*)$/.exec(line);
    if (match && Object.hasOwn(fields, match[1].toLowerCase())) {
      fields[match[1].toLowerCase()].push(match[2]);
    }
  }
  return [fields['co-authored-by'].join('\n'), fields['agent-assisted-by'].join('\n'), fields['no-agent-assistance'].join('\n')];
}

test('only valid, non-contradictory Git trailers declare authorship', () => {
  const agent = 'Example Agent 1.0 <noreply@example.invalid>';
  assert.equal(hasValidAuthorship(...parsedMessageTrailers(`Change\n\nCo-Authored-By: ${agent}\n`)), true);
  assert.equal(hasValidAuthorship(...parsedMessageTrailers(`Change\n\nAgent-Assisted-By: ${agent}\n`)), true);
  assert.equal(hasValidAuthorship(...parsedMessageTrailers('Change\n\nNo-Agent-Assistance: true\n')), true);
  assert.equal(hasValidAuthorship(...parsedMessageTrailers(`Change\\n\\nCo-Authored-By: ${agent}\n`)), false);
  assert.equal(hasValidAuthorship(...parsedMessageTrailers(`Change\n\nQuoted example: "Co-Authored-By: ${agent}"\n\nMore work follows.\n`)), false);
  assert.equal(hasValidAuthorship(...parsedMessageTrailers('Change\n\nCo-Authored-By: unspecified\n')), false);
  assert.equal(hasValidAuthorship(...parsedMessageTrailers(`Change\n\nNo-Agent-Assistance: true\nCo-Authored-By: ${agent}\n`)), false);
});

test('every commit since the rule has a valid parsed authorship trailer', () => {
  let range;
  try {
    git('cat-file', '-e', `${RULE_STARTS_AFTER}^{commit}`);
    range = `${RULE_STARTS_AFTER}..HEAD`;
  } catch {
    return; // Shallow clone or grafted history: no complete range to check.
  }

  const format = '%H%x1f%s%x1f%(trailers:key=Co-Authored-By,valueonly)%x1f%(trailers:key=Agent-Assisted-By,valueonly)%x1f%(trailers:key=No-Agent-Assistance,valueonly)%x1e';
  const commits = git('log', `--format=${format}`, range)
    .split('\x1e').map((entry) => entry.replace(/^[\r\n]+|[\r\n]+$/g, '')).filter(Boolean);
  const unsigned = commits.map((entry) => entry.split('\x1f'))
    .filter(([sha, subject, coAuthors = '', assisted = '', humanOnly = '']) =>
      sha !== HISTORICAL_EXCEPTION && !releaseSeal.test(subject || '') &&
      !hasValidAuthorship(coAuthors, assisted, humanOnly))
    .map(([sha, subject]) => `${sha.slice(0, 7)}  ${subject}`);

  assert.deepEqual(unsigned, [],
    'These commits lack a valid Git-parsed authorship trailer (Rule 2):\n  '
    + `${unsigned.join('\n  ')}\n`);
});
