import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { DEMO_ADMIN } from './demoAdmin.js';
import { DEMO_GUESTS, hashGuestPassword } from './demoGuests.js';
import { hashPassword } from './password.js';

let pool = null;

function readPasswdFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

/** Resolve MariaDB credentials (turbinobash etc/mysql or env). */
export function mysqlConfig() {
  const passwdFile = process.env.MYSQL_PASSWD_FILE
    || path.join('/apps/helm-v2/etc/mysql/localhost/passwd');
  const password = process.env.MYSQL_PASSWORD || readPasswdFile(passwdFile) || '';
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'helm-v2',
    password,
    database: process.env.MYSQL_DATABASE || 'helm-v2',
    waitForConnections: true,
    connectionLimit: 5,
  };
}

export function getPool() {
  if (!pool) {
    const cfg = mysqlConfig();
    if (!cfg.password && process.env.NODE_ENV !== 'test') {
      console.warn('[helm-v2] MariaDB: no password (MYSQL_PASSWORD or passwd file)');
    }
    pool = mysql.createPool(cfg);
  }
  return pool;
}

export async function query(sql, params = []) {
  try {
    const [rows] = await getPool().execute(sql, params);
    return rows;
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ENOTFOUND') {
      return [];
    }
    throw err;
  }
}

export async function ensureUsersSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(120) NOT NULL DEFAULT '',
      role ENUM('admin','operator','viewer') NOT NULL DEFAULT 'operator',
      status ENUM('active','disabled','pending') NOT NULL DEFAULT 'active',
      password_hash VARCHAR(255) NULL,
      magic_token_hash VARCHAR(64) NULL,
      magic_token_expires_at DATETIME NULL,
      last_login_at DATETIME NULL,
      notes VARCHAR(500) NULL,
      briefing TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_users_email (email),
      KEY idx_users_status (status),
      KEY idx_users_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureUsersColumn(
    'briefing',
    'TEXT NULL COMMENT \'Operator briefing for Cursor CLI sessions\' AFTER notes',
  );
  await ensureUsersColumn(
    'first_name',
    'VARCHAR(80) NULL AFTER name',
  );
  await ensureUsersColumn(
    'last_name',
    'VARCHAR(80) NULL AFTER first_name',
  );
  await ensureUsersColumn(
    'demo_slug',
    'VARCHAR(64) NULL COMMENT \'Personalized demo URL ?user=slug\' AFTER last_name',
  );
  await ensureUsersColumn(
    'demo_password',
    'VARCHAR(120) NULL COMMENT \'Plain password for demo-invite autofill only\' AFTER demo_slug',
  );
  await ensureUsersColumn(
    'demo_conversation',
    'VARCHAR(120) NULL COMMENT \'Dedicated CLI conversation name\' AFTER demo_password',
  );

  // Unique slug when set
  try {
    await query(
      `ALTER TABLE users ADD UNIQUE KEY uq_users_demo_slug (demo_slug)`,
    );
  } catch {
    /* already exists */
  }

  // Legacy guest accounts from earlier development are always purged (Rule 18).
  try {
    await query(`DELETE FROM users WHERE email = 'ivonne.martin@example.com' OR demo_slug = 'ivonne'`);
  } catch {
    /* ignore */
  }

  // The demo operator is a REAL MariaDB row, and only on a demo instance.
  // Production purges it; there is no hardcoded credential path anywhere else
  // (Rules 0G and 18). Authentication therefore always requires MariaDB.
  if (config.isDemo) {
    if (!process.env.DEMO_ADMIN_PASSWORD) {
      console.warn(
        '[helm-v2] WARNING: demo operator seeded with the repository default password. '
        + 'This value is public. Set DEMO_ADMIN_PASSWORD on any instance reachable '
        + 'beyond a throwaway demo host.',
      );
    }
    try {
      const hash = await hashPassword(DEMO_ADMIN.password);
      await query(
        `INSERT INTO users (email, name, role, status, password_hash, notes, briefing, demo_slug, demo_password, demo_conversation)
         VALUES (?, ?, ?, 'active', ?, ?, ?, 'thesuperuser', ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           role = VALUES(role),
           status = 'active',
           password_hash = VALUES(password_hash),
           briefing = VALUES(briefing),
           demo_slug = VALUES(demo_slug),
           demo_password = VALUES(demo_password),
           demo_conversation = VALUES(demo_conversation)`,
        [
          DEMO_ADMIN.email,
          DEMO_ADMIN.name,
          DEMO_ADMIN.role || 'operator',
          hash,
          DEMO_ADMIN.notes || null,
          DEMO_ADMIN.briefing || null,
          DEMO_ADMIN.password,
          DEMO_ADMIN.conversation || 'Demo',
        ],
      );
    } catch (err) {
      console.error('[helm-v2] demo operator seeding failed:', err.message);
    }
  } else {
    try {
      await query(`DELETE FROM users WHERE email = ?`, [DEMO_ADMIN.email]);
    } catch {
      /* ignore */
    }
  }

  const { ensureAllUsersHaveConversations } = await import('./userSession.js');
  await ensureAllUsersHaveConversations();
}

async function ensureUsersColumn(column, definition) {
  const rows = await query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = ?`,
    [column],
  );
  if (Number(rows[0]?.n || 0) > 0) return;
  await query(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
}
