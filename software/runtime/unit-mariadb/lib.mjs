// Intent: software/runtime/unit-mariadb/INTENT.md
/**
 * The functional unit's private MariaDB, inside the unit's own container
 * (Rules 4, 11 and 26 — the Turbinobash method, one application account per
 * server). Pure functions and small effectful helpers; the process that uses
 * them is ./supervisor.mjs.
 *
 *   <slug> = Linux account = MariaDB account = MariaDB database
 *   /apps/<slug>/etc/mysql/localhost/passwd   0600, owned by <slug>
 *   /apps/<slug>/sav/mariadb                  the datadir, owned by mysql
 *   /run/<slug>/mysqld.sock                   the only way in; no TCP
 *
 * Node built-ins only: the runtime is copied into every unit image and must not
 * depend on the application's own modules.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The functional-slug grammar of pkg-auth (UNIT_NAME_PATTERN) and pkg-db,
// copied: the runtime depends on no application module. A contract test holds
// the three equal. Hyphenated slugs (brick-voice) are quoted in every statement.
export const SLUG_PATTERN = /^[a-z](?:[a-z0-9_-]{0,30}[a-z0-9_])?$/;
export const PASSWORD_PATTERN = /^[0-9a-f]{64}$/;
export const MODES = new Set(['serve', 'birth', 'database']);
export const STATE_DIR = '/run/shaper-unit';

/** Exit codes, stable: an operator reads them in `podman ps` and the restart log. */
export const EXIT = Object.freeze({
  OK: 0,
  APP_FAILED: 1,
  CONFIG: 2,
  LAYOUT: 3,
  ENGINE: 4,
  PASSWD: 5,
  SCHEMA_APPLY: 6,
  SCHEMA_VERSION: 7,
  ADMIN: 8,
  CREDENTIAL: 9,
  GRANTS: 10,
  RESTORE: 11,
  ENGINE_LOST: 12,
});

export class UnitError extends Error {
  /**
   * @param {string} code - stable machine-readable reason, printed first
   * @param {string} message - never carries a secret
   * @param {number} exitCode
   */
  constructor(code, message, exitCode) {
    super(message);
    this.name = 'UnitError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

const integer = (value, name, { min, max }) => {
  if (value === undefined || value === '') throw new UnitError('CONFIG_INVALID', `${name} is required`, EXIT.CONFIG);
  if (!/^[0-9]+$/.test(String(value))) throw new UnitError('CONFIG_INVALID', `${name} must be an integer, got ${JSON.stringify(value)}`, EXIT.CONFIG);
  const n = Number(value);
  if (n < min || n > max) throw new UnitError('CONFIG_INVALID', `${name} must be between ${min} and ${max}, got ${n}`, EXIT.CONFIG);
  return n;
};

/**
 * The unit's declared identity, from the image's environment. Every value is
 * declared at build time (Containerfile, from brick.json); nothing is guessed.
 *
 * @param {Record<string, string|undefined>} env
 */
export function readConfig(env) {
  const slug = env.SHAPER_UNIT_SLUG;
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new UnitError('CONFIG_INVALID', `SHAPER_UNIT_SLUG must match ${SLUG_PATTERN} (Linux account, MariaDB account and database at once); got ${JSON.stringify(slug)}`, EXIT.CONFIG);
  }
  if (slug === 'root' || slug === 'mysql' || slug === 'mariadb') {
    throw new UnitError('CONFIG_INVALID', `SHAPER_UNIT_SLUG "${slug}" is reserved for the engine or the administrator`, EXIT.CONFIG);
  }
  const uid = integer(env.UNIT_UID, 'UNIT_UID', { min: 1001, max: 4294967294 });
  const engineUid = integer(env.UNIT_ENGINE_UID, 'UNIT_ENGINE_UID', { min: 1001, max: 4294967294 });
  if (engineUid === uid) {
    throw new UnitError('CONFIG_INVALID', 'UNIT_ENGINE_UID must differ from UNIT_UID: the engine account and the application account are distinct', EXIT.CONFIG);
  }
  const schemaFile = env.UNIT_SCHEMA_FILE;
  if (!schemaFile || !path.isAbsolute(schemaFile)) {
    throw new UnitError('CONFIG_INVALID', `UNIT_SCHEMA_FILE must be an absolute path inside the image; got ${JSON.stringify(schemaFile)}`, EXIT.CONFIG);
  }
  const schemaVersion = integer(env.UNIT_SCHEMA_VERSION, 'UNIT_SCHEMA_VERSION', { min: 1, max: 65535 });
  const mode = env.UNIT_MODE || 'serve';
  if (!MODES.has(mode)) {
    throw new UnitError('CONFIG_INVALID', `UNIT_MODE must be one of ${[...MODES].join(', ')}; got ${JSON.stringify(mode)}`, EXIT.CONFIG);
  }
  const appsRoot = env.UNIT_APPS_ROOT || '/apps';
  const runRoot = env.UNIT_RUN_ROOT || '/run';
  const paths = unitPaths({ slug, appsRoot, runRoot });
  if (env.SHAPER_DB_SOCKET && env.SHAPER_DB_SOCKET !== paths.socket) {
    throw new UnitError('CONFIG_INVALID', `SHAPER_DB_SOCKET is ${env.SHAPER_DB_SOCKET}; the unit's private socket is ${paths.socket}`, EXIT.CONFIG);
  }
  let restoreDump = null;
  if (env.UNIT_RESTORE_DUMP) {
    restoreDump = path.resolve(env.UNIT_RESTORE_DUMP);
    if (!restoreDump.startsWith(`${paths.sav}/`)) {
      throw new UnitError('CONFIG_INVALID', `UNIT_RESTORE_DUMP must lie inside ${paths.sav}/, the unit's own persistent volume`, EXIT.CONFIG);
    }
  }
  return {
    slug,
    uid,
    engineUid,
    schemaFile,
    schemaVersion,
    mode,
    restoreDump,
    paths,
    drainSeconds: integer(env.UNIT_DRAIN_SECONDS || '20', 'UNIT_DRAIN_SECONDS', { min: 1, max: 600 }),
    engineStartSeconds: integer(env.UNIT_ENGINE_START_SECONDS || '120', 'UNIT_ENGINE_START_SECONDS', { min: 5, max: 3600 }),
    engineStopSeconds: integer(env.UNIT_ENGINE_STOP_SECONDS || '60', 'UNIT_ENGINE_STOP_SECONDS', { min: 5, max: 3600 }),
  };
}

/** Rule 4's layout, as seen inside the container. */
export function unitPaths({ slug, appsRoot = '/apps', runRoot = '/run' }) {
  const home = path.join(appsRoot, slug);
  const runDir = path.join(runRoot, slug);
  return {
    appsRoot,
    home,
    app: path.join(home, 'app'),
    etc: path.join(home, 'etc'),
    etcMysql: path.join(home, 'etc/mysql'),
    credDir: path.join(home, 'etc/mysql/localhost'),
    passwd: path.join(home, 'etc/mysql/localhost/passwd'),
    log: path.join(home, 'log'),
    nosav: path.join(home, 'nosav'),
    sav: path.join(home, 'sav'),
    datadir: path.join(home, 'sav/mariadb'),
    runDir,
    socket: path.join(runDir, 'mysqld.sock'),
    pidFile: path.join(runDir, 'mysqld.pid'),
  };
}

// ── Accounts ──────────────────────────────────────────────────────────────

/** @param {string} text - /etc/passwd */
export function parsePasswd(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [name, , uid, gid, , home, shell] = line.split(':');
    if (name && !out.has(name)) out.set(name, { name, uid: Number(uid), gid: Number(gid), home, shell });
  }
  return out;
}

/** @param {string} text - /etc/group */
export function parseGroup(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [name, , gid, members = ''] = line.split(':');
    if (name && !out.has(name)) out.set(name, { name, gid: Number(gid), members: members.split(',').filter(Boolean) });
  }
  return out;
}

/**
 * The application account and the engine account, exactly as declared.
 * One name for the application (slug), one for the engine (mysql); fixed
 * numeric ids; distinct; neither is root; nobody else shares their groups
 * (the account itself may be listed in its own primary group, as Alpine's
 * adduser writes it).
 */
export function resolveAccounts(config, passwdText, groupText) {
  const users = parsePasswd(passwdText);
  const groups = parseGroup(groupText);
  const expect = (name, wantedId, home) => {
    const user = users.get(name);
    if (!user) throw new UnitError('ACCOUNT_MISMATCH', `the image has no "${name}" account`, EXIT.LAYOUT);
    if (user.uid !== wantedId || user.gid !== wantedId) {
      throw new UnitError('ACCOUNT_MISMATCH', `account "${name}" is ${user.uid}:${user.gid}; the unit declares ${wantedId}:${wantedId}`, EXIT.LAYOUT);
    }
    const group = groups.get(name);
    if (!group || group.gid !== wantedId) {
      throw new UnitError('ACCOUNT_MISMATCH', `group "${name}" must exist with gid ${wantedId}`, EXIT.LAYOUT);
    }
    // Alpine's adduser -G lists the account in its own primary group's member
    // field (vault:x:10610:vault); that grants nothing the primary gid does not.
    // Any other member would share the group's rights over the unit's paths.
    const others = group.members.filter((member) => member !== name);
    if (others.length) {
      throw new UnitError('ACCOUNT_MISMATCH', `group "${name}" must have no member but "${name}" itself; it lists ${others.join(',')}`, EXIT.LAYOUT);
    }
    if (home && user.home !== home) {
      throw new UnitError('ACCOUNT_MISMATCH', `account "${name}" has home ${user.home}; Rule 4 declares ${home}`, EXIT.LAYOUT);
    }
    for (const other of users.values()) {
      if (other.name !== name && (other.uid === wantedId || other.gid === wantedId)) {
        throw new UnitError('ACCOUNT_MISMATCH', `account "${other.name}" shares id ${wantedId} with "${name}"`, EXIT.LAYOUT);
      }
    }
    return { name, uid: user.uid, gid: user.gid };
  };
  return {
    app: expect(config.slug, config.uid, config.paths.home),
    engine: expect('mysql', config.engineUid, null),
  };
}

// ── Filesystem rights ─────────────────────────────────────────────────────

/**
 * Whether an account could create, remove or replace entries in (a directory)
 * or rewrite (a file) with this stat, by ordinary permission bits.
 */
export function writableBy(stat, { uid, gid }) {
  const mode = stat.mode & 0o7777;
  if (stat.uid === uid) return true; // an owner can always chmod its own entry back to writable
  if (stat.gid === gid && (mode & 0o020)) return true;
  return (mode & 0o002) !== 0;
}

/** Every path from `target` up to `/`, target first. */
export function chainOf(target) {
  const out = [];
  let current = path.resolve(target);
  for (;;) {
    out.push(current);
    const parent = path.dirname(current);
    if (parent === current) return out;
    current = parent;
  }
}

/**
 * Refuses when the account could modify or replace `target` — directly, or
 * through any writable ancestor directory (Rule 4, Turbinobash point 2).
 * A symbolic link anywhere in the chain is refused as well: a link the
 * application can aim is a replacement by another name.
 *
 * @returns {string[]} the chain checked, for the log
 */
export function assertProtectedFrom(target, account, { fsImpl = fs, what = 'path' } = {}) {
  const chain = chainOf(target);
  for (const p of chain) {
    let stat;
    try {
      stat = fsImpl.lstatSync(p);
    } catch (err) {
      throw new UnitError('LAYOUT_UNSAFE', `${what} ${target}: cannot inspect ${p} (${err.code || err.message})`, EXIT.LAYOUT);
    }
    if (stat.isSymbolicLink()) {
      throw new UnitError('LAYOUT_UNSAFE', `${what} ${target}: ${p} is a symbolic link`, EXIT.LAYOUT);
    }
    if (writableBy(stat, account)) {
      throw new UnitError('LAYOUT_UNSAFE', `${what} ${target}: ${p} is writable by ${account.name} (uid ${account.uid}); the application must not be able to modify or replace it`, EXIT.LAYOUT);
    }
  }
  return chain;
}

// ── SQL, built for the root path only ─────────────────────────────────────

/** A MariaDB string literal for a value already restricted to a safe grammar. */
export function sqlString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * The administrative-account predicate (port of c0ab540, widened to the
 * equivalent representations): exactly one root account, root@localhost,
 * authenticated only by unix_socket with no authentication string and no
 * alternative method; no principal other than root, mariadb.sys and the
 * unit's own account, all at localhost — the engine's PUBLIC pseudo-role is
 * tolerated only while it holds no privilege at any level, since anything
 * granted to it would widen the application account too. Returns one row:
 *   <valid 0|1> TAB <root accounts> TAB <unexpected principals, user@host,...>
 * Authentication strings never leave the server: only counts and names do.
 */
export function adminPredicateSql(slug) {
  const s = sqlString(slug);
  return `SELECT
  IF(
    (SELECT COUNT(*) FROM mysql.global_priv WHERE User = 'root') = 1
    AND (SELECT COUNT(*) FROM mysql.global_priv
         WHERE User = 'root' AND Host = 'localhost'
           AND JSON_VALUE(Priv, '$.plugin') = 'unix_socket'
           AND COALESCE(JSON_VALUE(Priv, '$.authentication_string'), '') = '') = 1
    AND (SELECT COUNT(*) FROM mysql.global_priv g,
           JSON_TABLE(g.Priv, '$.auth_or[*]' COLUMNS (
             method VARCHAR(64) PATH '$.plugin',
             secret TEXT PATH '$.authentication_string')) AS m
         WHERE g.User = 'root' AND g.Host = 'localhost'
           AND NOT ((m.method IS NULL AND m.secret IS NULL)
                 OR (m.method = 'unix_socket' AND COALESCE(m.secret, '') = ''))) = 0
    AND NOT EXISTS (SELECT 1 FROM mysql.global_priv
         WHERE NOT (Host = 'localhost' AND User IN ('root', 'mariadb.sys', ${s}))
           AND NOT (User = 'PUBLIC' AND Host = ''))
    AND NOT EXISTS (SELECT 1 FROM mysql.global_priv
         WHERE User = 'PUBLIC'
           AND NOT (Host = '' AND JSON_VALUE(Priv, '$.is_role') = 'true'
                    AND COALESCE(JSON_VALUE(Priv, '$.access'), '0') = '0'))
    AND NOT EXISTS (SELECT 1 FROM mysql.db WHERE User = 'PUBLIC')
    AND NOT EXISTS (SELECT 1 FROM mysql.tables_priv WHERE User = 'PUBLIC')
    AND NOT EXISTS (SELECT 1 FROM mysql.columns_priv WHERE User = 'PUBLIC')
    AND NOT EXISTS (SELECT 1 FROM mysql.procs_priv WHERE User = 'PUBLIC'),
    1, 0),
  (SELECT COUNT(*) FROM mysql.global_priv WHERE User = 'root'),
  COALESCE((SELECT GROUP_CONCAT(CONCAT(User, '@', Host) ORDER BY User, Host SEPARATOR ',')
            FROM mysql.global_priv
            WHERE NOT (Host = 'localhost' AND User IN ('root', 'mariadb.sys', ${s}))
              AND NOT (User = 'PUBLIC' AND Host = '')), '');`;
}

/** @returns {{ valid: boolean, rootAccounts: number, unexpected: string[] }} */
export function parseAdminPredicate(stdout) {
  const lines = stdout.split('\n').filter((l) => l.length);
  if (lines.length !== 1) {
    throw new UnitError('ADMIN_AUTHENTICATION_MISMATCH', `the administrative-account observation returned ${lines.length} rows, expected 1`, EXIT.ADMIN);
  }
  const [valid, roots, unexpected = ''] = lines[0].split('\t');
  if (valid !== '0' && valid !== '1') {
    throw new UnitError('ADMIN_AUTHENTICATION_MISMATCH', 'the administrative-account observation is unreadable', EXIT.ADMIN);
  }
  return { valid: valid === '1', rootAccounts: Number(roots), unexpected: unexpected ? unexpected.split(',') : [] };
}

/**
 * First birth only: what mariadb-install-db leaves beyond root@localhost and
 * mariadb.sys@localhost is removed, root is set to unix_socket alone, and the
 * shared test database is dropped. Generated from the observed principals, so
 * an account the engine adds in a later version is removed too, not missed.
 *
 * @param {Array<{user: string, host: string, isRole: boolean}>} principals
 */
export function firstBirthSql(principals) {
  const keep = new Set(['root@localhost', 'mariadb.sys@localhost']);
  const statements = [];
  for (const { user, host, isRole } of principals) {
    if (keep.has(`${user}@${host}`)) continue;
    if (isRole) {
      if (user === 'PUBLIC') continue; // the engine's pseudo-role cannot be dropped; the predicate reports it if it holds a row
      statements.push(`DROP ROLE IF EXISTS ${sqlString(user)}`);
    } else {
      statements.push(`DROP USER IF EXISTS ${sqlString(user)}@${sqlString(host)}`);
    }
  }
  statements.push(
    "ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket",
    'DROP DATABASE IF EXISTS test',
    "DELETE FROM mysql.db WHERE Db IN ('test', 'test\\\\_%')",
    'FLUSH PRIVILEGES',
  );
  return `${statements.join(';\n')};\n`;
}

export const PRINCIPALS_SQL = "SELECT User, Host, IF(JSON_VALUE(Priv, '$.is_role') = 'true', 1, 0) FROM mysql.global_priv ORDER BY User, Host;";

/** @returns {Array<{user: string, host: string, isRole: boolean}>} */
export function parsePrincipals(stdout) {
  return stdout.split('\n').filter((l) => l.length).map((line) => {
    const [user, host, role] = line.split('\t');
    return { user, host, isRole: role === '1' };
  });
}

/** The retained database, observed before anything is converged. */
export function retainedSchemaSql(slug) {
  const s = sqlString(slug);
  return `SELECT
  (SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ${s}),
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${s}),
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${s} AND TABLE_NAME = 'schema_meta');`;
}

export function parseRetained(stdout) {
  const [databases, tables, meta] = stdout.trim().split('\t').map(Number);
  if (![databases, tables, meta].every(Number.isInteger)) {
    throw new UnitError('SCHEMA_VERSION_MISMATCH', 'the retained-schema observation is unreadable', EXIT.SCHEMA_VERSION);
  }
  return { databaseExists: databases === 1, tables, hasMeta: meta === 1 };
}

export function schemaVersionSql(slug) {
  return `SELECT version FROM \`${slug}\`.schema_meta WHERE unit = ${sqlString(slug)};`;
}

/**
 * Port of 938555b (provisioning part), adapted: there is no schema profile in
 * these units' schema_meta, so the declared exact version is the profile. A
 * retained database with tables must carry exactly that version; anything
 * else — no schema_meta, no row, another version, larger or smaller — refuses
 * before any grant or schema statement. No inference from a larger number.
 *
 * @returns {'birth'|'retained'}
 */
export function decideSchema({ retained, version, declared }) {
  if (retained.tables === 0) return 'birth';
  if (!retained.hasMeta || version === null || version !== declared) {
    const found = !retained.hasMeta ? 'no schema_meta table' : version === null ? 'no schema_meta row for this unit' : `version ${version}`;
    throw new UnitError(
      'SCHEMA_VERSION_MISMATCH',
      `the retained database has ${retained.tables} table(s) and ${found}; this image declares exactly version ${declared}. Existing data requires a separate authorized migration or reconstruction (Rule 30).`,
      EXIT.SCHEMA_VERSION,
    );
  }
  return 'retained';
}

export function parseVersion(stdout) {
  const lines = stdout.split('\n').filter((l) => l.length);
  if (lines.length !== 1 || !/^[0-9]+$/.test(lines[0])) return null;
  return Number(lines[0]);
}

export function createDatabaseSql(slug) {
  return `CREATE DATABASE IF NOT EXISTS \`${slug}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`;
}

/** The account is created when absent; an existing one keeps its password. */
export function createAccountSql(slug, password) {
  assertPassword(password);
  return `CREATE USER IF NOT EXISTS ${sqlString(slug)}@'localhost' IDENTIFIED BY ${sqlString(password)};\n`;
}

/** Runtime data privileges on its own database; no DDL, no grant option. */
export function grantsSql(slug) {
  return [
    `REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${sqlString(slug)}@'localhost'`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${slug}\`.* TO ${sqlString(slug)}@'localhost'`,
    'FLUSH PRIVILEGES',
  ].join(';\n') + ';\n';
}

/**
 * The effective privileges, read from information_schema and the grant tables
 * (SHOW GRANTS would carry the password hash): global, schema, table, column,
 * role, proxy and routine. One line per privilege: <scope> TAB <object> TAB
 * <privilege> TAB <grantable>.
 */
export function grantsObservationSql(slug) {
  const grantee = sqlString(`'${slug}'@'localhost'`);
  return `SELECT 'global', '*', PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ${grantee}
UNION ALL SELECT 'schema', TABLE_SCHEMA, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ${grantee}
UNION ALL SELECT 'table', CONCAT(TABLE_SCHEMA, '.', TABLE_NAME), PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ${grantee}
UNION ALL SELECT 'column', CONCAT(TABLE_SCHEMA, '.', TABLE_NAME, '.', COLUMN_NAME), PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE = ${grantee}
UNION ALL SELECT 'role', Role, 'ROLE', Admin_option FROM mysql.roles_mapping WHERE User = ${sqlString(slug)}
UNION ALL SELECT 'proxy', CONCAT(Proxied_user, '@', Proxied_host), 'PROXY', IF(With_grant, 'YES', 'NO') FROM mysql.proxies_priv WHERE User = ${sqlString(slug)}
UNION ALL SELECT 'routine', CONCAT(Db, '.', Routine_name), Proc_priv, 'NO' FROM mysql.procs_priv WHERE User = ${sqlString(slug)}
ORDER BY 1, 2, 3;`;
}

export function expectedGrants(slug) {
  return [
    `global\t*\tUSAGE\tNO`,
    ...['DELETE', 'INSERT', 'SELECT', 'UPDATE'].map((p) => `schema\t${slug}\t${p}\tNO`),
  ];
}

export function assertGrants(stdout, slug) {
  const actual = stdout.split('\n').filter((l) => l.length).sort();
  const expected = expectedGrants(slug).sort();
  if (actual.length !== expected.length || actual.some((line, i) => line !== expected[i])) {
    throw new UnitError('GRANTS_MISMATCH', `${slug}@localhost holds [${actual.join(' | ')}]; the unit declares exactly [${expected.join(' | ')}]`, EXIT.GRANTS);
  }
}

export function assertPassword(password) {
  if (typeof password !== 'string' || !PASSWORD_PATTERN.test(password)) {
    throw new UnitError('PASSWD_INVALID', 'the password file does not hold one generated 64-hex password', EXIT.PASSWD);
  }
  return password;
}

/** Removes every occurrence of each secret from a text before it is logged. */
export function redact(text, secrets) {
  let out = String(text ?? '');
  for (const secret of secrets) if (secret) out = out.split(secret).join('[redacted]');
  return out;
}

// ── Processes ─────────────────────────────────────────────────────────────

/**
 * Runs a command to completion. Input travels on standard input, never in
 * argv; the environment is exactly the one given.
 *
 * @returns {Promise<{ code: number|null, signal: string|null, stdout: string, stderr: string }>}
 */
export function run(command, args, { input = null, uid, gid, env = { PATH: process.env.PATH || '/usr/sbin:/usr/bin:/sbin:/bin' }, timeoutMs = 600000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const options = { env, stdio: ['pipe', 'pipe', 'pipe'] };
    if (uid !== undefined) options.uid = uid;
    if (gid !== undefined) options.gid = gid;
    let child;
    try {
      child = spawnImpl(command, args, options);
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    child.stdin.on('error', () => {});
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** The root path: the local client, as OS root, by unix_socket, no option file. */
export function rootClientArgs(socket, { database = null } = {}) {
  return ['--no-defaults', `--socket=${socket}`, '--user=root', '--batch', '--skip-column-names', ...(database ? [database] : [])];
}

/** Options for the server, all on its command line so `ps` shows what it runs with. */
export function engineArgs(paths) {
  return [
    '--no-defaults',
    `--datadir=${paths.datadir}`,
    `--socket=${paths.socket}`,
    `--pid-file=${paths.pidFile}`,
    '--skip-networking',
    '--skip-name-resolve',
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_unicode_ci',
  ];
}

export function installDbArgs(paths) {
  return [
    '--no-defaults',
    `--datadir=${paths.datadir}`,
    '--user=mysql',
    '--auth-root-authentication-method=socket',
    '--skip-test-db',
    '--skip-name-resolve',
  ];
}

/**
 * The variables this runtime reads for itself — the image's declaration, the
 * run mode, the lifecycle bounds — named one by one. They stay with the
 * supervisor. The prefix alone does not decide: the application has `UNIT_*`
 * inputs of its own (pkg-auth's `UNIT_BOOTSTRAP_TOKEN_FILE` and
 * `UNIT_AUTH_PUBLIC_KEY_FILE`, Vault's `UNIT_CREDENTIAL_TTL_SECONDS`), and a
 * unit that never receives them cannot hold a credential.
 */
export const SUPERVISOR_CONTROLS = Object.freeze([
  'UNIT_UID', 'UNIT_ENGINE_UID', 'UNIT_SCHEMA_FILE', 'UNIT_SCHEMA_VERSION',
  'UNIT_MODE', 'UNIT_RESTORE_DUMP', 'UNIT_HEALTH_URL', 'UNIT_IMPORT_CHECK',
  'UNIT_DRAIN_SECONDS', 'UNIT_ENGINE_START_SECONDS', 'UNIT_ENGINE_STOP_SECONDS',
  'UNIT_APPS_ROOT', 'UNIT_RUN_ROOT',
]);
const NOT_FOR_THE_APPLICATION = new Set([...SUPERVISOR_CONTROLS, 'MYSQL_PWD']);

/** The application's environment: the container's, minus the supervisor's own controls. */
export function applicationEnv(env, { slug, home, socket }) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (NOT_FOR_THE_APPLICATION.has(key)) continue;
    out[key] = value;
  }
  out.HOME = home;
  out.USER = slug;
  out.LOGNAME = slug;
  out.SHAPER_UNIT_SLUG = slug;
  out.SHAPER_DB_SOCKET = socket;
  return out;
}

/** 128 + signal number, the shell's convention, for a child ended by a signal. */
export function exitCodeOf(code, signal) {
  if (typeof code === 'number') return code;
  const numbers = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
  return 128 + (numbers[signal] || 1);
}
