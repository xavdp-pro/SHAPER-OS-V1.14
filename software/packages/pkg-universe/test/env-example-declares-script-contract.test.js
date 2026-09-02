import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-12
// Intent: docs/architecture/ARTIFACT-BOUNDARY.md#registry-contract

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/**
 * A script that halts on a variable nobody documented is a wall, not a gate.
 *
 * Non-regression. The 2 September correction release made the backup and
 * registry scripts honest: push-images-to-registry.sh halts without
 * REGISTRY_HOST (or SHAPER_REGISTRY), REGISTRY_USER and REGISTRY_PASS
 * instead of defaulting to the author's network; backup-pra-sync.sh requires
 * PRA_ENCRYPTION_KEY and refuses it when it equals VAULT_MASTER_KEY;
 * backup-local.sh and snapshot-universe.sh dump only the database MYSQL_USER
 * declares, and say SKIP otherwise. None of that was written where the
 * operator reads which variables exist — KEYS-AND-ACCOUNTS.md and the two
 * example env files still listed the world before those scripts changed.
 *
 * The truth is read from the scripts, so this guard cannot document a
 * contract the code does not have; the examples must declare every variable
 * empty, because an example that carries a value is a value that ships.
 */
const CONTRACT = [
  { name: 'REGISTRY_HOST', scripts: ['push-images-to-registry.sh'] },
  { name: 'SHAPER_REGISTRY', scripts: ['push-images-to-registry.sh'] },
  { name: 'REGISTRY_USER', scripts: ['push-images-to-registry.sh'] },
  { name: 'REGISTRY_PASS', scripts: ['push-images-to-registry.sh'] },
  { name: 'PRA_ENCRYPTION_KEY', scripts: ['backup-pra-sync.sh'] },
  { name: 'PRA_DEST_HOST', scripts: ['backup-pra-sync.sh'] },
  { name: 'MYSQL_USER', scripts: ['backup-local.sh', 'snapshot-universe.sh'] },
  { name: 'MYSQL_PASSWORD', scripts: ['backup-local.sh', 'snapshot-universe.sh'] },
  { name: 'MYSQL_DATABASE', scripts: ['backup-local.sh', 'snapshot-universe.sh'] },
  { name: 'MYSQL_HOST', scripts: ['backup-local.sh', 'snapshot-universe.sh'] },
  { name: 'MYSQL_PORT', scripts: ['backup-local.sh', 'snapshot-universe.sh'] },
];

const EXAMPLES = ['software/.env.example', 'examples/universe.env.example'];
const KEYS = 'docs/human/KEYS-AND-ACCOUNTS.md';

test('every variable of the contract is one the named script really reads', () => {
  const fiction = [];
  for (const { name, scripts } of CONTRACT) {
    for (const script of scripts) {
      const code = read(`software/scripts/${script}`);
      if (!new RegExp(`\\$\\{?${name}\\b`).test(code)) fiction.push(`${script} does not read ${name}`);
    }
  }
  assert.deepEqual(fiction, [], `a documented contract the scripts do not have:\n  ${fiction.join('\n  ')}`);
});

test('the example env files declare every variable of the contract, and give none a value', () => {
  const missing = [];
  const shipped = [];
  const texts = EXAMPLES.map((rel) => [rel, read(rel)]);
  for (const { name } of CONTRACT) {
    const declared = texts.some(([, text]) => new RegExp(`^#?\\s*${name}=\\s*$`, 'm').test(text));
    if (!declared) missing.push(name);
    for (const [rel, text] of texts) {
      const valued = text.match(new RegExp(`^#?\\s*${name}=\\S.*$`, 'm'));
      if (valued) shipped.push(`${rel}: ${valued[0].trim()}`);
    }
  }
  assert.deepEqual(missing, [], `variables a shipped script halts on, or reads, that no example declares:\n  ${missing.join('\n  ')}`);
  assert.deepEqual(shipped, [], `an example that carries a value ships that value (Boot Contract 10b):\n  ${shipped.join('\n  ')}`);
});

test('KEYS-AND-ACCOUNTS names every variable, the refusal, and the SKIP', () => {
  const keys = read(KEYS);
  const unnamed = CONTRACT.map(({ name }) => name).filter((name) => !keys.includes(`\`${name}\``));
  assert.deepEqual(unnamed, [], `variables the key map does not know:\n  ${unnamed.join('\n  ')}`);
  const lines = keys.split('\n');
  assert.ok(
    lines.some((l) => l.includes('PRA_ENCRYPTION_KEY') && l.includes('VAULT_MASTER_KEY')),
    'the key map must say, on the PRA key\'s own line, that it is refused when it equals VAULT_MASTER_KEY',
  );
  assert.ok(
    lines.some((l) => l.includes('MYSQL_USER') && /SKIP/.test(l)),
    'the key map must say that without MYSQL_USER the backup scripts print SKIP and report the database as skipped',
  );
});

/**
 * The 2 September review found the key map sending the operator to files no
 * script reads: "values go in software/.env (or the universe's deploy/env)".
 * None of the four scripts sources either — a backup script does not execute
 * the operator's environment file — so a MYSQL_USER written into deploy/env
 * yielded SKIP, and a PRA key written into software/.env yielded the halt
 * that names it: a door that opens on nothing. The truth of the mechanism is
 * read from the scripts; the documents must state it.
 */
const SCRIPTS = ['backup-local.sh', 'snapshot-universe.sh', 'backup-pra-sync.sh', 'push-images-to-registry.sh'];
const SOURCES_ENV = /^\s*(source|\.)\s+\S*env\b|^\s*set -a\b/m;
const EXPORTED = /exported environment/;

test('the scripts read the exported environment, and every document says so instead of naming a file', () => {
  const sourcing = SCRIPTS.filter((s) => SOURCES_ENV.test(read(`software/scripts/${s}`)));
  assert.deepEqual(sourcing, [], `a backup or registry script that sources an env file — the documents describe a script that does not:\n  ${sourcing.join('\n  ')}`);
  const section = read(KEYS).split('## Backups and the registry')[1]?.split('\n---')[0] ?? '';
  assert.ok(section.length > 0, 'KEYS-AND-ACCOUNTS has lost its backup and registry section');
  assert.match(section, EXPORTED, 'the key map must say the scripts read the exported environment');
  assert.doesNotMatch(section, /[Vv]alues go in `software\/\.env`/, 'the key map sends the operator to a file no script reads');
  assert.match(section, /sources?\s+(no|neither|`software\/\.env`)/, 'the key map must say that no script sources an env file');
  for (const rel of EXAMPLES) {
    assert.match(read(rel), EXPORTED, `${rel} must say the scripts read the exported environment, not this file`);
  }
});
