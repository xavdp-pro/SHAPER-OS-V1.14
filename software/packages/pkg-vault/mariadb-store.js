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
import { createHash, randomUUID } from 'node:crypto';
import { UnitDbError } from '../pkg-db/index.js';
import { assertSchema, openUnitDb, probeDb, withTransaction } from '../pkg-db/pool.js';
import { appendOutbox, outboxStatus } from '../pkg-db/outbox.js';
import { vitals, ageSeconds } from '../pkg-logger/vitals.js';
import { assertPublicEvent, publicEvidence } from '../pkg-logger/public-event.js';

/**
 * How a secret is named in evidence: its key, which is a public reference —
 * unless the key itself looks like a credential to Logger's public-event
 * boundary, in which case only its digest leaves the Vault. Never the value.
 * @param {string} key - a normalized secret key
 */
export function secretRef(key) {
  try {
    assertPublicEvent({ secretRef: key });
    return key;
  } catch {
    return `sha256:${createHash('sha256').update(key).digest('hex')}`;
  }
}

/** The outbox entry for one committed secret mutation; it carries no value. */
export function secretEvidence(event, key, extra = {}) {
  const eventId = randomUUID();
  return {
    eventId,
    entry: publicEvidence({ pod: 'vault', event, level: 'INFO', executionId: eventId, data: { secretRef: secretRef(key), ...extra } }),
  };
}

export const VAULT_SCHEMA_VERSION = 2;
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
    // The mutation and its evidence commit together, or neither does.
    await withTransaction(this.pool, async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO secrets (secret_key, iv, auth_tag, ciphertext, key_version)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE iv = VALUES(iv), auth_tag = VALUES(auth_tag),
           ciphertext = VALUES(ciphertext), key_version = VALUES(key_version),
           secret_version = secret_version + 1`,
        [normalizedKey, iv, authTag, ciphertext, KEY_VERSION],
      );
      const { eventId, entry } = secretEvidence('SECRET_STORED', normalizedKey, { created: Number(result?.affectedRows) === 1 });
      await appendOutbox(conn, entry, { eventId });
    });
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
    const normalizedKey = normalizeSecretKey(key);
    const deleted = await withTransaction(this.pool, async (conn) => {
      const [result] = await conn.execute('DELETE FROM secrets WHERE secret_key = ?', [normalizedKey]);
      if (!(result.affectedRows > 0)) return false;
      const { eventId, entry } = secretEvidence('SECRET_DELETED', normalizedKey);
      await appendOutbox(conn, entry, { eventId });
      return true;
    });
    if (deleted) this.lastWriteAt = new Date().toISOString();
    return deleted;
  }

  async listKeys() {
    const [rows] = await this.pool.query('SELECT secret_key FROM secrets ORDER BY secret_key');
    return rows.map((row) => row.secret_key);
  }

  async probe() {
    const db = await probeDb(this.pool);
    return { ...db, user: `${this.config.user}@localhost`, database: this.config.database, passwordSource: this.config.passwordSource };
  }

  /** The evidence still owed to Logger: observable, never silent. */
  async evidenceStatus() {
    return outboxStatus(this.pool);
  }

  async vitals(now = Date.now()) {
    const db = await this.probe();
    let secretsHeld = null;
    let evidence = null;
    if (db.ok) {
      const [rows] = await this.pool.query('SELECT COUNT(*) AS n FROM secrets');
      secretsHeld = Number(rows[0].n);
      evidence = await this.evidenceStatus();
    }
    return vitals({
      service: 'brick-vault',
      startedAt: this.startedAt,
      signals: {
        secretsHeld,
        lastSuccessfulDecryptAgeSeconds: ageSeconds(this.lastDecryptAt, now),
        lastWriteAgeSeconds: ageSeconds(this.lastWriteAt, now),
        keyVersion: this.identity.keyVersion,
        // Evidence committed with a mutation and not yet receipted by Logger.
        evidencePending: evidence ? evidence.pending : null,
        oldestPendingEvidenceAt: evidence ? evidence.oldestPendingAt : null,
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
  const [[{ n }]] = await pool.query(`SELECT
    (SELECT COUNT(*) FROM secrets) + (SELECT COUNT(*) FROM unit_identities)
    + (SELECT COUNT(*) FROM unit_credentials) + (SELECT COUNT(*) FROM event_outbox) AS n`);
  if (Number(n) > 0) {
    throw new UnitDbError(
      'VAULT_IDENTITY_MISSING',
      `the database holds ${n} state record(s) but no Vault identity; refusing to adopt it with the current key`,
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
