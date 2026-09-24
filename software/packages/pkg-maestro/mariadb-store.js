/**
 * @file mariadb-store.js
 * @package @shaper/pkg-maestro
 * @description Maestro's schedules and occurrences in the unit's own private
 * MariaDB (Rules 4 and 26). MariaDB is the source of truth: timer phase,
 * planned instants, Queue receipts and misses all live here, so a restart, a
 * clock jump or a restore computes from what was recorded, never from what a
 * process happened to remember.
 *
 * Every method that changes state commits before it returns; the caller
 * reports a change only after that. The application account never creates or
 * alters a table: the schema is installed by the administrative path and this
 * store refuses to serve when it is absent or too old.
 *
 * Intent: software/packages/pkg-maestro/INTENT.md#private-mariadb
 */

import { assertSchema, openUnitDb, probeDb, withTransaction } from '../pkg-db/pool.js';
import {
  ScheduleError,
  canonicalJson,
  firstInstantAtOrAfter,
  isoUtc,
  occurrenceId,
  planEvaluation,
  sha256Hex,
} from './occurrence.js';

export const MAESTRO_SCHEMA_VERSION = 1;

/** Columns an API reader may see; the frozen request stays inside the unit. */
const PUBLIC_OCCURRENCE_COLUMNS = [
  'occurrence_id', 'schedule_id', 'revision', 'planned_at', 'trigger_kind', 'state',
  'request_digest', 'queue_job_id', 'enqueue_attempts', 'first_attempt_at', 'last_attempt_at',
  'enqueued_at', 'final_reason', 'last_error', 'created_at', 'updated_at',
].join(', ');

/** @param {number} ms @returns {string} 'YYYY-MM-DD HH:MM:SS.mmm' in UTC */
export function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * A DATETIME(3) read back with `dateStrings` is UTC text without a zone.
 * @param {string|Date|null} value
 * @returns {number|null}
 */
export function msOf(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  return Date.parse(/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
}

function isoOf(value) {
  const ms = msOf(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/** @param {object} row @returns {object} the occurrence as the API shows it */
export function publicOccurrence(row) {
  return {
    occurrenceId: row.occurrence_id,
    scheduleId: row.schedule_id,
    revision: row.revision,
    plannedAt: isoOf(row.planned_at),
    trigger: row.trigger_kind,
    state: row.state,
    queueJobId: row.queue_job_id ?? null,
    enqueueAttempts: Number(row.enqueue_attempts),
    firstAttemptAt: isoOf(row.first_attempt_at),
    lastAttemptAt: isoOf(row.last_attempt_at),
    enqueuedAt: isoOf(row.enqueued_at),
    finalReason: row.final_reason ?? null,
    lastError: row.last_error ?? null,
    requestDigest: row.request_digest ?? null,
    createdAt: isoOf(row.created_at),
    updatedAt: isoOf(row.updated_at),
  };
}

/** @param {object} row @returns {object} the schedule with its declaration parsed */
export function scheduleOf(row) {
  return {
    scheduleId: row.schedule_id,
    revision: row.revision,
    task: JSON.parse(row.task_json),
    cadenceSeconds: Number(row.cadence_seconds),
    anchorAt: isoOf(row.anchor_at),
    enabled: Number(row.enabled) === 1,
    disabledReason: row.disabled_reason ?? null,
    declaredBy: row.declared_by,
    missedPolicy: row.missed_policy,
    lateToleranceSeconds: Number(row.late_tolerance_seconds),
    revisionActiveFrom: isoOf(row.revision_active_from),
    lastPlannedAt: isoOf(row.last_planned_at),
    nextDueAt: isoOf(row.next_due_at),
    lastEvaluatedAt: isoOf(row.last_evaluated_at),
    lastEnqueuedAt: isoOf(row.last_enqueued_at),
    enqueuedTotal: Number(row.enqueued_total),
    missedTotal: Number(row.missed_total),
    missedUnrecordedTotal: Number(row.missed_unrecorded_total),
    createdAt: isoOf(row.created_at),
    revisedAt: isoOf(row.revised_at),
    updatedAt: isoOf(row.updated_at),
  };
}

export class MariaDbMaestroStore {
  /**
   * Opens the unit database over its private socket, proves the identity the
   * server granted, and checks the schema the administrative path installed.
   *
   * @param {object} [options]
   * @param {string} [options.slug='maestro']
   * @param {object} [options.db] - forwarded to openUnitDb (appsRoot, socketPath, env…)
   * @returns {Promise<MariaDbMaestroStore>}
   */
  static async open({ slug = 'maestro', db = {} } = {}) {
    const { pool, config } = await openUnitDb({ slug, ...db });
    try {
      await assertSchema(pool, { unit: 'maestro', minVersion: MAESTRO_SCHEMA_VERSION });
      return new MariaDbMaestroStore({ pool, config });
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
  }

  constructor({ pool, config }) {
    this.pool = pool;
    this.config = config;
    this.storageKind = 'mariadb';
  }

  /**
   * Materializes normalized declarations in one transaction. A changed
   * declaration becomes a new revision whose planning window starts now; the
   * occurrences of earlier revisions are left exactly as they were.
   *
   * @param {object[]} declarations - normalized (occurrence.js normalizeDeclaration)
   * @param {object} options
   * @param {'file'|'api'} options.declaredBy
   * @param {number} options.nowMs
   * @param {boolean} [options.retireUndeclared=false] - disable enabled schedules absent from `declarations`
   * @returns {Promise<{ results: Array<{ scheduleId: string, revision: string, outcome: string }>, retired: string[] }>}
   */
  async materialize(declarations, { declaredBy, nowMs, retireUndeclared = false }) {
    return withTransaction(this.pool, async (conn) => {
      const results = [];
      for (const declaration of declarations) {
        results.push(await upsertSchedule(conn, declaration, { declaredBy, nowMs }));
      }
      let retired = [];
      if (retireUndeclared) {
        const ids = declarations.map((d) => d.slug);
        const [rows] = ids.length
          ? await conn.query('SELECT schedule_id FROM schedules WHERE enabled = 1 AND schedule_id NOT IN (?) FOR UPDATE', [ids])
          : await conn.query('SELECT schedule_id FROM schedules WHERE enabled = 1 FOR UPDATE');
        retired = rows.map((r) => r.schedule_id);
        if (retired.length) {
          await conn.query(
            "UPDATE schedules SET enabled = 0, disabled_reason = 'not_declared', next_due_at = NULL, updated_at = ? WHERE schedule_id IN (?)",
            [sqlTime(nowMs), retired],
          );
        }
      }
      return { results, retired };
    });
  }

  /** @returns {Promise<string[]>} enabled schedules whose next instant has come */
  async schedulesDue(nowMs, limit = 500) {
    const [rows] = await this.pool.query(
      'SELECT schedule_id FROM schedules WHERE enabled = 1 AND next_due_at <= ? ORDER BY next_due_at LIMIT ?',
      [sqlTime(nowMs), limit],
    );
    return rows.map((r) => r.schedule_id);
  }

  /** @returns {Promise<number|null>} the earliest next instant of any enabled schedule */
  async nextDueMs() {
    const [rows] = await this.pool.query('SELECT MIN(next_due_at) AS t FROM schedules WHERE enabled = 1');
    return msOf(rows[0]?.t ?? null);
  }

  /**
   * Settles every instant of one schedule up to `nowMs`, under the schedule
   * row's lock: MISSED rows per the stored policy, at most one new DUE row
   * carrying its frozen request, and the schedule's planning bookkeeping.
   *
   * @param {string} scheduleId
   * @param {number} nowMs
   * @param {object} options
   * @param {string} options.universeId
   * @param {(task: object, occ: object) => ({ requestText: string, requestDigest: string } | { reason: string, error: string })} options.buildRequest
   */
  async evaluate(scheduleId, nowMs, { universeId, buildRequest }) {
    return withTransaction(this.pool, async (conn) => {
      const [rows] = await conn.query('SELECT * FROM schedules WHERE schedule_id = ? FOR UPDATE', [scheduleId]);
      if (!rows.length || Number(rows[0].enabled) !== 1) return null;
      const s = rows[0];
      const [[{ n: unsettled }]] = await conn.query(
        "SELECT COUNT(*) AS n FROM occurrences WHERE schedule_id = ? AND state = 'DUE'",
        [scheduleId],
      );
      const plan = planEvaluation({
        anchorMs: msOf(s.anchor_at),
        cadenceSeconds: Number(s.cadence_seconds),
        activeFromMs: msOf(s.revision_active_from),
        lastPlannedMs: msOf(s.last_planned_at),
        nowMs,
        missedPolicy: s.missed_policy,
        lateToleranceSeconds: Number(s.late_tolerance_seconds),
        hasUnsettled: Number(unsettled) > 0,
      });
      const stamp = sqlTime(nowMs);
      const idOf = (ms) => occurrenceId({ universeId, scheduleId, revision: s.revision, plannedAt: ms });

      const missed = plan.missed.map((m) => ({ id: idOf(m.plannedMs), plannedMs: m.plannedMs, reason: m.reason, error: null }));
      let due = null;
      if (plan.dueMs !== null) {
        const id = idOf(plan.dueMs);
        const built = buildRequest(JSON.parse(s.task_json), {
          occurrenceId: id, scheduleId, revision: s.revision, plannedAt: isoUtc(plan.dueMs),
        });
        if (built.requestText) due = { id, plannedMs: plan.dueMs, ...built };
        else missed.push({ id, plannedMs: plan.dueMs, reason: built.reason, error: String(built.error || '').slice(0, 512) });
      }

      // Every occurrence of this schedule is written under its row lock, so an
      // instant that already has an occurrence (an explicit one at the same
      // second) is seen here and kept; nothing is overwritten or ignored blindly.
      const candidates = [...missed.map((m) => m.id), ...(due ? [due.id] : [])];
      const [present] = candidates.length
        ? await conn.query('SELECT occurrence_id FROM occurrences WHERE occurrence_id IN (?)', [candidates])
        : [[]];
      const exists = new Set(present.map((r) => r.occurrence_id));
      const newMissed = missed.filter((m) => !exists.has(m.id));

      if (newMissed.length) {
        await conn.query(
          `INSERT INTO occurrences
             (occurrence_id, schedule_id, revision, planned_at, trigger_kind, state, final_reason, last_error, created_at, updated_at)
           VALUES ?`,
          [newMissed.map((m) => [m.id, scheduleId, s.revision, sqlTime(m.plannedMs), 'cadence', 'MISSED', m.reason, m.error, stamp, stamp])],
        );
      }

      let dueRow = null;
      let dueCreated = false;
      if (due) {
        if (!exists.has(due.id)) {
          await conn.query(
            `INSERT INTO occurrences
               (occurrence_id, schedule_id, revision, planned_at, trigger_kind, state, request_json, request_digest, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'cadence', 'DUE', ?, ?, ?, ?)`,
            [due.id, scheduleId, s.revision, sqlTime(due.plannedMs), due.requestText, due.requestDigest, stamp, stamp],
          );
          dueCreated = true;
        }
        const [again] = await conn.query('SELECT * FROM occurrences WHERE occurrence_id = ?', [due.id]);
        dueRow = again[0] || null;
      }

      const missedCount = newMissed.length + plan.missedNotRecorded;
      await conn.query(
        `UPDATE schedules
            SET last_planned_at = COALESCE(?, last_planned_at), next_due_at = ?, last_evaluated_at = ?,
                missed_total = missed_total + ?, missed_unrecorded_total = missed_unrecorded_total + ?, updated_at = ?
          WHERE schedule_id = ?`,
        [
          plan.lastPlannedMs === null ? null : sqlTime(plan.lastPlannedMs), sqlTime(plan.nextDueMs), stamp,
          missedCount, plan.missedNotRecorded, stamp, scheduleId,
        ],
      );

      return {
        scheduleId,
        revision: s.revision,
        due: dueRow,
        dueCreated,
        missed: newMissed.map((m) => ({ occurrenceId: m.id, plannedAt: isoUtc(m.plannedMs), reason: m.reason })),
        missedCount,
        missedNotRecorded: plan.missedNotRecorded,
        nextDueAt: isoUtc(plan.nextDueMs),
      };
    });
  }

  /**
   * An explicit occurrence under a declared schedule, planned at the current
   * second. Asking twice within one second names the same occurrence.
   */
  async createManual(scheduleId, nowMs, { universeId, buildRequest }) {
    return withTransaction(this.pool, async (conn) => {
      const [rows] = await conn.query('SELECT * FROM schedules WHERE schedule_id = ? FOR UPDATE', [scheduleId]);
      if (!rows.length) throw new ScheduleError('SCHEDULE_UNKNOWN', `Task not registered in Maestro: ${scheduleId}`, 404);
      const s = rows[0];
      if (Number(s.enabled) !== 1) {
        throw new ScheduleError('SCHEDULE_DISABLED', `schedule ${scheduleId} is disabled (${s.disabled_reason || 'declared disabled'})`, 409);
      }
      const task = JSON.parse(s.task_json);
      const plannedMs = Math.floor(nowMs / 1000) * 1000;
      const plannedAt = isoUtc(plannedMs);
      const id = occurrenceId({ universeId, scheduleId, revision: s.revision, plannedAt });
      const [existing] = await conn.query('SELECT * FROM occurrences WHERE occurrence_id = ?', [id]);
      if (existing.length) return { occurrence: existing[0], created: false, kind: task.kind };

      const stamp = sqlTime(nowMs);
      const built = buildRequest(task, { occurrenceId: id, scheduleId, revision: s.revision, plannedAt });
      if (built.requestText) {
        await conn.query(
          `INSERT INTO occurrences
             (occurrence_id, schedule_id, revision, planned_at, trigger_kind, state, request_json, request_digest, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'manual', 'DUE', ?, ?, ?, ?)`,
          [id, scheduleId, s.revision, sqlTime(plannedMs), built.requestText, built.requestDigest, stamp, stamp],
        );
      } else {
        await conn.query(
          `INSERT INTO occurrences
             (occurrence_id, schedule_id, revision, planned_at, trigger_kind, state, final_reason, last_error, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'manual', 'MISSED', ?, ?, ?, ?)`,
          [id, scheduleId, s.revision, sqlTime(plannedMs), built.reason, String(built.error || '').slice(0, 512), stamp, stamp],
        );
        await conn.query('UPDATE schedules SET missed_total = missed_total + 1, updated_at = ? WHERE schedule_id = ?', [stamp, scheduleId]);
      }
      const [created] = await conn.query('SELECT * FROM occurrences WHERE occurrence_id = ?', [id]);
      return { occurrence: created[0], created: true, kind: task.kind };
    });
  }

  /** Unsettled responsibility, oldest first, bounded. */
  async listDue(limit = 100) {
    const [rows] = await this.pool.query(
      "SELECT * FROM occurrences WHERE state = 'DUE' ORDER BY planned_at, occurrence_id LIMIT ?",
      [limit],
    );
    return rows;
  }

  /** Only what the wait computation needs, without the frozen requests. */
  async listDueTiming(limit = 100) {
    const [rows] = await this.pool.query(
      "SELECT enqueue_attempts, last_attempt_at FROM occurrences WHERE state = 'DUE' ORDER BY planned_at LIMIT ?",
      [limit],
    );
    return rows;
  }

  async countDue() {
    const [[{ n }]] = await this.pool.query("SELECT COUNT(*) AS n FROM occurrences WHERE state = 'DUE'");
    return Number(n);
  }

  async getOccurrence(id) {
    const [rows] = await this.pool.query('SELECT * FROM occurrences WHERE occurrence_id = ?', [id]);
    return rows[0] || null;
  }

  /**
   * Counts one enqueue attempt, durably, before the request leaves. Returns
   * false when the occurrence is no longer DUE (settled by another path).
   */
  async claimAttempt(id, nowMs) {
    const stamp = sqlTime(nowMs);
    const [res] = await this.pool.query(
      `UPDATE occurrences
          SET enqueue_attempts = enqueue_attempts + 1, first_attempt_at = COALESCE(first_attempt_at, ?),
              last_attempt_at = ?, updated_at = ?
        WHERE occurrence_id = ? AND state = 'DUE'`,
      [stamp, stamp, stamp, id],
    );
    return res.affectedRows === 1;
  }

  /**
   * Queue durably holds the job: record its id, then the occurrence is
   * ENQUEUED. The schedule row is locked first, in the same order every
   * writer of this schedule uses, so two writers never wait on each other.
   */
  async markEnqueued(id, scheduleId, { jobId, reason, nowMs }) {
    return withTransaction(this.pool, async (conn) => {
      const stamp = sqlTime(nowMs);
      await conn.query('SELECT schedule_id FROM schedules WHERE schedule_id = ? FOR UPDATE', [scheduleId]);
      const [res] = await conn.query(
        `UPDATE occurrences
            SET state = 'ENQUEUED', queue_job_id = ?, enqueued_at = ?, final_reason = ?, last_error = NULL, updated_at = ?
          WHERE occurrence_id = ? AND state = 'DUE'`,
        [jobId, stamp, reason, stamp, id],
      );
      if (res.affectedRows !== 1) return false;
      await conn.query(
        `UPDATE schedules
            SET enqueued_total = enqueued_total + 1,
                last_enqueued_at = IF(last_enqueued_at IS NULL OR last_enqueued_at < ?, ?, last_enqueued_at),
                updated_at = ?
          WHERE schedule_id = ?`,
        [stamp, stamp, stamp, scheduleId],
      );
      return true;
    });
  }

  /** A DUE occurrence that will not be enqueued: MISSED with its typed reason. */
  async settleMissed(id, scheduleId, { reason, error = null, nowMs }) {
    return withTransaction(this.pool, async (conn) => {
      const stamp = sqlTime(nowMs);
      await conn.query('SELECT schedule_id FROM schedules WHERE schedule_id = ? FOR UPDATE', [scheduleId]);
      const [res] = await conn.query(
        `UPDATE occurrences SET state = 'MISSED', final_reason = ?, last_error = ?, updated_at = ?
          WHERE occurrence_id = ? AND state = 'DUE'`,
        [reason, error === null ? null : String(error).slice(0, 512), stamp, id],
      );
      if (res.affectedRows !== 1) return false;
      await conn.query('UPDATE schedules SET missed_total = missed_total + 1, updated_at = ? WHERE schedule_id = ?', [stamp, scheduleId]);
      return true;
    });
  }

  /** The attempt failed without a durable answer; the occurrence stays DUE. */
  async recordAttemptError(id, { error, nowMs }) {
    await this.pool.query(
      "UPDATE occurrences SET last_error = ?, updated_at = ? WHERE occurrence_id = ? AND state = 'DUE'",
      [String(error).slice(0, 512), sqlTime(nowMs), id],
    );
  }

  /** The schedule's latest ENQUEUED occurrence planned before `plannedMs`. */
  async previousEnqueued(scheduleId, plannedMs) {
    const [rows] = await this.pool.query(
      `SELECT occurrence_id, queue_job_id FROM occurrences
        WHERE schedule_id = ? AND state = 'ENQUEUED' AND planned_at < ?
        ORDER BY planned_at DESC LIMIT 1`,
      [scheduleId, sqlTime(plannedMs)],
    );
    return rows[0] || null;
  }

  async listSchedules({ includeDisabled = false } = {}) {
    const [rows] = await this.pool.query(
      `SELECT * FROM schedules${includeDisabled ? '' : ' WHERE enabled = 1'} ORDER BY schedule_id`,
    );
    return rows.map(scheduleOf);
  }

  async getSchedule(scheduleId) {
    const [rows] = await this.pool.query('SELECT * FROM schedules WHERE schedule_id = ?', [scheduleId]);
    return rows.length ? scheduleOf(rows[0]) : null;
  }

  async countEnabled() {
    const [[{ n }]] = await this.pool.query('SELECT COUNT(*) AS n FROM schedules WHERE enabled = 1');
    return Number(n);
  }

  /** Bounded read of Maestro's own record, newest first. */
  async listOccurrences({ scheduleId = null, state = null, limit }) {
    const where = [];
    const params = [];
    if (scheduleId) { where.push('schedule_id = ?'); params.push(scheduleId); }
    if (state) { where.push('state = ?'); params.push(state); }
    params.push(limit);
    const [rows] = await this.pool.query(
      `SELECT ${PUBLIC_OCCURRENCE_COLUMNS} FROM occurrences
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY planned_at DESC, occurrence_id LIMIT ?`,
      params,
    );
    return rows.map(publicOccurrence);
  }

  async probe() {
    const db = await probeDb(this.pool);
    return { ...db, user: `${this.config.user}@localhost`, database: this.config.database, passwordSource: this.config.passwordSource };
  }

  async close() {
    await this.pool.end();
  }
}

/**
 * One declaration, under its schedule row's lock.
 * @returns {Promise<{ scheduleId: string, revision: string, outcome: 'created'|'revised'|'reenabled'|'unchanged' }>}
 */
async function upsertSchedule(conn, declaration, { declaredBy, nowMs }) {
  const taskJson = canonicalJson(declaration);
  const revision = sha256Hex(taskJson);
  const scheduleId = declaration.slug;
  const stamp = sqlTime(nowMs);
  const anchorMs = Date.parse(declaration.anchorAt);
  const nextDue = declaration.enabled
    ? sqlTime(firstInstantAtOrAfter(anchorMs, declaration.cadenceSeconds, nowMs))
    : null;
  const disabledReason = declaration.enabled ? null : 'declared_disabled';

  await conn.query(
    `INSERT INTO schedule_revisions (schedule_id, revision, task_json, first_materialized_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE revision = revision`,
    [scheduleId, revision, taskJson, stamp],
  );
  const [rows] = await conn.query('SELECT revision, enabled, declared_by FROM schedules WHERE schedule_id = ? FOR UPDATE', [scheduleId]);

  if (!rows.length) {
    await conn.query(
      `INSERT INTO schedules
         (schedule_id, revision, cadence_seconds, anchor_at, task_json, enabled, disabled_reason, declared_by,
          missed_policy, late_tolerance_seconds, revision_active_from, last_planned_at, next_due_at,
          created_at, revised_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        scheduleId, revision, declaration.cadenceSeconds, sqlTime(anchorMs), taskJson, declaration.enabled ? 1 : 0,
        disabledReason, declaredBy, declaration.missedPolicy, declaration.lateToleranceSeconds, stamp, nextDue,
        stamp, stamp, stamp,
      ],
    );
    return { scheduleId, revision, outcome: 'created' };
  }

  const current = rows[0];
  const wasEnabled = Number(current.enabled) === 1;
  if (current.revision !== revision || (declaration.enabled && !wasEnabled)) {
    // A new revision — or the same one declared again after it was retired —
    // starts its planning window now: instants from before it existed are
    // neither due nor missed.
    await conn.query(
      `UPDATE schedules
          SET revision = ?, cadence_seconds = ?, anchor_at = ?, task_json = ?, enabled = ?, disabled_reason = ?,
              declared_by = ?, missed_policy = ?, late_tolerance_seconds = ?, revision_active_from = ?,
              last_planned_at = NULL, next_due_at = ?, revised_at = ?, updated_at = ?
        WHERE schedule_id = ?`,
      [
        revision, declaration.cadenceSeconds, sqlTime(anchorMs), taskJson, declaration.enabled ? 1 : 0, disabledReason,
        declaredBy, declaration.missedPolicy, declaration.lateToleranceSeconds, stamp, nextDue, stamp, stamp, scheduleId,
      ],
    );
    return { scheduleId, revision, outcome: current.revision !== revision ? 'revised' : 'reenabled' };
  }

  if (current.declared_by !== declaredBy) {
    await conn.query('UPDATE schedules SET declared_by = ?, updated_at = ? WHERE schedule_id = ?', [declaredBy, stamp, scheduleId]);
  }
  return { scheduleId, revision, outcome: 'unchanged' };
}
