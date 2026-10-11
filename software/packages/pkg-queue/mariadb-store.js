/**
 * @file mariadb-store.js
 * @package @shaper/pkg-queue
 * @description Queue jobs in the unit's own private MariaDB (Rules 4 and 26).
 *
 * MariaDB is the source of truth. Every read goes to it; no in-memory copy is
 * authoritative. Every state change — creation, progress or status update,
 * quality-gate result — writes the job row and one append-only history row in
 * one transaction, and the caller hears of success, the stream sees an event
 * and Logger receives an audit line only after that transaction commits.
 *
 * Intent: software/packages/pkg-queue/INTENT.md#private-mariadb
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { localConsumer, publicAttempt, terminalAudit, validateQualityGate } from './index.js';
import { appendOutbox, outboxStatus } from '../pkg-db/outbox.js';
import { publicEvidence } from '../pkg-logger/public-event.js';
import {
  QueueError,
  TERMINAL_STATUSES,
  applyJobPatch,
  decideAttemptUpdate,
  interruptedJob,
  newAttemptId,
  newJobRecord,
  normalizeAttemptPatch,
  normalizeClaim,
  normalizeConsumer,
  normalizeCreateRequest,
  replayOrConflict,
  requestDigest,
  terminalReceipt,
  transitionDetail,
  validateIdempotencyKey,
} from './job-contract.js';
import { UnitDbError } from '../pkg-db/index.js';
import { assertSchema, openUnitDb, probeDb, withTransaction } from '../pkg-db/pool.js';

export const QUEUE_SCHEMA_VERSION = 4;

/** Column order shared by INSERT, SELECT and the row mapping below. */
export const JOB_COLUMN_NAMES = Object.freeze([
  'id', 'type', 'payload', 'contract_type', 'status', 'progress', 'step', 'total_steps',
  'result', 'error', 'quality_gate_status', 'idempotency_key', 'request_digest',
  'created_at', 'updated_at', 'attempt_id',
]);
const JOB_COLUMNS = JOB_COLUMN_NAMES.join(', ');

const INSERT_JOB = `INSERT INTO jobs (${JOB_COLUMNS}) VALUES (${JOB_COLUMN_NAMES.map(() => '?').join(', ')})`;
const UPDATE_JOB = `UPDATE jobs SET contract_type = ?, status = ?, progress = ?, step = ?, result = ?,
  error = ?, quality_gate_status = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?`;
const INSERT_TRANSITION = `INSERT INTO job_transitions
  (job_id, kind, from_status, to_status, recorded_at, detail) VALUES (?, ?, ?, ?, ?, ?)`;
const SELECT_JOB = `SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`;
const ATTEMPT_COLUMNS = 'attempt_id, job_id, consumer, incarnation, state, claimed_at, ended_at, end_reason, request_digest, receipt';
const SELECT_ATTEMPT = `SELECT ${ATTEMPT_COLUMNS} FROM job_attempts WHERE attempt_id = ? FOR UPDATE`;
const SELECT_BY_KEY = `SELECT ${JOB_COLUMNS} FROM jobs WHERE idempotency_key = ?`;

const SQL_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/;
const DIGEST = /^[0-9a-f]{64}$/;

/** ISO-8601 UTC → the DATETIME(3) literal the unit stores (always UTC). */
export function toSqlDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new TypeError(`not a timestamp: ${iso}`);
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/** DATETIME(3) as the pool returns it (dateStrings, UTC) → ISO-8601 UTC, or null. */
export function fromSqlDateTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string') return null;
  const m = value.match(SQL_DATETIME);
  if (!m) return null;
  const ms = (m[3] || '').padEnd(3, '0').slice(0, 3);
  const date = new Date(`${m[1]}T${m[2]}.${ms}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A job id that stays unique across restarts of the process. */
export function newJobId() {
  return `job-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * The parameters that write a job row, in JOB_COLUMN_NAMES order.
 * @param {object} job - an API-shaped job record
 */
export function jobToParams(job) {
  return [
    job.id,
    job.type,
    JSON.stringify(job.payload),
    job.contractType ?? null,
    job.status,
    job.progress,
    job.step,
    job.totalSteps,
    job.result === null || job.result === undefined ? null : JSON.stringify(job.result),
    job.error ?? null,
    job.qualityGateStatus ?? null,
    job.idempotencyKey ?? null,
    job.requestDigest,
    toSqlDateTime(job.createdAt),
    toSqlDateTime(job.updatedAt),
    job.attemptId ?? null,
  ];
}

/**
 * Reads a job row back into the API's job shape. A row that cannot be read is
 * a typed integrity error — never skipped, never guessed around.
 * @param {Record<string, unknown>} row
 */
export function rowToJob(row) {
  const id = row ? row.id : undefined;
  const invalid = (why) => new QueueError(
    'QUEUE_ROW_INVALID',
    `jobs row ${JSON.stringify(id ?? null)} cannot be read back: ${why}`,
    { jobId: typeof id === 'string' ? id : null },
  );
  const json = (value, name) => {
    if (value === null || value === undefined) return null;
    const text = Buffer.isBuffer(value) ? value.toString('utf8') : value;
    if (typeof text !== 'string') return text; // a driver that already decoded JSON
    try {
      return JSON.parse(text);
    } catch (err) {
      throw invalid(`${name} is not JSON (${err.message})`);
    }
  };
  const optionalText = (value, name) => {
    if (value === null || value === undefined) return null;
    const text = Buffer.isBuffer(value) ? value.toString('utf8') : value;
    if (typeof text !== 'string') throw invalid(`${name} is not text`);
    return text;
  };
  const integer = (value, name) => {
    const n = Number(value);
    if (value === null || value === undefined || !Number.isSafeInteger(n)) throw invalid(`${name} is not an integer`);
    return n;
  };

  if (typeof id !== 'string' || !id) throw invalid('no id');
  const type = optionalText(row.type, 'type');
  const status = optionalText(row.status, 'status');
  if (!type) throw invalid('no type');
  if (!status) throw invalid('no status');
  const payload = json(row.payload, 'payload');
  if (payload === null) throw invalid('payload is null');
  const progress = Number(row.progress);
  if (row.progress === null || row.progress === undefined || !Number.isFinite(progress)) throw invalid('progress is not a number');
  const createdAt = fromSqlDateTime(row.created_at);
  const updatedAt = fromSqlDateTime(row.updated_at);
  if (!createdAt) throw invalid('created_at is not a timestamp');
  if (!updatedAt) throw invalid('updated_at is not a timestamp');
  if (typeof row.request_digest !== 'string' || !DIGEST.test(row.request_digest)) throw invalid('request_digest is not a SHA-256');
  const idempotencyKey = optionalText(row.idempotency_key, 'idempotency_key');
  if (idempotencyKey !== null) {
    try {
      validateIdempotencyKey(idempotencyKey);
    } catch {
      throw invalid('idempotency_key is outside the key grammar');
    }
  }

  const attemptId = optionalText(row.attempt_id, 'attempt_id');
  return {
    attemptId,
    id,
    type,
    payload,
    contractType: optionalText(row.contract_type, 'contract_type'),
    status,
    progress,
    step: integer(row.step, 'step'),
    totalSteps: integer(row.total_steps, 'total_steps'),
    createdAt,
    updatedAt,
    result: json(row.result, 'result'),
    error: optionalText(row.error, 'error'),
    qualityGateStatus: optionalText(row.quality_gate_status, 'quality_gate_status'),
    idempotencyKey,
    requestDigest: row.request_digest,
  };
}

/** An attempt row in the shape decideAttemptUpdate reads. */
export function rowToAttempt(row) {
  if (!row) return null;
  let receipt = null;
  if (row.receipt !== null && row.receipt !== undefined) {
    try { receipt = JSON.parse(Buffer.isBuffer(row.receipt) ? row.receipt.toString('utf8') : row.receipt); }
    catch { throw new QueueError('QUEUE_ROW_INVALID', `job_attempts row ${row.attempt_id} holds an unreadable receipt`); }
  }
  return {
    id: row.attempt_id,
    jobId: row.job_id,
    consumer: row.consumer,
    incarnation: row.incarnation,
    state: row.state,
    claimedAt: fromSqlDateTime(row.claimed_at),
    endedAt: fromSqlDateTime(row.ended_at),
    endReason: row.end_reason ?? null,
    requestDigest: row.request_digest ?? null,
    receipt,
  };
}

/**
 * Which unique key a failed INSERT collided with, read from the server's
 * message ("Duplicate entry '…' for key 'jobs_idempotency_key'"), or null when
 * the error is not a duplicate-key error. The last quoted name is the key: the
 * entry value comes first and cannot be mistaken for it.
 * @param {Error & { code?: string, errno?: number, sqlMessage?: string }} err
 * @returns {'idempotency_key'|'primary'|'other'|null}
 */
export function duplicateKeyTarget(err) {
  if (!err || (err.code !== 'ER_DUP_ENTRY' && err.errno !== 1062)) return null;
  const message = String(err.sqlMessage || err.message || '');
  const m = message.match(/for key '([^']+)'\s*$/);
  const key = m ? m[1].split('.').pop() : '';
  if (key === 'jobs_idempotency_key') return 'idempotency_key';
  if (key === 'PRIMARY') return 'primary';
  return 'other';
}

function transitionParams(job, kind, before) {
  return [
    job.id,
    kind,
    before ? before.status : null,
    job.status,
    toSqlDateTime(job.updatedAt),
    transitionDetail(kind, before, job),
  ];
}

/**
 * The evidence of a job transition. Its source is the unit, `queue`, which the
 * entrypoint guarantees is the unit's own name; a job type that looks like a
 * credential is reduced to a digest rather than stopping the transition.
 */
function evidence(job, event, level = 'INFO', extra = {}) {
  return publicEvidence({ pod: 'queue', event, level, correlationId: job.id, executionId: job.id,
    data: { jobId: job.id, type: job.type, status: job.status, ...extra } });
}

/**
 * Reads every job row once and refuses to serve if one cannot be read back,
 * and checks the history table the writes need is installed.
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<{ jobs: number, byStatus: Record<string, number> }>}
 */
export async function hydrate(pool) {
  try {
    await pool.query('SELECT transition_id FROM job_transitions LIMIT 1');
    await pool.query('SELECT event_id FROM event_outbox LIMIT 1');
    await pool.query('SELECT attempt_id FROM job_attempts LIMIT 1');
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      throw new UnitDbError('SCHEMA_MISSING', 'queue history, attempts or event_outbox is absent: install queue\'s schema through the administrative path');
    }
    throw err;
  }
  const [rows] = await pool.query(`SELECT ${JOB_COLUMNS} FROM jobs ORDER BY created_at, id`);
  const byStatus = {};
  for (const row of rows) {
    const job = rowToJob(row);
    byStatus[job.status] = (byStatus[job.status] || 0) + 1;
  }
  return { jobs: rows.length, byStatus };
}

export class MariaDbJobQueue extends EventEmitter {
  /**
   * Opens the unit database, checks the schema the administrative path
   * installed, then reads every job back before anything is served.
   *
   * @param {object} [options]
   * @param {string} [options.slug='queue']
   * @param {object} [options.db] - forwarded to openUnitDb (appsRoot, socketPath, env…)
   * @returns {Promise<MariaDbJobQueue>}
   */
  static async open({ slug = 'queue', db = {}, ...options } = {}) {
    const { pool, config } = await openUnitDb({ slug, ...db });
    try {
      const schemaVersion = await assertSchema(pool, { unit: 'queue', minVersion: QUEUE_SCHEMA_VERSION });
      const hydrated = await hydrate(pool);
      return new MariaDbJobQueue({ ...options, pool, config, schemaVersion, hydrated });
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
  }

  constructor({
    pool,
    config = null,
    schemaVersion = null,
    hydrated = null,
    loggerUrl = null,
    fetchImpl = fetch,
    enforceQualityGate = false,
    gedRoot = null,
    now = () => new Date(),
    newId = newJobId,
    consumer = localConsumer(),
  }) {
    super();
    this.localConsumer = normalizeConsumer(consumer);
    this.pool = pool;
    this.config = config;
    this.schemaVersion = schemaVersion;
    this.hydrated = hydrated;
    this.loggerUrl = loggerUrl;
    this.fetchImpl = fetchImpl;
    this.enforceQualityGate = enforceQualityGate;
    this.gedRoot = gedRoot;
    this.now = now;
    this.newId = newId;
    this.storageKind = 'mariadb';
    this.persisted = true;
  }

  /**
   * Accepts a job, or recognises a replay of one.
   *
   * With an idempotency key, the UNIQUE constraint decides — not the
   * pre-check, which only saves a round trip. Two simultaneous requests under
   * one key both pass the pre-check; one INSERT wins, the other collides on
   * the key, rolls back, and answers from the row that won.
   *
   * @returns {Promise<{ job: object, duplicate: boolean }>}
   */
  async enqueue(request) {
    const normalized = normalizeCreateRequest(request);
    const digest = requestDigest(normalized);
    const key = normalized.idempotencyKey;
    if (key) {
      const existing = await this.findByIdempotencyKey(key);
      if (existing) return replayOrConflict(existing, digest, key);
    }

    for (let attempt = 1; ; attempt += 1) {
      const job = newJobRecord(normalized, { id: this.newId(), digest, now: this.now() });
      // JSON round trip: the job answered is the job the row holds.
      job.payload = JSON.parse(JSON.stringify(job.payload));
      try {
        await withTransaction(this.pool, async (conn) => {
          await conn.execute(INSERT_JOB, jobToParams(job));
          await conn.execute(INSERT_TRANSITION, transitionParams(job, 'created', null));
          await appendOutbox(conn, evidence(job, 'JOB_CREATED'));
        });
      } catch (err) {
        const collision = duplicateKeyTarget(err);
        if (collision === 'idempotency_key' && key) {
          const winner = await this.findByIdempotencyKey(key);
          if (winner) return replayOrConflict(winner, digest, key);
        } else if (collision !== 'primary') {
          throw err;
        }
        // A job id collision, or a key whose holder vanished: try again, bounded.
        if (attempt >= 3) throw err;
        continue;
      }

      this.emit('jobCreated', job);
      this.emit('statusChange', job);
      return { job, duplicate: false };
    }
  }

  async createJob(request) {
    return (await this.enqueue(request)).job;
  }

  /**
   * Claims a PENDING job for a consumer (DECISIONS-20261011 §G): in one
   * transaction, under the job row's lock, one attempt bound to the consumer's
   * unit and incarnation, the job RUNNING under it, its history row and its
   * JOB_CLAIMED evidence. The same consumer and incarnation claiming the job
   * it already holds gets its attempt back and changes nothing.
   * @param {string} jobId
   * @param {{ unit: string, incarnation: string }} [consumer]
   * @param {object} [initial] - { progress, step, result }
   * @returns {Promise<{ job: object, attempt: object, duplicate: boolean }>}
   */
  async claimJob(jobId, consumer = this.localConsumer, initial = {}) {
    const who = normalizeConsumer(consumer);
    const first = normalizeClaim(initial);
    const out = await withTransaction(this.pool, async (conn) => {
      const [rows] = await conn.execute(`${SELECT_JOB} FOR UPDATE`, [jobId]);
      if (!rows.length) throw new QueueError('JOB_NOT_FOUND', `Job ${jobId} not found`);
      const current = rowToJob(rows[0]);
      if (current.status === 'RUNNING' && current.attemptId) {
        const [held] = await conn.execute(SELECT_ATTEMPT, [current.attemptId]);
        const attempt = rowToAttempt(held[0]);
        if (attempt && attempt.state === 'ACTIVE' && attempt.consumer === who.unit && attempt.incarnation === who.incarnation) {
          return { job: current, attempt: publicAttempt(attempt), duplicate: true };
        }
      }
      if (current.status !== 'PENDING') {
        throw new QueueError('JOB_STATE_CHANGED', `Job ${jobId} is ${current.status}, not PENDING`, { jobId, status: current.status });
      }
      const now = this.now();
      const attempt = { id: newAttemptId(), jobId, consumer: who.unit, incarnation: who.incarnation, state: 'ACTIVE', claimedAt: now.toISOString() };
      const next = { ...applyJobPatch(current, { ...first, status: 'RUNNING' }, { gate: () => ({ passed: true }), now }), attemptId: attempt.id };
      if (next.result !== null && next.result !== undefined) next.result = JSON.parse(JSON.stringify(next.result));
      await conn.execute(`INSERT INTO job_attempts (attempt_id, job_id, consumer, incarnation, state, claimed_at)
        VALUES (?, ?, ?, ?, 'ACTIVE', ?)`, [attempt.id, jobId, who.unit, who.incarnation, toSqlDateTime(attempt.claimedAt)]);
      await conn.execute(`UPDATE jobs SET status = 'RUNNING', progress = ?, step = ?, result = ?, attempt_id = ?, updated_at = ?,
        row_version = row_version + 1 WHERE id = ?`, [next.progress, next.step,
        next.result === null || next.result === undefined ? null : JSON.stringify(next.result), attempt.id, toSqlDateTime(next.updatedAt), jobId]);
      await conn.execute(INSERT_TRANSITION, transitionParams(next, 'claimed', current));
      await appendOutbox(conn, evidence(next, 'JOB_CLAIMED', 'INFO', { attemptId: attempt.id, consumer: who.unit, incarnation: who.incarnation }));
      return { job: next, attempt: publicAttempt(attempt), duplicate: false };
    });
    if (!out.duplicate) {
      this.emit('jobUpdated', out.job);
      this.emit('statusChange', out.job);
    }
    return out;
  }

  /**
   * A progress or terminal update under an attempt: the job row and the
   * attempt row are locked, the attempt checked against the job and the
   * consumer (job-contract.js decideAttemptUpdate), and the change, its history
   * row, the attempt's end and the evidence commit together. The identical
   * repeat of the accepted terminal update answers the stored receipt; a late
   * update is STALE_ATTEMPT and changes nothing.
   * @param {string} jobId
   * @param {object} patch - { attempt, progress, step, status, result, error, contractType, testRunner }
   * @param {{ consumer?: { unit: string, incarnation: string } }} [options]
   * @returns {Promise<{ job: object, receipt: object|null, duplicate: boolean }>}
   */
  async updateAttempt(jobId, patch, { consumer = this.localConsumer } = {}) {
    const { attemptId, changes, digest } = normalizeAttemptPatch(patch);
    const who = normalizeConsumer(consumer);
    const out = await withTransaction(this.pool, async (conn) => {
      const [rows] = await conn.execute(`${SELECT_JOB} FOR UPDATE`, [jobId]);
      if (!rows.length) throw new QueueError('JOB_NOT_FOUND', `Job ${jobId} not found`);
      const current = rowToJob(rows[0]);
      const [held] = await conn.execute(SELECT_ATTEMPT, [attemptId]);
      const attempt = rowToAttempt(held[0]);
      if (decideAttemptUpdate({ job: current, attempt, consumer: who, digest }) === 'replay') {
        return { job: current, receipt: attempt.receipt, duplicate: true };
      }
      const now = this.now();
      const next = applyJobPatch(current, changes, {
        gate: (candidate) => validateQualityGate(candidate, { gedRoot: this.gedRoot, testRunner: changes.testRunner }),
        now,
      });
      if (next.result !== null && next.result !== undefined) next.result = JSON.parse(JSON.stringify(next.result));
      await conn.execute(UPDATE_JOB, [
        next.contractType ?? null,
        next.status,
        next.progress,
        next.step,
        next.result === null || next.result === undefined ? null : JSON.stringify(next.result),
        next.error ?? null,
        next.qualityGateStatus ?? null,
        toSqlDateTime(next.updatedAt),
        jobId,
      ]);
      let receipt = null;
      if (TERMINAL_STATUSES.includes(next.status)) {
        receipt = terminalReceipt({ job: next, attemptId, digest, at: now.toISOString() });
        await conn.execute(`UPDATE job_attempts SET state = ?, ended_at = ?, end_reason = 'terminal', request_digest = ?, receipt = ?
          WHERE attempt_id = ? AND state = 'ACTIVE'`, [next.status, toSqlDateTime(receipt.acceptedAt), digest, JSON.stringify(receipt), attemptId]);
      }
      await conn.execute(INSERT_TRANSITION, transitionParams(next, 'updated', current));
      const terminal = terminalAudit(next);
      await appendOutbox(conn, evidence(next, terminal?.[0] || 'JOB_UPDATED', terminal?.[1] || 'INFO', { attemptId }));
      return { job: next, receipt, duplicate: false };
    });
    if (!out.duplicate) {
      this.emit('jobUpdated', out.job);
      this.emit('statusChange', out.job);
    }
    return out;
  }

  /** updateAttempt, answering the job alone. */
  async updateJobProgress(jobId, patch, options = {}) {
    return (await this.updateAttempt(jobId, patch, options)).job;
  }

  /** The attempts of one job, oldest first. */
  async listAttempts(jobId) {
    const [rows] = await this.pool.execute(`SELECT ${ATTEMPT_COLUMNS} FROM job_attempts WHERE job_id = ? ORDER BY claimed_at, attempt_id`, [jobId]);
    return rows.map(rowToAttempt);
  }

  /**
   * Restart recovery, run by the service lifecycle before it serves: every job
   * still RUNNING was being followed by a process that no longer exists, so it
   * becomes FAILED with the interrupted reason — whatever the worker setting,
   * whatever the job type — with its history row and its JOB_FAILED evidence
   * in the same transaction. Nothing is re-executed; PENDING jobs are left for
   * their first execution.
   *
   * @returns {Promise<object[]>} the jobs settled, as stored
   */
  async recoverInterrupted() {
    const settled = await withTransaction(this.pool, async (conn) => {
      const [rows] = await conn.query(`SELECT ${JOB_COLUMNS} FROM jobs WHERE status = 'RUNNING' ORDER BY created_at, id FOR UPDATE`);
      const out = [];
      for (const row of rows) {
        const current = rowToJob(row);
        const next = interruptedJob(current, this.now());
        // The attempt that was running ends with it: a late update under it is
        // STALE_ATTEMPT, and the job is never re-run by this recovery.
        if (current.attemptId) {
          await conn.execute(`UPDATE job_attempts SET state = 'INVALIDATED', ended_at = ?, end_reason = 'interrupted'
            WHERE attempt_id = ? AND state = 'ACTIVE'`, [toSqlDateTime(next.updatedAt), current.attemptId]);
        }
        await conn.execute(UPDATE_JOB, [
          next.contractType ?? null,
          next.status,
          next.progress,
          next.step,
          next.result === null || next.result === undefined ? null : JSON.stringify(next.result),
          next.error,
          next.qualityGateStatus ?? null,
          toSqlDateTime(next.updatedAt),
          next.id,
        ]);
        await conn.execute(INSERT_TRANSITION, transitionParams(next, 'interrupted', current));
        await appendOutbox(conn, evidence(next, 'JOB_FAILED', 'ERROR', { reason: 'interrupted', outcome: 'unknown', ...(current.attemptId ? { attemptId: current.attemptId } : {}) }));
        out.push(next);
      }
      return out;
    });
    for (const job of settled) {
      this.emit('jobUpdated', job);
      this.emit('statusChange', job);
    }
    return settled;
  }

  /** Records a quality-gate verdict on a job without changing its status. */
  async runQualityGate(jobId, { gedRoot = this.gedRoot, testRunner = null } = {}) {
    let gateResult;
    await withTransaction(this.pool, async (conn) => {
      const [rows] = await conn.execute(`${SELECT_JOB} FOR UPDATE`, [jobId]);
      if (!rows.length) throw new QueueError('JOB_NOT_FOUND', `Job ${jobId} not found`);
      const current = rowToJob(rows[0]);
      gateResult = validateQualityGate(current, { gedRoot, testRunner });
      const next = {
        ...current,
        qualityGateStatus: gateResult.status || (gateResult.passed ? 'PASSED' : 'FAILED'),
        error: gateResult.passed ? current.error : gateResult.error,
      };
      // The verdict moves no timestamp, as before; its history row is dated now.
      await conn.execute(
        'UPDATE jobs SET quality_gate_status = ?, error = ?, row_version = row_version + 1 WHERE id = ?',
        [next.qualityGateStatus, next.error ?? null, jobId],
      );
      await conn.execute(INSERT_TRANSITION, transitionParams({ ...next, updatedAt: this.now().toISOString() }, 'quality_gate', current));
      await appendOutbox(conn, evidence(next, 'JOB_QUALITY_GATE'));
    });
    return gateResult;
  }

  async getJob(jobId) {
    const [rows] = await this.pool.execute(SELECT_JOB, [jobId]);
    return rows.length ? rowToJob(rows[0]) : undefined;
  }

  async findByIdempotencyKey(key) {
    const [rows] = await this.pool.execute(SELECT_BY_KEY, [key]);
    return rows.length ? rowToJob(rows[0]) : null;
  }

  async listJobs({ status, type } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (type) { where.push('type = ?'); params.push(type); }
    const [rows] = await this.pool.execute(
      `SELECT ${JOB_COLUMNS} FROM jobs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, id`,
      params,
    );
    return rows.map(rowToJob);
  }

  async countJobs() {
    const [rows] = await this.pool.query('SELECT COUNT(*) AS n FROM jobs');
    return Number(rows[0].n);
  }

  async probe() {
    const db = await probeDb(this.pool);
    if (!this.config) return db;
    return { ...db, user: `${this.config.user}@localhost`, database: this.config.database, passwordSource: this.config.passwordSource };
  }

  /** The evidence still owed to Logger: observable, never silent. */
  async evidenceStatus() {
    return outboxStatus(this.pool);
  }

  async storageCheck() {
    const db = await probeDb(this.pool);
    return { kind: 'mariadb', ok: db.ok, latencyMs: db.latencyMs, ...(db.error ? { error: db.error } : {}) };
  }

  async close() {
    await this.pool.end();
  }
}
