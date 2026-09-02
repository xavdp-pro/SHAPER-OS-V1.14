import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md#no-host-data-tree
// Intent: software/universes/README.md#materialise-before-mount
// Non-regression (Rule 29): the one-click LXC bootstrap and the guide beside
// it disagreed. The guide said "nothing to create by hand, no chmod 777" —
// /data/… are paths seen from inside the containers — while the script still
// ran `mkdir -p /data/{…}` and `chmod -R 777` on the host, seeded a journal
// under /data/workspaces/<author>/_kovzu/ that nothing reads, ran under
// `set -e` alone, and left the slug unquoted in every path. Found by the
// 2 September audit. Every check here fails on the unpatched script.

const SOFTWARE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(SOFTWARE, 'scripts/shaper-lxc-bootstrap.sh');
const text = fs.readFileSync(SCRIPT, 'utf8');
const code = text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

describe('the one-click LXC bootstrap does what its guide says', () => {
  it('parses, and runs under set -euo pipefail', () => {
    execFileSync('bash', ['-n', SCRIPT], { stdio: 'pipe' });
    assert.match(code, /^set -euo pipefail$/m, 'set -e alone lets an unset variable and a failed pipe stage pass silently');
  });

  it('creates nothing under /data on the host, and opens nothing to the world', () => {
    assert.doesNotMatch(code, /mkdir\s+(-p\s+)?\/data/, '/data/… is a container path; the deploy script creates what it mounts, under the universe');
    assert.doesNotMatch(code, /chmod\s+(-R\s+)?777/, 'world-writable directories that nothing uses');
    // The author's first name is deliberately NOT in this pattern: a tracked file
    // that spells the identifier it wants gone reintroduces it (Boot Contract 10b).
    assert.doesNotMatch(code, /\/data\/workspaces|_kovzu/, 'a host journal in workspaces named after the author — nothing in the repository reads it');
  });

  it('quotes the slug in every path it builds', () => {
    const unquoted = [];
    code.split('\n').forEach((line, index) => {
      let from = 0;
      for (;;) {
        const at = line.indexOf('${UNIV_SLUG}', from);
        if (at < 0) break;
        // Inside a double-quoted string iff an odd number of " precede it —
        // counted from the nearest `$(`, because a command substitution opens
        // a fresh quoting context: in `X="$(podman exec "${UNIV_SLUG}-x" …)"`
        // the inner pair is what quotes the slug, not the outer one.
        const context = line.slice(line.lastIndexOf('$(', at) + 1, at);
        const quotes = (context.match(/"/g) || []).length;
        if (quotes % 2 === 0) unquoted.push(`${index + 1}: ${line.trim()}`);
        from = at + 1;
      }
    });
    assert.deepEqual(unquoted, [], `slug expansions a space or a glob character would split:\n  ${unquoted.join('\n  ')}`);
  });

  it('halts when the universe does not exist instead of warning and carrying on', () => {
    assert.doesNotMatch(code, /check execution directory/, 'a warning that scrolls by, followed by four steps reporting on containers never born');
    assert.match(code, /not found[\s\S]{0,400}exit 1/, 'a missing universe must be a halt naming what to derive');
  });
});
