import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: AGENTS.md#documentation-is-a-map

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function markdownFiles(dir = REPO, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(absolute, found);
    else if (entry.name.endsWith('.md')) found.push(absolute);
  }
  return found;
}

// Documentation is the agent's map. A link that resolves to nothing sends the
// reader looking for a file that does not exist, and it fails silently forever
// because nothing ever follows it. Two such links reached V1.11 from a global
// rename in V1.10 — `docs/agent/` had been rewritten to `docs/pkg-agent-runtime/`
// inside link targets, in two of the entry documents an agent is told to read.
test('every relative link between repository files resolves', () => {
  const pattern = /\[[^\]]*\]\(([^)\s#:]+\.(?:md|json|js|mjs|sh|yml|yaml))(?:#[^)]*)?\)/g;
  const broken = [];

  for (const file of markdownFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const target = match[1];
      if (target.startsWith('http')) continue;
      const resolved = path.resolve(path.dirname(file), target);
      if (!fs.existsSync(resolved)) {
        broken.push(`${path.relative(REPO, file)} → ${target}`);
      }
    }
  }

  assert.deepEqual(broken, [], `links that resolve to nothing:\n  ${broken.join('\n  ')}`);
});
