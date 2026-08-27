import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-36

/**
 * No document and no script may move a private key.
 *
 * The LXC deployment guide used to copy the host's private SSH key into the agent
 * container, while the matching public key sat in that same host's
 * authorized_keys — handing a container the key to its own host. A compromised
 * container would not have needed to escape: it already held the access.
 *
 * The correct direction is the opposite one, and it needs no arbitration about
 * who is Parent: whoever initiates the connection generates its own pair and
 * sends only its **public** key. Revoking then means deleting one line, instead
 * of rotating a key across everything that trusted it.
 *
 * Rule 36 · Rule 29 (a fixed defect ships its test).
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SKIP = new Set(['.git', 'node_modules', 'sav', 'dist', 'build', '.vite']);

/** A transfer verb followed by a private-key path that is not a .pub. */
const TRANSFER = /\b(?:podman\s+cp|docker\s+cp|lxc\s+file\s+push|scp|rsync|install|cp)\b[^\n]*?\b(id_[a-z0-9]+|[\w.-]+\.(?:pem|key))\b(?!\.pub)([^\n]*)/gi;

function tracked() {
  const out = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean).filter((rel) => {
    if (rel.split('/').some((p) => SKIP.has(p))) return false;
    return /\.(md|sh|mjs|js|cjs|yml|yaml)$/.test(rel);
  }).map((rel) => [rel, path.join(REPO, rel)]).filter(([, abs]) => fs.existsSync(abs));
}

test('no tracked file moves a private key', () => {
  const violations = [];
  for (const [rel, abs] of tracked()) {
    fs.readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
      // A line that only mentions the public counterpart is fine.
      if (/\.pub\b/.test(line) && !/id_[a-z0-9]+\s|id_[a-z0-9]+"/.test(line.replace(/\S*\.pub\S*/g, ''))) return;
      TRANSFER.lastIndex = 0;
      const m = TRANSFER.exec(line);
      if (m) violations.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(
    violations,
    [],
    'A private key is being transferred. Whoever initiates the connection '
    + 'generates its own pair; only the public key travels (Rule 36):\n  '
    + `${violations.join('\n  ')}\n`,
  );
});
