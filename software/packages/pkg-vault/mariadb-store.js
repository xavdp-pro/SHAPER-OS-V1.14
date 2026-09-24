/**
 * @file mariadb-store.js
 * @package @shaper/pkg-vault
 * @description Vault secrets in the unit's own private MariaDB (Rules 4 and 26).
 *
 * The database holds ciphertext and control metadata only. The master key never
 * enters it: a key-check digest recorded when the Vault identity is born proves
 * which key the ciphertexts belong to, and a Vault started with any other key
 * refuses to serve rather than answering with an empty or unreadable store.
 */

import {
  assertStorablePayload,
  decryptSecret,
  encryptSecret,
  keyCheckDigest,
  normalizeMasterKey,
  normalizeSecretKey,
} from './index.js';
import { UnitDbError } from '../pkg-db/index.js';
import { assertSchema, openUnitDb, probeDb } from '../pkg-db/pool.js';
import { vitals, ageSeconds } from '../pkg-logger/vitals.js';

export const VAULT_SCHEMA_VERSION = 1;
const KEY_VERSION = 1;

export class MariaDbVaultStore {
  /**
   * Opens the unit database, checks the schema installed by the administrative
   * path, then proves master-key continuity before anything is served.
   *
   * @param {object} options
   * @param {string|Buffer} options.masterKey
   * @param {string} [options.slug='vault']
   * @param {object} [options.db] - forwarded to openUnitDb (appsRoot, socketPath, env…)
   * @returns {Promise<MariaDbVaultStore>}
   */
  static async open({ masterKey, slug = 'vault', db = {} } = {}) {
    const key = normalizeMasterKey(masterKey);
    const { pool, config } = await openUnitDb({ slug, ...db });
    try {
      await assertSchema(pool, { unit: 'vault', minVersion: VAULT_SCHEMA_VERSION });
      const identity = await establishIdentity(pool, key);
      return new MariaDbVaultStore({ pool, config, key, identity });
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
  }

  constructor({ pool, config, key, identity }) {
    this.pool = pool;
    this.config = config;
    this.masterKey = key;
    this.identity = identity;
    this.storageKind = 'mariadb';
    this.startedAt = new Date().toISOString();
    this.lastDecryptAt = null;
    this.lastWriteAt = null;
  }

  async setSecret(key, payload) {
    const normalizedKey = normalizeSecretKey(key);
    assertStorablePayload(normalizedKey, payload);
    const { iv, authTag, ciphertext } = encryptSecret(payload, this.masterKey);
    await this.pool.execute(
      `INSERT INTO secrets (secret_key, iv, auth_tag, ciphertext, key_version)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE iv = VALUES(iv), auth_tag = VALUES(auth_tag),
         ciphertext = VALUES(ciphertext), key_version = VALUES(key_version),
         secret_version = secret_version + 1`,
      [normalizedKey, iv, authTag, ciphertext, KEY_VERSION],
    );
    this.lastWriteAt = new Date().toISOString();
    return true;
  }

  async getSecret(key) {
    if (!key) return null;
    const [rows] = await this.pool.execute(
      'SELECT iv, auth_tag, ciphertext FROM secrets WHERE secret_key = ?',
      [normalizeSecretKey(key)],
    );
    if (!rows.length) return null;
    const decrypted = decryptSecret(
      { iv: rows[0].iv, authTag: rows[0].auth_tag, ciphertext: rows[0].ciphertext },
      this.masterKey,
    );
    this.lastDecryptAt = new Date().toISOString();
    return decrypted;
  }

  async deleteSecret(key) {
    if (!key) return false;
    const [result] = await this.pool.execute('DELETE FROM secrets WHERE secret_key = ?', [normalizeSecretKey(key)]);
    if (result.affectedRows > 0) this.lastWriteAt = new Date().toISOString();
    return result.affectedRows > 0;
  }

  async listKeys() {
    const [rows] = await this.pool.query('SELECT secret_key FROM secrets ORDER BY secret_key');
    return rows.map((row) => row.secret_key);
  }

  async probe() {
    const db = await probeDb(this.pool);
    return { ...db, user: `${this.config.user}@localhost`, database: this.config.database, passwordSource: this.config.passwordSource };
  }

  async vitals(now = Date.now()) {
    const db = await this.probe();
    let secretsHeld = null;
    if (db.ok) {
      const [rows] = await this.pool.query('SELECT COUNT(*) AS n FROM secrets');
      secretsHeld = Number(rows[0].n);
    }
    return vitals({
      service: 'brick-vault',
      startedAt: this.startedAt,
      signals: {
        secretsHeld,
        lastSuccessfulDecryptAgeSeconds: ageSeconds(this.lastDecryptAt, now),
        lastWriteAgeSeconds: ageSeconds(this.lastWriteAt, now),
        keyVersion: this.identity.keyVersion,
      },
      checks: {
        storage: { ok: db.ok, latencyMs: db.latencyMs, ...(db.error ? { error: db.error } : {}) },
      },
    }, now);
  }

  async close() {
    await this.pool.end();
  }
}

/**
 * First start of an empty Vault records its key-check digest; every later start
 * must present the same key. A database that already holds ciphertext but no
 * identity row is refused: that is a damaged or foreign Vault, not a new one.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {Buffer} key
 * @returns {Promise<{ keyCheck: string, keyVersion: number, born: boolean }>}
 */
async function establishIdentity(pool, key) {
  const expected = keyCheckDigest(key);
  const [rows] = await pool.query('SELECT key_check, key_version FROM vault_identity WHERE id = 1');
  if (rows.length) {
    if (rows[0].key_check !== expected) {
      throw new UnitDbError(
        'VAULT_KEY_MISMATCH',
        'the master key does not match this Vault identity; refusing to serve (no empty replacement is created)',
      );
    }
    return { keyCheck: expected, keyVersion: Number(rows[0].key_version), born: false };
  }
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM secrets');
  if (Number(n) > 0) {
    throw new UnitDbError(
      'VAULT_IDENTITY_MISSING',
      `the database holds ${n} secret(s) but no Vault identity; refusing to adopt it with the current key`,
    );
  }
  // INSERT IGNORE: two first starts racing produce one identity; the loser
  // re-reads it and is held to the same comparison.
  await pool.execute('INSERT IGNORE INTO vault_identity (id, key_check, key_version) VALUES (1, ?, ?)', [expected, KEY_VERSION]);
  const [again] = await pool.query('SELECT key_check, key_version FROM vault_identity WHERE id = 1');
  if (!again.length || again[0].key_check !== expected) {
    throw new UnitDbError('VAULT_KEY_MISMATCH', 'another key claimed this Vault identity first');
  }
  return { keyCheck: expected, keyVersion: Number(again[0].key_version), born: true };
}
