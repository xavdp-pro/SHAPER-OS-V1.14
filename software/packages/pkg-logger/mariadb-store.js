/**
 * @file mariadb-store.js
 * @package @shaper/pkg-logger
 * @description Logger events in the unit's own private MariaDB (Rules 4 and 26).
 *
 * Every accepted event is one immutable row of `events`, partitioned monthly by
 * receipt time, carrying the SHA-256 of its canonical form. An ingest answers
 * only after its transaction commits; a database failure is a typed refusal,
 * never an empty or invented answer. A source-supplied event id makes the
 * ingest idempotent through `ingest_keys`, the unpartitioned table where that
 * uniqueness can actually be held.
 *
 * Only this file reaches ../pkg-db/: the library surface other units import
 * (index.js, events.js, vitals.js, ingest-client.js) stays dependency-free.
 *
 * Intent: software/packages/pkg-logger/INTENT.md#private-mariadb
 */

import { EventEmitter } from 'node:events';

import {
  DEFAULT_LIMITS,
  LOGGER_POD,
  LoggerIngestError,
  buildRecord,
  createEventIdGenerator,
  eventDigest,
  fromDbDatetime,
  normalizeIngestEntry,
  planBatch,
  recordToRow,
  replayDecision,
  rowToRecord,
  sourceEventConflict,
  toDbDatetime,
} from './ingest-contract.js';
import { vitals, ageSeconds } from './vitals.js';
import { UnitDbError } from '../pkg-db/index.js';
import { assertSchema, openUnitDb, probeDb, withTransaction } from '../pkg-db/pool.js';

export const LOGGER_SCHEMA_VERSION = 1;

/** Columns of `events`, in the order recordToRow produces them. */
export const EVENT_COLUMNS = [
  'received_at', 'id', 'pod', 'event', 'level', 'correlation_id', 'execution_id',
  'source_event_id', 'duration_ms', 'data', 'record_version', 'digest',
];
export const KEY_COLUMNS = ['pod', 'source_event_id', 'claim_digest', 'event_id', 'received_at'];

const placeholders = (n) => new Array(n).fill('?').join(', ');

export const SQL = Object.freeze({
  insertEvent: `INSERT INTO events (${EVENT_COLUMNS.join(', ')}) VALUES (${placeholders(EVENT_COLUMNS.length)})`,
  insertKey: `INSERT INTO ingest_keys (${KEY_COLUMNS.join(', ')}) VALUES (${placeholders(KEY_COLUMNS.length)})`,
  // Locking reads see the latest committed row whatever the transaction's
  // snapshot, which is what a replay racing its original needs.
  readKeyForShare: 'SELECT claim_digest, event_id, received_at FROM ingest_keys WHERE pod = ? AND source_event_id = ? LOCK IN SHARE MODE',
  readEventForShare: `SELECT ${EVENT_COLUMNS.join(', ')} FROM events WHERE received_at = ? AND id = ? LOCK IN SHARE MODE`,
  listPods: 'SELECT DISTINCT pod FROM events ORDER BY pod',
  countPods: 'SELECT COUNT(DISTINCT pod) AS n FROM events',
  countSince: 'SELECT COUNT(*) AS n FROM events WHERE received_at >= ?',
  lastReceipt: 'SELECT MAX(received_at) AS last_at FROM events',
  partitions: `SELECT PARTITION_NAME AS name, PARTITION_DESCRIPTION AS bound,
      DATA_LENGTH + INDEX_LENGTH AS bytes
    FROM information_schema.PARTITIONS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events'
    ORDER BY PARTITION_ORDINAL_POSITION`,
});

/** Driver and socket failures become one typed refusal; typed refusals pass through. */
export function asStoreError(err) {
  if (!err || err instanceof LoggerIngestError || err.name === 'UnitDbError') return err;
  const code = String(err.code || '');
  if (code || err.fatal || typeof err.errno === 'number') {
    const wrapped = new UnitDbError('DB_UNAVAILABLE', `private MariaDB refused the operation: ${code || 'ERROR'} ${err.message}`);
    wrapped.cause = err;
    return wrapped;
  }
  return err;
}

/** The upper bound of the last named partition, from information_schema. */
export function partitionHorizon(partitions) {
  let horizon = null;
  for (const p of partitions) {
    const bound = String(p.bound ?? '').replace(/^'|'$/g, '');
    if (!bound || bound === 'MAXVALUE') continue;
    horizon = fromDbDatetime(bound);
  }
  return horizon;
}

export class MariaDbLoggerStore {
  /**
   * Opens the unit database and checks the schema the administrative path
   * installed. Nothing is served before both hold.
   *
   * @param {object} [options]
   * @param {string} [options.slug='logger']
   * @param {object} [options.db] - forwarded to openUnitDb (appsRoot, socketPath, env…)
   * @param {object} [options.limits]
   * @returns {Promise<MariaDbLoggerStore>}
   */
  static async open({ slug = 'logger', db = {}, limits = DEFAULT_LIMITS } = {}) {
    const { pool, config } = await openUnitDb({ slug, ...db });
    try {
      const schemaVersion = await assertSchema(pool, { unit: 'logger', minVersion: LOGGER_SCHEMA_VERSION });
      return new MariaDbLoggerStore({ pool, config, schemaVersion, limits });
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
  }

  constructor({ pool, config, schemaVersion = LOGGER_SCHEMA_VERSION, limits = DEFAULT_LIMITS, nextEventId = createEventIdGenerator() }) {
    this.pool = pool;
    this.config = config;
    this.schemaVersion = schemaVersion;
    this.limits = limits;
    this.nextEventId = nextEventId;
    this.storageKind = 'mariadb';
    this.emitter = new EventEmitter();
    this.startedAt = new Date().toISOString();
    this.lastWriteAt = null;
    this.lastProbeOkAt = null;
    this.probeAttempts = 0;
    this.counters = { ingested: 0, replayed: 0, conflicts: 0, refusedUnavailable: 0 };
  }

  /**
   * Records a batch of normalised claims in ONE transaction: every entry is
   * committed, or none is. Returns, per entry, the stored record and whether
   * it is the original receipt of an earlier submission.
   *
   * @param {Array<ReturnType<typeof normalizeIngestEntry>>} claims
   * @returns {Promise<Array<{ record: object, replayed: boolean }>>}
   */
  async ingest(claims) {
    let plan;
    try {
      plan = planBatch(claims);
    } catch (err) {
      if (err.code === 'SOURCE_EVENT_CONFLICT') throw await this.#recordConflict(err);
      throw err;
    }

    let results;
    try {
      results = await withTransaction(this.pool, async (conn) => {
        const out = [];
        for (const step of plan) {
          if (step.duplicateOf !== null) {
            out.push({ record: out[step.duplicateOf].record, replayed: true });
            continue;
          }
          out.push(await this.#ingestOne(conn, step));
        }
        return out;
      });
    } catch (err) {
      if (err instanceof LoggerIngestError && err.code === 'SOURCE_EVENT_CONFLICT') throw await this.#recordConflict(err);
      const typed = asStoreError(err);
      if (typed && typed.name === 'UnitDbError') this.counters.refusedUnavailable += 1;
      throw typed;
    }

    // Committed: only now is anything counted, announced or answered.
    for (const { record, replayed } of results) {
      if (replayed) {
        this.counters.replayed += 1;
      } else {
        this.counters.ingested += 1;
        this.emitter.emit('event', record);
      }
    }
    if (results.some((r) => !r.replayed)) this.lastWriteAt = new Date().toISOString();
    return results;
  }

  async #ingestOne(conn, step) {
    const { claim, claimDigest } = step;
    const { id, ms } = this.nextEventId();
    const record = buildRecord(claim, { id, receivedAtMs: ms });
    const row = recordToRow(record);

    if (claim.sourceEventId) {
      try {
        await conn.query(SQL.insertKey, [claim.pod, claim.sourceEventId, claimDigest, id, row.received_at]);
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        return this.#replay(conn, step, err);
      }
    }
    await conn.query(SQL.insertEvent, EVENT_COLUMNS.map((column) => row[column]));
    return { record, replayed: false };
  }

  async #replay(conn, step, dupError) {
    const { claim, claimDigest, index } = step;
    const [keys] = await conn.query(SQL.readKeyForShare, [claim.pod, claim.sourceEventId]);
    if (!keys.length) throw dupError;
    const stored = keys[0];
    if (replayDecision(stored.claim_digest, claimDigest) === 'conflict') {
      throw sourceEventConflict({
        pod: claim.pod,
        sourceEventId: claim.sourceEventId,
        index,
        originalEventId: stored.event_id,
        originalReceivedAt: fromDbDatetime(stored.received_at),
        storedClaimDigest: stored.claim_digest,
        submittedClaimDigest: claimDigest,
        correlationId: claim.correlationId,
      });
    }
    const [rows] = await conn.query(SQL.readEventForShare, [stored.received_at, stored.event_id]);
    if (!rows.length) {
      throw new LoggerIngestError(500, 'RECEIPT_MISSING', `ingest key ${claim.sourceEventId} points at event ${stored.event_id}, which is not held`, {
        pod: claim.pod, sourceEventId: claim.sourceEventId, originalEventId: stored.event_id,
      });
    }
    const original = rowToRecord(rows[0]);
    if (eventDigest(original) !== original.digest) {
      throw new LoggerIngestError(500, 'DIGEST_MISMATCH', `event ${original.id} no longer matches the digest recorded with it`, {
        originalEventId: original.id,
      });
    }
    return { record: original, replayed: true };
  }

  /**
   * A refused conflicting replay is itself evidence: it is recorded as a
   * Logger security event before the refusal is answered. If that record
   * cannot be committed, the answer is the storage refusal, not the 409.
   */
  async #recordConflict(conflict) {
    this.counters.conflicts += 1;
    const details = conflict.details || {};
    const evidence = conflict.evidence || {};
    const claim = normalizeIngestEntry({
      pod: LOGGER_POD,
      event: 'LOGGER_INGEST_CONFLICT',
      level: 'WARN',
      // Filed under the trace the refused submission claimed, so a correlation
      // query shows the refusal beside the events it concerns.
      correlationId: evidence.correlationId ?? null,
      data: {
        pod: details.pod ?? null,
        sourceEventId: details.sourceEventId ?? null,
        originalEventId: details.originalEventId ?? null,
        originalReceivedAt: details.originalReceivedAt ?? null,
        storedClaimDigest: evidence.storedClaimDigest ?? null,
        submittedClaimDigest: evidence.submittedClaimDigest ?? null,
      },
    }, this.limits);
    let record;
    try {
      record = await withTransaction(this.pool, async (conn) => {
        const { id, ms } = this.nextEventId();
        const built = buildRecord(claim, { id, receivedAtMs: ms });
        const row = recordToRow(built);
        await conn.query(SQL.insertEvent, EVENT_COLUMNS.map((column) => row[column]));
        return built;
      });
    } catch (err) {
      const typed = asStoreError(err);
      if (typed && typed.name === 'UnitDbError') this.counters.refusedUnavailable += 1;
      return typed;
    }
    this.counters.ingested += 1;
    this.lastWriteAt = new Date().toISOString();
    this.emitter.emit('event', record);
    conflict.details = { ...details, conflictEventId: record.id };
    return conflict;
  }

  /**
   * @param {{ pod?: string|null, correlationId?: string|null, event?: string|null, since?: number|null, until?: number|null, limit: number }} filters
   * @returns {Promise<object[]>} ascending receipt order, the last `limit` matches
   */
  async query({ pod = null, correlationId = null, event = null, since = null, until = null, limit = 50 } = {}) {
    const where = [];
    const params = [];
    if (pod) { where.push('pod = ?'); params.push(pod); }
    if (correlationId) { where.push('correlation_id = ?'); params.push(correlationId); }
    if (event) { where.push('event = ?'); params.push(event); }
    if (since !== null) { where.push('received_at >= ?'); params.push(toDbDatetime(since)); }
    if (until !== null) { where.push('received_at < ?'); params.push(toDbDatetime(until)); }
    const bounded = Math.max(1, Math.min(Number.isInteger(limit) ? limit : 50, this.limits.maxQueryLimit ?? DEFAULT_LIMITS.maxQueryLimit));
    const sql = `SELECT ${EVENT_COLUMNS.join(', ')} FROM events`
      + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
      + ` ORDER BY received_at DESC, id DESC LIMIT ${bounded}`;
    try {
      const [rows] = await this.pool.query(sql, params);
      return rows.reverse().map(rowToRecord);
    } catch (err) {
      throw asStoreError(err);
    }
  }

  async listPods() {
    try {
      const [rows] = await this.pool.query(SQL.listPods);
      return rows.map((row) => row.pod);
    } catch (err) {
      throw asStoreError(err);
    }
  }

  async probe() {
    this.probeAttempts += 1;
    const db = await probeDb(this.pool);
    if (db.ok) this.lastProbeOkAt = new Date().toISOString();
    return {
      ...db,
      user: `${this.config.user}@localhost`,
      database: this.config.database,
      passwordSource: this.config.passwordSource,
      schemaVersion: this.schemaVersion,
    };
  }

  async vitals(now = Date.now()) {
    const db = await this.probe();
    const signals = {
      podsCount: null,
      eventsLast60s: null,
      lastWriteAgeSeconds: null,
      bytesOnDisk: null,
      partitionHorizon: null,
      eventsBeyondHorizon: null,
      ingestedSinceStart: this.counters.ingested,
      replayedSinceStart: this.counters.replayed,
      conflictsSinceStart: this.counters.conflicts,
      refusedUnavailableSinceStart: this.counters.refusedUnavailable,
    };
    let lastError = db.ok ? null : (db.error || 'DB_UNAVAILABLE');
    if (db.ok) {
      try {
        const [[pods]] = await this.pool.query(SQL.countPods);
        const [[recent]] = await this.pool.query(SQL.countSince, [toDbDatetime(now - 60_000)]);
        const [[latest]] = await this.pool.query(SQL.lastReceipt);
        const [partitions] = await this.pool.query(SQL.partitions);
        signals.podsCount = Number(pods.n);
        signals.eventsLast60s = Number(recent.n);
        signals.lastWriteAgeSeconds = latest.last_at ? ageSeconds(fromDbDatetime(latest.last_at), now) : ageSeconds(this.lastWriteAt, now);
        // InnoDB's own statistics: an estimate, stated as such by its name in INTENT.
        signals.bytesOnDisk = partitions.reduce((sum, p) => sum + Number(p.bytes || 0), 0);
        signals.partitionHorizon = partitionHorizon(partitions);
        if (signals.partitionHorizon) {
          const [[beyond]] = await this.pool.query(SQL.countSince, [toDbDatetime(signals.partitionHorizon)]);
          signals.eventsBeyondHorizon = Number(beyond.n);
        }
      } catch (err) {
        lastError = err.code || err.message;
      }
    }
    return vitals({
      service: 'brick-logger',
      startedAt: this.startedAt,
      signals,
      checks: {
        database: {
          user: `${this.config.user}@localhost`,
          database: this.config.database,
          socketPath: this.config.socketPath,
          passwordSource: this.config.passwordSource,
          schemaVersion: this.schemaVersion,
          latencyMs: db.latencyMs,
          lastError,
          lastOkAgeSeconds: ageSeconds(this.lastProbeOkAt, now),
          attempts: this.probeAttempts,
        },
      },
    }, now);
  }

  async close() {
    await this.pool.end();
  }
}
