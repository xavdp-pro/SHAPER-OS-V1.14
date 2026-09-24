/**
 * @package @shaper/pkg-db
 * Driver-backed access to a functional unit's private MariaDB. The only runtime
 * dependency of this package, mysql2, is loaded here and nowhere else, so the
 * resolver in ./index.js stays importable without it.
 */
import { UnitDbError, resolveUnitDbConfig } from './index.js';

/**
 * Opens the unit's pool over its private socket and proves the identity the
 * server actually granted, before anything else may use it.
 *
 * @param {object} options - forwarded to resolveUnitDbConfig, plus:
 * @param {number} [options.connectionLimit]
 * @returns {Promise<{ pool: import('mysql2/promise').Pool, config: ReturnType<typeof resolveUnitDbConfig> }>}
 */
export async function openUnitDb({ connectionLimit = 5, ...resolveOptions } = {}) {
  const config = resolveUnitDbConfig(resolveOptions);
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    socketPath: config.socketPath,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    timezone: 'Z',
  });
  try {
    await verifyIdentity(pool, config.slug);
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
  return { pool, config };
}

/**
 * The server, not the configuration, says who we are.
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} slug
 */
export async function verifyIdentity(pool, slug) {
  let rows;
  try {
    [rows] = await pool.query('SELECT CURRENT_USER() AS who, DATABASE() AS db');
  } catch (err) {
    throw new UnitDbError('DB_UNAVAILABLE', `private MariaDB refused or unreachable: ${err.code || err.message}`);
  }
  const { who, db } = rows[0];
  if (who !== `${slug}@localhost` || db !== slug) {
    throw new UnitDbError('IDENTITY_MISMATCH', `connected as ${who} to ${db}; the unit is ${slug}@localhost on ${slug}`);
  }
}

/**
 * Refuses to serve against a schema the administrative path has not installed.
 * The application never creates or alters its own tables.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {object} options
 * @param {string} options.unit
 * @param {number} options.minVersion
 * @returns {Promise<number>} the installed version
 */
export async function assertSchema(pool, { unit, minVersion }) {
  let rows;
  try {
    [rows] = await pool.query('SELECT version FROM schema_meta WHERE unit = ?', [unit]);
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      throw new UnitDbError('SCHEMA_MISSING', `schema_meta is absent: install ${unit}'s schema through the administrative path`);
    }
    throw new UnitDbError('DB_UNAVAILABLE', `cannot read schema_meta: ${err.code || err.message}`);
  }
  if (!rows.length) {
    throw new UnitDbError('SCHEMA_MISSING', `no schema_meta row for ${unit}`);
  }
  const version = Number(rows[0].version);
  if (version < minVersion) {
    throw new UnitDbError('SCHEMA_TOO_OLD', `${unit} schema is version ${version}; this build needs ${minVersion}`);
  }
  return version;
}

/**
 * Runs `work` inside one transaction; commits only if it resolves.
 * @template T
 * @param {import('mysql2/promise').Pool} pool
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(pool, work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * A bounded liveness probe for vitals and health: the round trip, measured.
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<{ ok: boolean, latencyMs: number, error?: string }>}
 */
export async function probeDb(pool) {
  const started = process.hrtime.bigint();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Number(process.hrtime.bigint() - started) / 1e6 };
  } catch (err) {
    return { ok: false, latencyMs: Number(process.hrtime.bigint() - started) / 1e6, error: err.code || err.message };
  }
}
