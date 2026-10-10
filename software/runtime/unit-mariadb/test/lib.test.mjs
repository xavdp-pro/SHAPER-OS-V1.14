// Intent: software/runtime/unit-mariadb/INTENT.md
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXIT, SUPERVISOR_CONTROLS, UnitError, adminPredicateSql, applicationEnv, assertGrants, assertPassword, assertProtectedFrom,
  chainOf, createAccountSql, decideSchema, engineArgs, exitCodeOf, expectedGrants, firstBirthSql,
  grantsSql, installDbArgs, parseAdminPredicate, parsePrincipals, parseRetained, parseVersion,
  readConfig, redact, resolveAccounts, rootClientArgs, sqlString, unitPaths, writableBy,
} from '../lib.mjs';

const ENV = {
  SHAPER_UNIT_SLUG: 'vault',
  UNIT_UID: '10610',
  UNIT_ENGINE_UID: '10611',
  UNIT_SCHEMA_FILE: '/apps/vault/app/packages/pkg-vault/sql/schema.sql',
  UNIT_SCHEMA_VERSION: '1',
  SHAPER_DB_SOCKET: '/run/vault/mysqld.sock',
};
const refuses = (fn, code) => assert.throws(fn, (err) => err instanceof UnitError && err.code === code);

describe('readConfig', () => {
  test('reads the declared identity and derives the Rule 4 layout', () => {
    const c = readConfig(ENV);
    assert.equal(c.slug, 'vault');
    assert.equal(c.uid, 10610);
    assert.equal(c.engineUid, 10611);
    assert.equal(c.mode, 'serve');
    assert.equal(c.paths.passwd, '/apps/vault/etc/mysql/localhost/passwd');
    assert.equal(c.paths.datadir, '/apps/vault/sav/mariadb');
    assert.equal(c.paths.socket, '/run/vault/mysqld.sock');
    assert.equal(c.paths.runDir, '/run/vault');
    assert.equal(c.restoreDump, null);
  });

  test('refuses a slug that is not one name for account, MariaDB account and database', () => {
    for (const slug of [undefined, '', 'Vault', '1vault', 'va-ult', 'a'.repeat(33), 'root', 'mysql']) {
      refuses(() => readConfig({ ...ENV, SHAPER_UNIT_SLUG: slug }), 'CONFIG_INVALID');
    }
  });

  test('refuses uids at or below 1000, and an engine sharing the application uid', () => {
    refuses(() => readConfig({ ...ENV, UNIT_UID: '1000' }), 'CONFIG_INVALID');
    refuses(() => readConfig({ ...ENV, UNIT_ENGINE_UID: '999' }), 'CONFIG_INVALID');
    refuses(() => readConfig({ ...ENV, UNIT_ENGINE_UID: '10610' }), 'CONFIG_INVALID');
    refuses(() => readConfig({ ...ENV, UNIT_UID: '10610x' }), 'CONFIG_INVALID');
  });

  test('refuses a socket the application would look for elsewhere', () => {
    refuses(() => readConfig({ ...ENV, SHAPER_DB_SOCKET: '/run/mysqld/mysqld.sock' }), 'CONFIG_INVALID');
  });

  test('refuses an unknown mode, a relative schema and an undeclared version', () => {
    refuses(() => readConfig({ ...ENV, UNIT_MODE: 'repair' }), 'CONFIG_INVALID');
    refuses(() => readConfig({ ...ENV, UNIT_SCHEMA_FILE: 'sql/schema.sql' }), 'CONFIG_INVALID');
    refuses(() => readConfig({ ...ENV, UNIT_SCHEMA_VERSION: '' }), 'CONFIG_INVALID');
    refuses(() => readConfig({ ...ENV, UNIT_SCHEMA_VERSION: '0' }), 'CONFIG_INVALID');
  });

  test('a restore dump must lie in the unit\'s own persistent volume', () => {
    assert.equal(readConfig({ ...ENV, UNIT_RESTORE_DUMP: '/apps/vault/sav/restore/vault.sql' }).restoreDump, '/apps/vault/sav/restore/vault.sql');
    refuses(() => readConfig({ ...ENV, UNIT_RESTORE_DUMP: '/tmp/vault.sql' }), 'CONFIG_INVALID');
    refuses(() => readConfig({ ...ENV, UNIT_RESTORE_DUMP: '/apps/vault/sav/../log/x.sql' }), 'CONFIG_INVALID');
    refuses(() => readConfig({ ...ENV, UNIT_RESTORE_DUMP: '/apps/logger/sav/x.sql' }), 'CONFIG_INVALID');
  });
});

describe('resolveAccounts', () => {
  const config = readConfig(ENV);
  const passwd = [
    'root:x:0:0:root:/root:/bin/sh',
    'node:x:1000:1000::/home/node:/bin/sh',
    'mysql:x:10611:10611:mysql:/var/lib/mysql:/sbin/nologin',
    'vault:x:10610:10610:Linux User,,,:/apps/vault:/sbin/nologin',
  ].join('\n');
  const group = ['root:x:0:root', 'node:x:1000:', 'mysql:x:10611:', 'vault:x:10610:'].join('\n');

  test('returns the application and engine accounts with their fixed ids', () => {
    const accounts = resolveAccounts(config, passwd, group);
    assert.deepEqual(accounts.app, { name: 'vault', uid: 10610, gid: 10610 });
    assert.deepEqual(accounts.engine, { name: 'mysql', uid: 10611, gid: 10611 });
  });

  test('refuses an engine account whose uid the package chose instead of the image', () => {
    refuses(() => resolveAccounts(config, passwd.replace('mysql:x:10611:10611', 'mysql:x:100:101'), group), 'ACCOUNT_MISMATCH');
  });

  test('refuses an application account with another home, or a group with members', () => {
    refuses(() => resolveAccounts(config, passwd.replace(':/apps/vault:', ':/home/vault:'), group), 'ACCOUNT_MISMATCH');
    refuses(() => resolveAccounts(config, passwd, group.replace('vault:x:10610:', 'vault:x:10610:node')), 'ACCOUNT_MISMATCH');
    refuses(() => resolveAccounts(config, passwd, group.replace('mysql:x:10611:', 'mysql:x:10611:vault')), 'ACCOUNT_MISMATCH');
  });

  test('refuses another account sharing the unit id', () => {
    refuses(() => resolveAccounts(config, `${passwd}\nintruder:x:10610:1:::/bin/sh`, group), 'ACCOUNT_MISMATCH');
  });
});

describe('filesystem rights', () => {
  const app = { name: 'vault', uid: 10610, gid: 10610 };
  const dir = (uid, gid, mode) => ({ uid, gid, mode: 0o40000 | mode, isSymbolicLink: () => false });

  test('writableBy follows owner, group write and other write', () => {
    assert.equal(writableBy(dir(10610, 0, 0o500), app), true, 'an owner can chmod its own entry back');
    assert.equal(writableBy(dir(0, 10610, 0o750), app), false);
    assert.equal(writableBy(dir(0, 10610, 0o770), app), true);
    assert.equal(writableBy(dir(0, 0, 0o757), app), true);
    assert.equal(writableBy(dir(10611, 10610, 0o750), app), false);
  });

  test('chainOf walks to the root', () => {
    assert.deepEqual(chainOf('/apps/vault/sav/mariadb'), ['/apps/vault/sav/mariadb', '/apps/vault/sav', '/apps/vault', '/apps', '/']);
  });

  const fakeFs = (table) => ({
    lstatSync(p) {
      if (!(p in table)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; }
      return table[p];
    },
  });
  const safe = {
    '/': dir(0, 0, 0o755),
    '/apps': dir(0, 0, 0o755),
    '/apps/vault': dir(0, 0, 0o755),
    '/apps/vault/sav': dir(0, 0, 0o755),
    '/apps/vault/sav/mariadb': dir(10611, 10611, 0o700),
  };

  test('accepts a datadir no ancestor of which the application can write', () => {
    assert.doesNotThrow(() => assertProtectedFrom('/apps/vault/sav/mariadb', app, { fsImpl: fakeFs(safe) }));
  });

  test('refuses a writable ancestor — a home owned by the application could replace sav/', () => {
    refuses(() => assertProtectedFrom('/apps/vault/sav/mariadb', app, { fsImpl: fakeFs({ ...safe, '/apps/vault': dir(10610, 10610, 0o750) }) }), 'LAYOUT_UNSAFE');
    refuses(() => assertProtectedFrom('/apps/vault/sav/mariadb', app, { fsImpl: fakeFs({ ...safe, '/apps': dir(0, 0, 0o777) }) }), 'LAYOUT_UNSAFE');
  });

  test('refuses a symbolic link anywhere in the chain, and an unreadable chain', () => {
    const link = { ...dir(0, 0, 0o777), isSymbolicLink: () => true };
    refuses(() => assertProtectedFrom('/apps/vault/sav/mariadb', app, { fsImpl: fakeFs({ ...safe, '/apps/vault/sav': link }) }), 'LAYOUT_UNSAFE');
    const { '/apps/vault/sav': _, ...missing } = safe;
    refuses(() => assertProtectedFrom('/apps/vault/sav/mariadb', app, { fsImpl: fakeFs(missing) }), 'LAYOUT_UNSAFE');
  });
});

describe('SQL for the root path', () => {
  test('sqlString escapes quotes and backslashes', () => {
    assert.equal(sqlString("a'b\\c"), "'a\\'b\\\\c'");
  });

  test('the account is created only when absent, with a validated password', () => {
    const pw = 'a'.repeat(64);
    assert.equal(createAccountSql('vault', pw), `CREATE USER IF NOT EXISTS 'vault'@'localhost' IDENTIFIED BY '${pw}';\n`);
    refuses(() => createAccountSql('vault', "x'; GRANT ALL ON *.* TO vault; --"), 'PASSWD_INVALID');
  });

  test('grants are DML on the unit database only, after a full revoke', () => {
    const sql = grantsSql('queue');
    assert.match(sql, /^REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'queue'@'localhost';$/m);
    assert.match(sql, /^GRANT SELECT, INSERT, UPDATE, DELETE ON `queue`\.\* TO 'queue'@'localhost';$/m);
    assert.doesNotMatch(sql, /WITH GRANT OPTION|ALL PRIVILEGES ON|CREATE|ALTER|DROP/);
  });

  test('assertGrants accepts exactly USAGE + DML and refuses anything more or less', () => {
    const exact = expectedGrants('queue').join('\n');
    assert.doesNotThrow(() => assertGrants(`${exact}\n`, 'queue'));
    refuses(() => assertGrants(`${exact}\nschema\tqueue\tCREATE\tNO\n`, 'queue'), 'GRANTS_MISMATCH');
    refuses(() => assertGrants(exact.replace('SELECT\tNO', 'SELECT\tYES'), 'queue'), 'GRANTS_MISMATCH');
    refuses(() => assertGrants(exact.split('\n').slice(0, 3).join('\n'), 'queue'), 'GRANTS_MISMATCH');
    refuses(() => assertGrants(`${exact}\nrole\tadmin\tROLE\tN\n`, 'queue'), 'GRANTS_MISMATCH');
  });

  test('the administrative predicate checks root by unix_socket, the principal set and PUBLIC, and returns no secret', () => {
    const sql = adminPredicateSql('maestro');
    assert.match(sql, /JSON_VALUE\(Priv, '\$\.plugin'\) = 'unix_socket'/);
    assert.match(sql, /JSON_TABLE\(g\.Priv, '\$\.auth_or\[\*\]'/);
    assert.match(sql, /User IN \('root', 'mariadb\.sys', 'maestro'\)/);
    assert.match(sql, /mysql\.db WHERE User = 'PUBLIC'/);
    // It selects counts and names only: never an authentication string as a column.
    const selected = sql.split('\n').filter((line) => /^\s*\(SELECT COUNT|^\s*COALESCE\(\(SELECT GROUP_CONCAT/.test(line));
    for (const line of selected) assert.doesNotMatch(line, /authentication_string|Password/i);
  });

  test('parseAdminPredicate reads the one row and refuses anything else', () => {
    assert.deepEqual(parseAdminPredicate('1\t1\t\n'), { valid: true, rootAccounts: 1, unexpected: [] });
    assert.deepEqual(parseAdminPredicate('0\t2\troot@%,healthcheck@localhost\n'), { valid: false, rootAccounts: 2, unexpected: ['root@%', 'healthcheck@localhost'] });
    refuses(() => parseAdminPredicate(''), 'ADMIN_AUTHENTICATION_MISMATCH');
    refuses(() => parseAdminPredicate('1\t1\t\n1\t1\t\n'), 'ADMIN_AUTHENTICATION_MISMATCH');
    refuses(() => parseAdminPredicate('yes\t1\t\n'), 'ADMIN_AUTHENTICATION_MISMATCH');
  });

  test('first birth removes every principal mariadb-install-db adds beyond root and mariadb.sys', () => {
    const principals = parsePrincipals([
      'root\tlocalhost\t0', 'mariadb.sys\tlocalhost\t0', 'mysql\tlocalhost\t0',
      '\tlocalhost\t0', '\tbuildhost\t0', 'root\tbuildhost\t0', 'PUBLIC\t\t1', 'someRole\t\t1',
    ].join('\n'));
    const sql = firstBirthSql(principals);
    assert.match(sql, /DROP USER IF EXISTS 'mysql'@'localhost'/);
    assert.match(sql, /DROP USER IF EXISTS ''@'localhost'/);
    assert.match(sql, /DROP USER IF EXISTS ''@'buildhost'/);
    assert.match(sql, /DROP USER IF EXISTS 'root'@'buildhost'/);
    assert.match(sql, /DROP ROLE IF EXISTS 'someRole'/);
    assert.doesNotMatch(sql, /'root'@'localhost'(?! IDENTIFIED)/);
    assert.doesNotMatch(sql, /DROP (USER|ROLE) IF EXISTS 'mariadb\.sys'/);
    assert.doesNotMatch(sql, /'PUBLIC'/);
    assert.match(sql, /ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket;/);
    assert.match(sql, /DROP DATABASE IF EXISTS test;/);
    assert.doesNotMatch(sql, /IDENTIFIED BY|PASSWORD\(/);
  });
});

describe('retained schema', () => {
  test('parsers', () => {
    assert.deepEqual(parseRetained('1\t7\t1\n'), { databaseExists: true, tables: 7, hasMeta: true });
    assert.deepEqual(parseRetained('0\t0\t0\n'), { databaseExists: false, tables: 0, hasMeta: false });
    refuses(() => parseRetained('x\n'), 'SCHEMA_VERSION_MISMATCH');
    assert.equal(parseVersion('3\n'), 3);
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion('3\n4\n'), null);
  });

  test('an empty database is born; a retained one must carry exactly the declared version', () => {
    assert.equal(decideSchema({ retained: { tables: 0, hasMeta: false }, version: null, declared: 1 }), 'birth');
    assert.equal(decideSchema({ retained: { tables: 5, hasMeta: true }, version: 1, declared: 1 }), 'retained');
    for (const [retained, version] of [
      [{ tables: 5, hasMeta: true }, 2],
      [{ tables: 5, hasMeta: true }, 0],
      [{ tables: 5, hasMeta: true }, null],
      [{ tables: 5, hasMeta: false }, null],
    ]) {
      assert.throws(() => decideSchema({ retained, version, declared: 1 }),
        (err) => err.code === 'SCHEMA_VERSION_MISMATCH' && err.exitCode === EXIT.SCHEMA_VERSION && /Rule 30/.test(err.message));
    }
  });
});

describe('processes and secrets', () => {
  test('the server runs with no option file, no network and its socket under /run/<slug>', () => {
    const args = engineArgs(unitPaths({ slug: 'logger' }));
    assert.equal(args[0], '--no-defaults');
    assert.ok(args.includes('--skip-networking'));
    assert.ok(args.includes('--socket=/run/logger/mysqld.sock'));
    assert.ok(args.includes('--datadir=/apps/logger/sav/mariadb'));
    assert.ok(!args.some((a) => /^--(port|bind-address)/.test(a)));
    const init = installDbArgs(unitPaths({ slug: 'logger' }));
    assert.equal(init[0], '--no-defaults');
    assert.ok(init.includes('--auth-root-authentication-method=socket'));
    assert.ok(init.includes('--skip-test-db'));
  });

  test('the root client reads no option file and never carries a password', () => {
    const args = rootClientArgs('/run/queue/mysqld.sock', { database: 'queue' });
    assert.equal(args[0], '--no-defaults');
    assert.ok(args.includes('--user=root'));
    assert.ok(!args.some((a) => /^-p|--password/.test(a)));
    assert.equal(args.at(-1), 'queue');
  });

  test('the application environment drops the supervisor controls and states the identity', () => {
    const env = applicationEnv({ PATH: '/bin', UNIT_MODE: 'serve', UNIT_RESTORE_DUMP: 'x', MYSQL_PWD: 'leak', VAULT_TOKEN: 't' },
      { slug: 'vault', home: '/apps/vault', socket: '/run/vault/mysqld.sock' });
    assert.deepEqual(env, {
      PATH: '/bin', VAULT_TOKEN: 't', HOME: '/apps/vault', USER: 'vault', LOGNAME: 'vault',
      SHAPER_UNIT_SLUG: 'vault', SHAPER_DB_SOCKET: '/run/vault/mysqld.sock',
    });
  });

  // Non-regression (Rule 29): the supervisor once dropped every UNIT_* variable,
  // so pkg-auth's identity inputs never reached the application and every unit
  // that relays evidence refused to start (IDENTITY_CLIENT_CONFIG_REQUIRED).
  test('the application keeps its own UNIT_* inputs; only the named controls stay with the supervisor', () => {
    const controls = Object.fromEntries(SUPERVISOR_CONTROLS.map((k) => [k, 'x']));
    const env = applicationEnv({
      ...controls,
      UNIT_BOOTSTRAP_TOKEN_FILE: '/apps/queue/etc/identity/bootstrap',
      UNIT_AUTH_PUBLIC_KEY_FILE: '/apps/queue/etc/identity/vault-signing.pub',
      UNIT_CREDENTIAL_TTL_SECONDS: '300',
      SHAPER_UNIT_INCARNATION: 'queue-1',
    }, { slug: 'queue', home: '/apps/queue', socket: '/run/queue/mysqld.sock' });
    for (const key of SUPERVISOR_CONTROLS) assert.ok(!(key in env), `${key} stays with the supervisor`);
    assert.equal(env.UNIT_BOOTSTRAP_TOKEN_FILE, '/apps/queue/etc/identity/bootstrap');
    assert.equal(env.UNIT_AUTH_PUBLIC_KEY_FILE, '/apps/queue/etc/identity/vault-signing.pub');
    assert.equal(env.UNIT_CREDENTIAL_TTL_SECONDS, '300');
    assert.equal(env.SHAPER_UNIT_INCARNATION, 'queue-1');
  });

  test('every UNIT_* variable the runtime reads is a named supervisor control', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const read = new Set();
    for (const name of fs.readdirSync(path.join(here, '..')).filter((f) => f.endsWith('.mjs'))) {
      const text = fs.readFileSync(path.join(here, '..', name), 'utf8');
      for (const m of text.matchAll(/env\.(UNIT_[A-Z_]+)|process\.env\.(UNIT_[A-Z_]+)/g)) read.add(m[1] || m[2]);
    }
    assert.ok(read.size >= 10, `found ${[...read].join(', ')}`);
    for (const key of read) assert.ok(SUPERVISOR_CONTROLS.includes(key), `${key} is read by the runtime but not a named control`);
  });

  test('redact removes every occurrence of a secret', () => {
    const pw = 'f'.repeat(64);
    assert.equal(redact(`near '${pw}' and ${pw}`, [pw]), "near '[redacted]' and [redacted]");
  });

  test('assertPassword accepts only the generated form', () => {
    assert.equal(assertPassword('0'.repeat(64)), '0'.repeat(64));
    for (const bad of ['', 'A'.repeat(64), '0'.repeat(63), `${'0'.repeat(64)}\n`, "x' OR 1=1"]) {
      refuses(() => assertPassword(bad), 'PASSWD_INVALID');
    }
  });

  test('exitCodeOf follows the shell convention', () => {
    assert.equal(exitCodeOf(3, null), 3);
    assert.equal(exitCodeOf(null, 'SIGTERM'), 143);
    assert.equal(exitCodeOf(null, 'SIGKILL'), 137);
  });
});
