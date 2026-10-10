#!/usr/bin/env node
// Intent: software/runtime/unit-mariadb/INTENT.md
/**
 * Build-time self-check of a unit image, run as the last build step: the
 * image refuses to exist when it would refuse to start. Checks what the
 * supervisor relies on — accounts, layout, engine binaries, the declared
 * schema version — and that the application's own imports resolve from where
 * the image put them (the logger contract's "test the actual import").
 *
 *   UNIT_IMPORT_CHECK="<module> [<module> …]"  absolute modules to import
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertProtectedFrom, readConfig, resolveAccounts, writableBy } from './lib.mjs';

const problems = [];
const ok = [];
const note = (good, message) => (good ? ok : problems).push(message);

const config = readConfig(process.env);
const accounts = resolveAccounts(config, fs.readFileSync('/etc/passwd', 'utf8'), fs.readFileSync('/etc/group', 'utf8'));
note(true, `accounts: ${config.slug}=${accounts.app.uid}, mysql=${accounts.engine.uid}`);

for (const binary of ['mariadbd', 'mariadb-install-db', 'mariadb', 'mariadb-dump', 'mariadb-admin']) {
  const found = ['/usr/bin', '/usr/sbin', '/bin', '/sbin'].some((dir) => fs.existsSync(path.join(dir, binary)));
  note(found, `engine binary ${binary}${found ? '' : ' is missing'}`);
}
note(fs.existsSync('/sbin/tini'), '/sbin/tini (container init)');

// The declared exact schema version is the one the schema file records.
const schema = fs.readFileSync(config.schemaFile, 'utf8');
const recorded = new RegExp(`INSERT INTO schema_meta \\(unit, version\\) VALUES \\('${config.slug}', (\\d+)\\)`).exec(schema);
note(recorded && Number(recorded[1]) === config.schemaVersion,
  `schema ${config.schemaFile} records version ${recorded ? recorded[1] : 'none'}; the image declares ${config.schemaVersion}`);

// The application code is read-only to the application account.
const writable = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const stat = fs.lstatSync(full);
    if (!stat.isSymbolicLink() && writableBy(stat, accounts.app)) writable.push(full);
    if (entry.isDirectory()) walk(full);
  }
}(config.paths.app));
note(writable.length === 0, `application code under ${config.paths.app} ${writable.length ? `is writable by ${config.slug}: ${writable.slice(0, 5).join(', ')}` : 'is read-only to the unit account'}`);

for (const [target, what] of [
  [config.schemaFile, 'schema'],
  [config.paths.app, 'application code'],
  [path.dirname(new URL(import.meta.url).pathname), 'administrative runtime'],
  ['/etc/my.cnf.d', 'administrative configuration'],
]) {
  try {
    assertProtectedFrom(target, accounts.app, { what });
    note(true, `${what} ${target} protected from ${config.slug}`);
  } catch (err) {
    note(false, err.message);
  }
}

const client = fs.readFileSync('/etc/my.cnf.d/zz-shaper-unit.cnf', 'utf8');
note(client.includes(`socket=${config.paths.socket}`), `the root client defaults to ${config.paths.socket}`);

for (const module of (process.env.UNIT_IMPORT_CHECK || '').split(/\s+/).filter(Boolean)) {
  try {
    await import(pathToFileURL(module).href);
    note(true, `import ${module}`);
  } catch (err) {
    note(false, `import ${module} failed: ${err.code || ''} ${err.message}`);
  }
}
const pkgDb = path.join(config.paths.app, 'packages/pkg-db/pool.js');
try {
  createRequire(pkgDb).resolve('mysql2/promise');
  note(true, 'mysql2 resolves from pkg-db');
} catch (err) {
  note(false, `mysql2 does not resolve from ${pkgDb}: ${err.message}`);
}

for (const line of ok) process.stdout.write(`[image-check] ok   ${line}\n`);
for (const line of problems) process.stdout.write(`[image-check] FAIL ${line}\n`);
process.exit(problems.length ? 1 : 0);
