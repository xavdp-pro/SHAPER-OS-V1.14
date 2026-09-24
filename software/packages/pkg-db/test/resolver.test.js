import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertFunctionalSlug,
  passwdFilePath,
  readPasswdFile,
  resolveUnitDbConfig,
  UnitDbError,
} from '../index.js';

// Intent: software/packages/pkg-db/INTENT.md

const uid = process.getuid();
let root;

function writePasswd(slug, content, mode) {
  const file = passwdFilePath(slug, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fs.chmodSync(file, mode);
  return file;
}

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof UnitDbError, `expected UnitDbError, got ${err}`);
    return err.code;
  }
  assert.fail('expected a refusal');
}

before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-db-')); });
after(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('one name everywhere', () => {
  it('accepts the base unit slugs', () => {
    for (const slug of ['vault', 'logger', 'queue', 'maestro', 'crm_app']) {
      assert.equal(assertFunctionalSlug(slug), slug);
    }
  });

  it('refuses a slug that is not an account and a database name at once', () => {
    for (const slug of ['', 'Vault', '1vault', 'my-app', 'a'.repeat(33), 'vault;drop', null]) {
      assert.equal(codeOf(() => assertFunctionalSlug(slug)), 'INVALID_SLUG', String(slug));
    }
  });

  it('refuses MYSQL_USER or MYSQL_DATABASE that differ from the slug', () => {
    writePasswd('queue', 'secret-queue\n', 0o600);
    for (const name of ['MYSQL_USER', 'MYSQL_DATABASE']) {
      const env = { [name]: 'queue_db' };
      assert.equal(codeOf(() => resolveUnitDbConfig({ slug: 'queue', appsRoot: root, env })), 'IDENTITY_MISMATCH');
    }
  });

  it('resolves user, database and slug to the same name', () => {
    writePasswd('logger', 'secret-logger\n', 0o600);
    const cfg = resolveUnitDbConfig({ slug: 'logger', appsRoot: root, env: {} });
    assert.equal(cfg.user, 'logger');
    assert.equal(cfg.database, 'logger');
    assert.equal(cfg.password, 'secret-logger');
    assert.equal(cfg.passwordSource, 'passwd-file');
    assert.equal(cfg.socketPath, '/run/mysqld/mysqld.sock');
    assert.equal(cfg.passwdFile, path.join(root, 'logger/etc/mysql/localhost/passwd'));
  });

  it('takes the socket path from SHAPER_DB_SOCKET', () => {
    writePasswd('maestro', 'secret-maestro', 0o600);
    const cfg = resolveUnitDbConfig({ slug: 'maestro', appsRoot: root, env: { SHAPER_DB_SOCKET: '/run/x.sock' } });
    assert.equal(cfg.socketPath, '/run/x.sock');
  });
});

describe('the password file is private', () => {
  it('refuses a file readable by the group or others', () => {
    for (const mode of [0o640, 0o644, 0o604, 0o660]) {
      const file = writePasswd('vault', 'secret', mode);
      assert.equal(codeOf(() => readPasswdFile(file, { expectedUid: uid })), 'PASSWD_MODE', mode.toString(8));
    }
  });

  it('refuses a file owned by another uid', () => {
    const file = writePasswd('vault', 'secret', 0o600);
    assert.equal(codeOf(() => readPasswdFile(file, { expectedUid: uid + 1 })), 'PASSWD_OWNER');
  });

  it('refuses an empty file', () => {
    const file = writePasswd('vault', '\n', 0o600);
    assert.equal(codeOf(() => readPasswdFile(file, { expectedUid: uid })), 'PASSWD_EMPTY');
  });

  it('reports an absent file as absent', () => {
    assert.equal(codeOf(() => resolveUnitDbConfig({ slug: 'absent', appsRoot: root, env: {} })), 'PASSWD_MISSING');
  });
});

describe('the DEV fallback announces itself', () => {
  it('is refused unless asked for', () => {
    assert.equal(
      codeOf(() => resolveUnitDbConfig({ slug: 'devonly', appsRoot: root, env: { MYSQL_PASSWORD: 'x' } })),
      'PASSWD_MISSING',
    );
  });

  it('is marked when used', () => {
    const cfg = resolveUnitDbConfig({ slug: 'devonly', appsRoot: root, env: { MYSQL_PASSWORD: 'x' }, allowDevFallback: true });
    assert.equal(cfg.passwordSource, 'env-dev-fallback');
  });

  it('never wins over an existing passwd file', () => {
    writePasswd('both', 'from-file', 0o600);
    const cfg = resolveUnitDbConfig({ slug: 'both', appsRoot: root, env: { MYSQL_PASSWORD: 'from-env' }, allowDevFallback: true });
    assert.equal(cfg.password, 'from-file');
    assert.equal(cfg.passwordSource, 'passwd-file');
  });
});

describe('one dependency, in one file', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  it('index.js imports Node built-ins only', () => {
    const src = fs.readFileSync(path.join(here, '../index.js'), 'utf8');
    const specifiers = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.deepEqual(specifiers.filter((s) => !s.startsWith('node:')), []);
  });

  it('pool.js is the only file that loads the driver, and the driver is pinned', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '../package.json'), 'utf8'));
    assert.deepEqual(Object.keys(pkg.dependencies), ['mysql2']);
    assert.match(pkg.dependencies.mysql2, /^\d+\.\d+\.\d+$/, 'the driver version is exact, not a range');
    assert.match(fs.readFileSync(path.join(here, '../pool.js'), 'utf8'), /import\('mysql2\/promise'\)/);
  });
});
