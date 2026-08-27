import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: INTENT.md
// Intent: software/RULES.md#rule-11

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPTS = path.join(REPO, 'software/scripts');

/**
 * A script that only runs on the machine it was written on is not a script.
 *
 * This guard used to live in `software/scripts/` as `test-scripts-portability.mjs`
 * — a test in the one directory `npm test` does not look at, so it had not run
 * in an unknown number of releases. It also scanned its own directory by
 * `__dirname`, which meant that moving it anywhere would silently change what
 * it examined. Both are the same mistake: a check whose target depends on where
 * the file happens to sit.
 */
const FORBIDDEN = [
  { what: 'a machine home path', re: new RegExp('/' + 'home/(?!neko\\b)') },
  { what: 'a personal desktop path', re: /\/Bureau\// },
  { what: 'a host-specific pool path', re: /\/thePool0\// },
  { what: 'a file:// URL rooted in a machine path', re: /file:\/\/\/(home|thePool|root|Bureau)/ },
  { what: 'an agent session uuid', re: /brain\/[0-9a-f-]{36}/ },
];

const scripts = () => fs.readdirSync(SCRIPTS)
  .filter((name) => /\.(sh|mjs|js)$/.test(name))
  .map((name) => [name, path.join(SCRIPTS, name)]);

test('no script carries a path that only exists on its author machine', () => {
  const found = [];

  for (const [name, absolute] of scripts()) {
    const text = fs.readFileSync(absolute, 'utf8');
    for (const { what, re } of FORBIDDEN) {
      const match = text.match(re);
      if (match) found.push(`${name}: ${what} — "${match[0]}"`);
    }
  }

  assert.deepEqual(found, [], `scripts that only run where they were written:\n  ${found.join('\n  ')}`);
});

test('every shipped script parses', () => {
  const broken = [];

  for (const [name, absolute] of scripts()) {
    try {
      if (name.endsWith('.sh')) execFileSync('bash', ['-n', absolute], { stdio: 'pipe' });
      else execFileSync(process.execPath, ['--check', absolute], { stdio: 'pipe' });
    } catch (err) {
      broken.push(`${name}: ${String(err.stderr || err.message).split('\n')[0]}`);
    }
  }

  assert.deepEqual(broken, [], `scripts that do not parse:\n  ${broken.join('\n  ')}`);
});
