/**
 * What a live test file needs from the runner (run-live.mjs): where the units'
 * private socket and passwd files are, and a root path to reset a unit.
 * A live file run any other way fails at once and says why (Rule 0G: no
 * substitute database, no silent skip).
 *
 * Intent: software/packages/pkg-db/INTENT.md#live-tests
 */
import fs from 'node:fs';
import { schemaFile } from './run-live.mjs';

export function liveEnv() {
  const socketPath = process.env.SHAPER_LIVE_SOCKET;
  const appsRoot = process.env.SHAPER_LIVE_APPS_ROOT;
  const workDir = process.env.SHAPER_LIVE_WORKDIR;
  if (!socketPath || !appsRoot || !workDir) {
    throw new Error('live test: run it through software/packages/pkg-db/test/live/run-live.mjs, which starts the MariaDB it needs');
  }
  return { socketPath, appsRoot, workDir };
}

/** The `db` option every unit store's open() forwards to openUnitDb. */
export function unitDb() {
  const { socketPath, appsRoot } = liveEnv();
  return { socketPath, appsRoot };
}

/** A root connection over the private socket — the administrative path. */
export async function adminConnection() {
  const { socketPath } = liveEnv();
  const mysql = await import('mysql2/promise');
  return mysql.createConnection({ socketPath, user: 'root', multipleStatements: true, dateStrings: true, timezone: 'Z' });
}

/**
 * Empties a unit's database by re-creating it from its schema as root. The
 * account and its database-level grants are left as provisioned.
 */
export async function resetUnit(slug) {
  const admin = await adminConnection();
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${slug}\``);
    await admin.query(`CREATE DATABASE \`${slug}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    await admin.query(`USE \`${slug}\``);
    await admin.query(fs.readFileSync(schemaFile(slug), 'utf8'));
  } finally {
    await admin.end();
  }
}

/** One administrative query, its rows. */
export async function adminQuery(sql, params = []) {
  const admin = await adminConnection();
  try {
    const [rows] = await admin.query(sql, params);
    return rows;
  } finally {
    await admin.end();
  }
}
