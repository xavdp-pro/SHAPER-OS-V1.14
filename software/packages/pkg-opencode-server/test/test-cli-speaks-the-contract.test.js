import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-0-language-collaboration-protocol
// Intent: software/RULES.md#rule-29-constructive-integrity-every-fixed-bug-becomes-a-test

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(PKG, 'scripts/test-cli.sh'), 'utf8');
const server = fs.readFileSync(path.join(PKG, 'server.mjs'), 'utf8');

/**
 * The end-to-end script checks the bridge that ships beside it.
 *
 * Non-regression. `scripts/test-cli.sh` opened with a health check that
 * grepped `"service":"opencode-bridge"` while server.mjs has answered
 * `service: 'brick-bridge-opencode'` since the brick took its name — so the
 * script's first check failed against a healthy bridge and aborted the run
 * with "bridge unreachable". Nothing ran the script in CI (it needs a live
 * bridge), and the README kept describing what it checks. The script now
 * greps the name the server sends, and this guard reads both files so the
 * two cannot drift apart again. The same review translated the script
 * (Rule 0: technical text is English).
 */
test('test-cli.sh greps the service name server.mjs answers on /api/health', () => {
  const answered = /\/api\/health'\)\s*return send\(res, 200, \{[^}]*service:\s*'([^']+)'/.exec(server);
  assert.ok(answered, 'server.mjs answers /api/health with a service name');
  const grepped = /grep -q '"service":"([^"]+)"'/.exec(script);
  assert.ok(grepped, 'the script greps a service name on /api/health');
  assert.equal(grepped[1], answered[1], `the script expects "${grepped[1]}" and the bridge answers "${answered[1]}"`);
});

// Words the old script used that no English sentence contains. `abandon`
// is not among them: it is an English word too ("abandon the run"), and a
// Rule 0 guard that refuses English is a false red. The old script stays
// red on Santé, Registre, Résultat, attendu and reçu alone.
const FRENCH = /(^|[\s"(])(Santé|Registre|Continuité|Garde-fous|Résultat|attendu|reçu|manquant|modèle)\b/m;

test('test-cli.sh is written in English (Rule 0)', () => {
  const m = FRENCH.exec(script);
  assert.equal(m, null, `French in a technical text: "${m && m[2]}" — Rule 0 keeps the corpus readable by every agent that follows`);
});
