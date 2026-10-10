/**
 * @package @shaper/pkg-db
 * Functional-unit MariaDB identity resolution (Rules 4 and 26) — zero runtime
 * dependencies. The driver-backed pool lives in ./pool.js.
 *
 * One functional slug is the function identity, the Linux system account, the
 * MariaDB account and the MariaDB database. The application password is read
 * from /apps/<slug>/etc/mysql/localhost/passwd, mode 0600, owned by that
 * account. The database is reached through its private unix socket only.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_APPS_ROOT = '/apps';
export const DEFAULT_SOCKET_PATH = '/run/mysqld/mysqld.sock';

// A slug is a Linux account name, a MariaDB account and a database name at
// once, so it takes the narrowest grammar the three accept without quoting.
const SLUG_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export class UnitDbError extends Error {
  /**
   * @param {string} code - stable machine-readable reason
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'UnitDbError';
    this.code = code;
  }
}

/**
 * The environment flags that declare a promotion or qualification run, as
 * `NAME=value` strings; empty when the run is disposable DEV.
 *
 * `SHAPER_QUALIFICATION` set to anything but empty or `0`, or
 * `SHAPER_RUNTIME_MODE` set to anything but `dev` or `development`, declares
 * that the artefact is being qualified or promoted (test, demo, production).
 * Under either, DEV scaffolding never qualifies (Rule 4, password resolution
 * order; Rule 26, no file-based substitute).
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string[]}
 */
export function qualificationFlags(env = process.env) {
  const flags = [];
  const qualification = env.SHAPER_QUALIFICATION;
  if (qualification !== undefined && qualification !== '' && qualification !== '0') {
    flags.push(`SHAPER_QUALIFICATION=${qualification}`);
  }
  const mode = env.SHAPER_RUNTIME_MODE;
  if (mode !== undefined && mode !== '' && mode !== 'dev' && mode !== 'development') {
    flags.push(`SHAPER_RUNTIME_MODE=${mode}`);
  }
  return flags;
}

/**
 * Refuses a disposable DEV store (file, memory) when the run is a promotion or
 * qualification. The store is chosen explicitly by its entrypoint; this check
 * makes sure that choice cannot carry an artefact past a gate.
 *
 * @param {object} options
 * @param {string} options.unit - the functional unit, for the message
 * @param {string} options.store - the DEV store asked for (`file`, `memory`)
 * @param {Record<string, string|undefined>} [options.env]
 */
export function assertDisposableStoreAllowed({ unit, store, env = process.env }) {
  const flags = qualificationFlags(env);
  if (flags.length) {
    throw new UnitDbError(
      'DEV_STORE_REFUSED',
      `${unit}: the ${store} store is disposable DEV scaffolding and is refused under ${flags.join(', ')}; `
      + 'only the unit\'s private MariaDB qualifies (Rules 4 and 26)',
    );
  }
}

/**
 * @param {string} slug
 * @returns {string} the slug, unchanged
 */
export function assertFunctionalSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw new UnitDbError(
      'INVALID_SLUG',
      `functional slug must match ${SLUG_PATTERN} (Linux account, MariaDB account and database at once); got ${JSON.stringify(slug)}`,
    );
  }
  return slug;
}

/**
 * @param {string} slug
 * @param {string} [appsRoot]
 * @returns {string}
 */
export function passwdFilePath(slug, appsRoot = DEFAULT_APPS_ROOT) {
  return path.join(appsRoot, assertFunctionalSlug(slug), 'etc/mysql/localhost/passwd');
}

/**
 * Reads the application password and refuses a file anyone else could read.
 * @param {string} file
 * @param {object} [options]
 * @param {number|null} [options.expectedUid] - owner the file must have; null skips the check
 * @param {typeof fs} [options.fsImpl]
 * @returns {string}
 */
export function readPasswdFile(file, { expectedUid = null, fsImpl = fs } = {}) {
  let stat;
  try {
    stat = fsImpl.statSync(file);
  } catch (err) {
    throw new UnitDbError('PASSWD_MISSING', `MariaDB password file ${file} is not readable: ${err.code || err.message}`);
  }
  if (!stat.isFile()) {
    throw new UnitDbError('PASSWD_NOT_FILE', `${file} is not a regular file`);
  }
  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    throw new UnitDbError('PASSWD_MODE', `${file} has mode ${mode.toString(8).padStart(4, '0')}; Rule 4 requires 0600`);
  }
  if (expectedUid !== null && stat.uid !== expectedUid) {
    throw new UnitDbError('PASSWD_OWNER', `${file} belongs to uid ${stat.uid}; the functional account runs as uid ${expectedUid}`);
  }
  const password = fsImpl.readFileSync(file, 'utf8').trim();
  if (!password) {
    throw new UnitDbError('PASSWD_EMPTY', `${file} is empty`);
  }
  return password;
}

/**
 * Resolves the one identity a functional unit connects with.
 *
 * `MYSQL_PASSWORD` is accepted only when `allowDevFallback` is true and the
 * passwd file is absent; the result then says so, and a qualification refuses
 * it (Rule 4, password resolution order).
 *
 * @param {object} options
 * @param {string} options.slug
 * @param {string} [options.appsRoot]
 * @param {string} [options.socketPath]
 * @param {Record<string, string|undefined>} [options.env]
 * @param {boolean} [options.allowDevFallback]
 * @param {number|null} [options.expectedUid] - defaults to the current process uid
 * @param {typeof fs} [options.fsImpl]
 * @returns {{ slug: string, user: string, database: string, password: string, socketPath: string, passwordSource: 'passwd-file'|'env-dev-fallback', passwdFile: string }}
 */
export function resolveUnitDbConfig({
  slug,
  appsRoot = DEFAULT_APPS_ROOT,
  socketPath = null,
  env = process.env,
  allowDevFallback = false,
  expectedUid = typeof process.getuid === 'function' ? process.getuid() : null,
  fsImpl = fs,
} = {}) {
  assertFunctionalSlug(slug);
  for (const name of ['MYSQL_USER', 'MYSQL_DATABASE']) {
    const value = env[name];
    if (value && value !== slug) {
      throw new UnitDbError('IDENTITY_MISMATCH', `${name} must equal the functional slug "${slug}"; got "${value}"`);
    }
  }
  const passwdFile = passwdFilePath(slug, appsRoot);
  const resolvedSocket = socketPath || env.SHAPER_DB_SOCKET || DEFAULT_SOCKET_PATH;

  let password;
  let passwordSource = 'passwd-file';
  if (fsImpl.existsSync(passwdFile)) {
    password = readPasswdFile(passwdFile, { expectedUid, fsImpl });
  } else if (allowDevFallback && env.MYSQL_PASSWORD) {
    const flags = qualificationFlags(env);
    if (flags.length) {
      throw new UnitDbError(
        'DEV_FALLBACK_REFUSED',
        `MariaDB password file ${passwdFile} is absent, and the MYSQL_PASSWORD fallback is refused under ${flags.join(', ')}`,
      );
    }
    password = env.MYSQL_PASSWORD;
    passwordSource = 'env-dev-fallback';
  } else {
    throw new UnitDbError(
      'PASSWD_MISSING',
      `MariaDB password file ${passwdFile} is absent${allowDevFallback ? ' and MYSQL_PASSWORD is not set' : ''}`,
    );
  }

  return {
    slug,
    user: slug,
    database: slug,
    password,
    socketPath: resolvedSocket,
    passwordSource,
    passwdFile,
  };
}
