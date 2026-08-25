/**
 * @package @shaper/db
 * Turbinobash MariaDB config resolution — zero runtime dependencies.
 * Pool/driver is the consumer's responsibility (e.g. mysql2 in the app).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {string} [callerDir] - __dirname of the calling module
 * @param {string} [fallbackSlug]
 * @returns {string}
 */
export function resolveAppSlug(callerDir = '', fallbackSlug = 'app') {
  const fromPath = callerDir.match(/\/apps\/([^/]+)/)?.[1];
  if (fromPath) return fromPath;
  if (process.env.APP_NAME) return process.env.APP_NAME;
  return fallbackSlug;
}

/**
 * @param {string} appSlug
 * @returns {string}
 */
export function passwdFilePath(appSlug) {
  return `/apps/${appSlug}/etc/mysql/localhost/passwd`;
}

/**
 * @param {object} [options]
 * @param {string} [options.appSlug]
 * @param {string} [options.passwdFile]
 * @returns {string}
 */
export function resolvePassword({ appSlug, passwdFile = null } = {}) {
  const file = passwdFile || passwdFilePath(appSlug);
  if (existsSync(file)) return readFileSync(file, 'utf-8').trim();
  if (process.env.MYSQL_PASSWORD) return process.env.MYSQL_PASSWORD;
  throw new Error(`MariaDB password not found: neither ${file} nor MYSQL_PASSWORD.`);
}

/**
 * @param {object} [options]
 * @param {string} [options.appSlug]
 * @param {string} [options.callerDir]
 * @param {string} [options.passwdFile]
 * @returns {{ host: string, port: number, user: string, database: string, password: string }}
 */
export function buildDbConfig({ appSlug = null, callerDir = '', passwdFile = null } = {}) {
  const slug = appSlug || resolveAppSlug(callerDir);
  return {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || slug,
    database: process.env.MYSQL_DATABASE || slug,
    password: resolvePassword({ appSlug: slug, passwdFile }),
  };
}

/**
 * SQL statements for on-demand app database provisioning.
 * @param {string} appSlug
 * @param {string} password
 * @returns {string[]}
 */
export function buildProvisionStatements(appSlug, password) {
  const safeSlug = appSlug.replace(/[^a-zA-Z0-9_-]/g, '');
  const escaped = password.replace(/'/g, "''");
  return [
    `CREATE DATABASE IF NOT EXISTS \`${safeSlug}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE USER IF NOT EXISTS '${safeSlug}'@'localhost' IDENTIFIED BY '${escaped}'`,
    `GRANT ALL PRIVILEGES ON \`${safeSlug}\`.* TO '${safeSlug}'@'localhost'`,
    `FLUSH PRIVILEGES`,
  ];
}
