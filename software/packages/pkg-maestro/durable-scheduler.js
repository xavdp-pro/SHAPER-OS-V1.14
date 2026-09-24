/**
 * @file durable-scheduler.js
 * @package @shaper/pkg-maestro
 * @description Maestro with its schedules and occurrences in its private
 * MariaDB. It decides when declared recurring work is due and submits ONE
 * idempotent occurrence per due instant to Queue — nothing else: it never calls
 * a bridge, never runs the work, never judges its result.
 *
 * ── The loop ───────────────────────────────────────────────────────────────
 * One tick, serialised, then one wait:
 *
 *   1. unsettled responsibility first — every DUE occurrence whose retry time
 *      has come (all of them on the first tick after a start) is submitted
 *      again under its own key;
 *   2. every enabled schedule whose next instant has come is evaluated under
 *      its row lock: MISSED rows per the stored policy, at most one new DUE row
 *      carrying the exact request, committed;
 *   3. the new DUE occurrence is submitted.
 *
 * The wait is computed from the database (earliest next instant, earliest
 * retry), never from timer phase, and never exceeds `maxWaitMs`, so a clock
 * jump is noticed and reconciled through occurrence identities.
 *
 * ── What is claimed, and when ──────────────────────────────────────────────
 * A request leaves only for an occurrence whose DUE row is committed, after
 * its attempt is counted. ENQUEUED is written only once Queue answered with a
 * job id, and only then is BEAT_ENQUEUED reported. A database failure stops
 * the tick: nothing is claimed as emitted, and the next tick starts again from
 * what MariaDB holds.
 *
 * Intent: software/packages/pkg-maestro/INTENT.md#private-mariadb
 */

import { EventLogger } from '../pkg-logger/index.js';
import { ageSeconds, dependency, vitals } from '../pkg-logger/vitals.js';
import { ingestLog } from '../pkg-logger/ingest-client.js';
import { readTaskContext } from '../pkg-agent-runtime/context.js';
import { occurrenceRequestText } from './queue-beat.js';
import {
  ScheduleError,
  assertUniverseId,
  classifyQueueAnswer,
  normalizeDeclaration,
  retryDelayMs,
  sha256Hex,
} from './occurrence.js';
import { msOf, publicOccurrence } from './mariadb-store.js';

export const DEFAULT_MAX_ENQUEUE_ATTEMPTS = 8;
const OPEN_JOB_STATES = new Set(['PENDING', 'RUNNING']);
const TICK_FAILURE_BACKOFF_MS = 5_000;
const MIN_WAIT_MS = 1_000;
const DUE_BATCH = 100;

/**
 * Snapshot the task's declared context and freeze the request an occurrence
 * will send on every attempt. An unreadable declared context is a typed miss,
 * never a job without the context it was declared with.
 */
export function buildOccurrenceRequest(task, occurrence) {
  let context;
  try {
    context = readTaskContext(task);
  } catch (err) {
    return { reason: 'context_unreadable', error: err.message };
  }
  const requestText = occurrenceRequestText(task, context, occurrence);
  return { requestText, requestDigest: sha256Hex(requestText) };
}

/** The registered-task view of a stored schedule: today's entry shape, plus the durable fields. */
export function scheduleEntry(schedule) {
  const t = schedule.task;
  return {
    slug: schedule.scheduleId,
    kind: t.kind,
    cadenceSeconds: schedule.cadenceSeconds,
    instruction: t.instruction,
    bridgeType: t.bridgeType,
    bridgeUrl: t.bridgeUrl,
    contextPath: t.contextPath,
    contextText: t.contextText,
    beatMessage: t.beatMessage,
    checkpointPath: t.checkpointPath,
    vaultKey: t.vaultKey,
    label: t.label,
    port: t.port,
    model: t.model,
    jobType: t.jobType,
    status: schedule.enabled ? 'active' : 'disabled',
    lastBeatAt: schedule.lastEnqueuedAt,
    processedTotal: 0,
    registeredAt: schedule.createdAt,
    scheduleId: schedule.scheduleId,
    revision: schedule.revision,
    missedPolicy: schedule.missedPolicy,
    lateToleranceSeconds: schedule.lateToleranceSeconds,
    anchorAt: schedule.anchorAt,
    revisionActiveFrom: schedule.revisionActiveFrom,
    lastPlannedAt: schedule.lastPlannedAt,
    nextDueAt: schedule.nextDueAt,
    declaredBy: schedule.declaredBy,
    disabledReason: schedule.disabledReason,
    enqueuedTotal: schedule.enqueuedTotal,
    missedTotal: schedule.missedTotal,
    missedUnrecordedTotal: schedule.missedUnrecordedTotal,
  };
}

export class DurableMaestro {
  /**
   * @param {object} options
   * @param {object} options.store - a MariaDbMaestroStore
   * @param {string} options.universeId - SHAPER_UNIVERSE_ID, part of every occurrence id
   * @param {string} options.queueUrl
   * @param {string} [options.authToken] - bearer sent to Queue
   * @param {string|null} [options.loggerUrl]
   * @param {string} [options.service]
   * @param {string} options.logDir - local JSONL audit (evidence, not state)
   * @param {typeof fetch} [options.fetchImpl]
   * @param {() => number} [options.now]
   * @param {number} [options.maxEnqueueAttempts]
   * @param {number} [options.requestTimeoutMs]
   * @param {number} [options.maxWaitMs]
   */
  constructor({
    store,
    universeId,
    queueUrl,
    authToken = '',
    loggerUrl = null,
    service = 'brick-maestro',
    logDir,
    fetchImpl = fetch,
    now = Date.now,
    maxEnqueueAttempts = DEFAULT_MAX_ENQUEUE_ATTEMPTS,
    requestTimeoutMs = 10_000,
    maxWaitMs = 60_000,
  } = {}) {
    if (!store) throw new Error('store is required');
    if (!queueUrl) {
      throw new ScheduleError('QUEUE_URL_MISSING', 'a queue URL is required: every occurrence goes through Queue');
    }
    this.store = store;
    this.universeId = assertUniverseId(universeId);
    this.queueUrl = queueUrl.replace(/\/$/, '');
    this.authToken = authToken;
    this.loggerUrl = loggerUrl;
    this.service = service;
    this.logger = new EventLogger({ pod: service, logDir });
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.maxEnqueueAttempts = maxEnqueueAttempts;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxWaitMs = maxWaitMs;

    this.storageKind = 'mariadb';
    this.isRunning = false;
    this.startedAt = new Date(now()).toISOString();
    this.queueSeen = { lastOkAt: null, lastError: null, attempts: 0 };
    this.lastTick = { at: null, ok: null, error: null };
    this.lastSkipped = new Map();
    this._timer = null;
    this._ticking = null;
    this._again = false;
    this._inFlight = new Set();
    this._buildRequest = buildOccurrenceRequest;
  }

  // ── Evidence ──────────────────────────────────────────────────────────────

  /** Reported only after the change it describes has committed. */
  _record(event, data = {}, { level = 'INFO', pod = null, correlationId = null } = {}) {
    try {
      this.logger.log({ level, event, data, correlationId });
    } catch (err) {
      console.error(`[brick-maestro] local audit write failed for ${event}: ${err.code || err.message}`);
    }
    ingestLog({ loggerUrl: this.loggerUrl, pod: pod || 'maestro', event, level, correlationId, data, fetchImpl: this.fetchImpl })
      .catch(() => {});
  }

  // ── Declarations ──────────────────────────────────────────────────────────

  /**
   * The universe's declared schedules, materialized at startup. Schedules no
   * longer declared are disabled (their history stays); none is invented.
   * @param {object[]} declarations - raw or normalized task declarations
   */
  async materializeDeclared(declarations) {
    const normalized = declarations.map((d) => normalizeDeclaration(d));
    const seen = new Set();
    for (const d of normalized) {
      if (seen.has(d.slug)) throw new ScheduleError('INVALID_SCHEDULE', `task ${d.slug} is declared twice`);
      seen.add(d.slug);
    }
    const summary = await this.store.materialize(normalized, { declaredBy: 'file', nowMs: this.now(), retireUndeclared: true });
    for (const r of summary.results) {
      if (r.outcome !== 'unchanged') this._record('SCHEDULE_MATERIALIZED', r);
    }
    for (const scheduleId of summary.retired) {
      this._record('SCHEDULE_RETIRED', { scheduleId, reason: 'not_declared' }, { level: 'WARN' });
    }
    return summary;
  }

  /**
   * Registers one task through the API: a durable schedule declared by `api`.
   * It lives until the next start, which materializes the declared file again.
   */
  async registerTask(taskConfig = {}) {
    const declaration = normalizeDeclaration(taskConfig);
    const { results } = await this.store.materialize([declaration], { declaredBy: 'api', nowMs: this.now() });
    this._record('TASK_REGISTERED', {
      slug: declaration.slug, kind: declaration.kind, cadence: declaration.cadenceSeconds, ...results[0],
    });
    this._kick();
    return scheduleEntry(await this.store.getSchedule(declaration.slug));
  }

  async listRegisteredTasks({ includeDisabled = false } = {}) {
    return (await this.store.listSchedules({ includeDisabled })).map(scheduleEntry);
  }

  async listOccurrences(query) {
    return this.store.listOccurrences(query);
  }

  // ── Explicit occurrence ───────────────────────────────────────────────────

  /**
   * An explicit, immediate occurrence under a declared schedule. It follows
   * the same path as a cadence one: committed DUE, submitted, recorded.
   */
  async triggerBeat(slug) {
    const start = this.now();
    const { occurrence, created, kind } = await this.store.createManual(slug, start, {
      universeId: this.universeId, buildRequest: this._buildRequest,
    });
    if (created && occurrence.state === 'MISSED') {
      this._noteSkipped(slug, occurrence.final_reason, occurrence.occurrence_id, occurrence.planned_at);
    }
    if (occurrence.state === 'DUE') await this._submit(occurrence);
    const final = await this.store.getOccurrence(occurrence.occurrence_id);
    return {
      slug,
      kind,
      status: 'ok',
      processed: 0,
      duration_ms: this.now() - start,
      created,
      enqueued: final.state === 'ENQUEUED',
      jobId: final.queue_job_id ?? null,
      occurrence: publicOccurrence(final),
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Starts the loop. Resolves when the first tick — which reconciles every
   * unsettled occurrence before any new wait — has finished.
   */
  startScheduler() {
    if (this.isRunning) return Promise.resolve(null);
    this.isRunning = true;
    this._record('SCHEDULER_STARTED', { store: 'mariadb', universeId: this.universeId });
    return this._loop(true);
  }

  stopScheduler() {
    const wasRunning = this.isRunning;
    this.isRunning = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    if (wasRunning) this._record('SCHEDULER_STOPPED');
  }

  async close() {
    this.stopScheduler();
    if (this._ticking) await this._ticking.catch(() => {});
    await this.store.close();
  }

  _kick() {
    if (this.isRunning) this._loop(false);
  }

  async _loop(reconcileAll) {
    if (this._ticking) {
      this._again = true;
      return this._ticking.then((r) => r.summary);
    }
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this._ticking = this._tick(reconcileAll);
    let result;
    try {
      result = await this._ticking;
    } finally {
      this._ticking = null;
    }
    if (this.isRunning) {
      const wait = this._again ? 0 : result.waitMs;
      this._again = false;
      this._timer = setTimeout(() => { this._loop(false); }, wait);
      this._timer.unref?.();
    }
    return result.summary;
  }

  /** One pass; never rejects — a failure is recorded and retried later. */
  async _tick(reconcileAll) {
    const summary = { reconciled: 0, evaluated: 0, newlyDue: 0, missed: 0, enqueued: 0, retrying: 0, refused: 0 };
    const tally = (outcome) => {
      if (outcome === 'enqueued') summary.enqueued += 1;
      else if (outcome === 'retry') summary.retrying += 1;
      else if (outcome === 'missed') summary.refused += 1;
    };
    const at = new Date(this.now()).toISOString();
    try {
      // 1. Unsettled responsibility before any new instant.
      let nowMs = this.now();
      for (const occ of await this.store.listDue(DUE_BATCH)) {
        if (!this.isRunning) break;
        if (reconcileAll || this._retryAt(occ, nowMs) <= nowMs) {
          summary.reconciled += 1;
          tally(await this._submit(occ));
        }
      }

      // 2. New instants, settled per schedule under its lock; 3. submitted.
      nowMs = this.now();
      for (const scheduleId of await this.store.schedulesDue(nowMs)) {
        if (!this.isRunning) break;
        const ev = await this.store.evaluate(scheduleId, nowMs, { universeId: this.universeId, buildRequest: this._buildRequest });
        if (!ev) continue;
        summary.evaluated += 1;
        summary.missed += ev.missedCount;
        if (ev.missedCount > 0) {
          const latest = ev.missed[ev.missed.length - 1];
          this._record('OCCURRENCES_MISSED', {
            slug: scheduleId,
            revision: ev.revision,
            count: ev.missedCount,
            recorded: ev.missed.length,
            notRecorded: ev.missedNotRecorded,
            reasons: [...new Set(ev.missed.map((m) => m.reason))],
            latestPlannedAt: latest ? latest.plannedAt : null,
          }, { level: 'WARN', pod: scheduleId });
          if (latest) this.lastSkipped.set(scheduleId, latest.reason);
        }
        if (ev.due && ev.dueCreated && ev.due.state === 'DUE') {
          summary.newlyDue += 1;
          this._record('OCCURRENCE_DUE', {
            slug: scheduleId, occurrenceId: ev.due.occurrence_id, revision: ev.revision, plannedAt: publicOccurrence(ev.due).plannedAt,
          }, { correlationId: ev.due.occurrence_id });
          tally(await this._submit(ev.due));
        }
      }

      const waitMs = await this._nextWaitMs(this.now());
      this.lastTick = { at, ok: true, error: null };
      return { summary, waitMs };
    } catch (err) {
      // Nothing is claimed: whatever was committed stays true, whatever was
      // not is recomputed from MariaDB on the next tick.
      this.lastTick = { at, ok: false, error: `${err.code || err.name}: ${err.message}` };
      try {
        this.logger.log({ level: 'ERROR', event: 'MAESTRO_TICK_FAILED', data: { code: err.code || null, error: err.message, summary } });
      } catch { /* the console line below still says it */ }
      console.error(`[brick-maestro] tick failed: ${err.code || err.name} — ${err.message}`);
      return { summary, waitMs: TICK_FAILURE_BACKOFF_MS };
    }
  }

  _retryAt(occ, nowMs) {
    const attempts = Number(occ.enqueue_attempts);
    if (attempts === 0 || !occ.last_attempt_at) return nowMs;
    return msOf(occ.last_attempt_at) + retryDelayMs(attempts);
  }

  async _nextWaitMs(nowMs) {
    let target = (await this.store.nextDueMs()) ?? Infinity;
    for (const occ of await this.store.listDueTiming(DUE_BATCH)) {
      target = Math.min(target, this._retryAt(occ, nowMs));
    }
    const wait = target - nowMs;
    // An unreadable instant must never turn the loop into a spin.
    if (!Number.isFinite(wait)) return this.maxWaitMs;
    return Math.max(MIN_WAIT_MS, Math.min(this.maxWaitMs, wait));
  }

  // ── Submission ────────────────────────────────────────────────────────────

  async _submit(occ) {
    const id = occ.occurrence_id;
    if (this._inFlight.has(id)) return 'in_flight';
    this._inFlight.add(id);
    try {
      return await this._submitOnce(occ);
    } finally {
      this._inFlight.delete(id);
    }
  }

  async _submitOnce(occ) {
    const id = occ.occurrence_id;
    const scheduleId = occ.schedule_id;
    const attempts = Number(occ.enqueue_attempts);
    if (attempts >= this.maxEnqueueAttempts) {
      return this._exhaust(occ, { reason: 'enqueue_retries_exhausted', detail: occ.last_error || '' });
    }

    // One outstanding run per schedule: before the first attempt of a cadence
    // occurrence, the previous occurrence's own job is looked up by its key.
    // Queue is never asked to list everything it holds.
    if (attempts === 0 && occ.trigger_kind === 'cadence') {
      const open = await this._previousRunOpen(occ);
      if (open) {
        const settled = await this.store.settleMissed(id, scheduleId, {
          reason: 'previous_run_still_open', error: `job ${open.id} is ${open.status}`, nowMs: this.now(),
        });
        if (settled) this._noteSkipped(scheduleId, 'previous_run_still_open', id, occ.planned_at, open.id);
        return 'missed';
      }
    }

    if (!(await this.store.claimAttempt(id, this.now()))) return 'settled_elsewhere';
    const decision = classifyQueueAnswer(await this._post(occ.request_json));
    this._noteQueue(decision);

    if (decision.outcome === 'enqueued') return this._enqueued(occ, decision.jobId, decision.reason, decision.duplicate);

    if (decision.outcome === 'conflict' || decision.outcome === 'rejected') {
      const settled = await this.store.settleMissed(id, scheduleId, {
        reason: decision.reason, error: decision.detail || null, nowMs: this.now(),
      });
      if (settled) {
        this.lastSkipped.set(scheduleId, decision.reason);
        this._record('ENQUEUE_REFUSED', {
          slug: scheduleId, occurrenceId: id, reason: decision.reason, detail: decision.detail, queue: this.queueUrl,
        }, { level: 'ERROR', pod: scheduleId, correlationId: id });
      }
      return 'missed';
    }

    if (attempts + 1 >= this.maxEnqueueAttempts) return this._exhaust(occ, decision);
    await this.store.recordAttemptError(id, { error: `${decision.reason}: ${decision.detail || ''}`, nowMs: this.now() });
    this._record('ENQUEUE_RETRY', {
      slug: scheduleId, occurrenceId: id, attempt: attempts + 1, reason: decision.reason,
      retryInMs: retryDelayMs(attempts + 1), queue: this.queueUrl,
    }, { level: 'WARN', pod: scheduleId, correlationId: id });
    return 'retry';
  }

  /** Retries are spent: one lookup by the occurrence's own key decides. */
  async _exhaust(occ, decision) {
    const key = occ.occurrence_id;
    const jobs = await this._lookup(key);
    const job = jobs && jobs.find((j) => j && typeof j.id === 'string'
      && (j.idempotencyKey === key || j.payload?.occurrenceId === key));
    if (job) return this._enqueued(occ, job.id, 'queue_lookup_after_retries', true);
    const settled = await this.store.settleMissed(key, occ.schedule_id, {
      reason: 'enqueue_retries_exhausted',
      error: `${decision.reason}: ${decision.detail || ''}; lookup by key ${jobs === null ? 'failed' : 'found no job'}`,
      nowMs: this.now(),
    });
    if (settled) this._noteSkipped(occ.schedule_id, 'enqueue_retries_exhausted', key, occ.planned_at, null, 'ERROR');
    return 'missed';
  }

  async _enqueued(occ, jobId, reason, duplicate) {
    const marked = await this.store.markEnqueued(occ.occurrence_id, occ.schedule_id, { jobId, reason, nowMs: this.now() });
    if (marked) {
      // After the commit, correlated to the JOB id (runbook proof #4).
      this._record('BEAT_ENQUEUED', {
        slug: occ.schedule_id,
        jobId,
        queue: this.queueUrl,
        occurrenceId: occ.occurrence_id,
        scheduleRevision: occ.revision,
        plannedAt: publicOccurrence(occ).plannedAt,
        duplicate: Boolean(duplicate),
        reason,
      }, { correlationId: jobId });
    }
    return 'enqueued';
  }

  async _previousRunOpen(occ) {
    const previous = await this.store.previousEnqueued(occ.schedule_id, msOf(occ.planned_at));
    if (!previous || !previous.queue_job_id) return null;
    const jobs = await this._lookup(previous.occurrence_id);
    // A queue that cannot be questioned does not silence the schedule: the new
    // occurrence has its own key, so the worst case is one extra run, recorded.
    if (!jobs) return null;
    const job = jobs.find((j) => j && j.id === previous.queue_job_id);
    return job && OPEN_JOB_STATES.has(job.status) ? { id: job.id, status: job.status } : null;
  }

  _noteSkipped(scheduleId, reason, occurrenceId, plannedAt, jobId = null, level = 'WARN') {
    this.lastSkipped.set(scheduleId, reason);
    this._record('BEAT_SKIPPED', {
      slug: scheduleId, reason, occurrenceId, plannedAt: plannedAt ? new Date(msOf(plannedAt)).toISOString() : null, jobId,
    }, { level, pod: scheduleId, correlationId: jobId || occurrenceId });
  }

  _noteQueue(decision) {
    this.queueSeen.attempts += 1;
    if (decision.outcome === 'retry') {
      this.queueSeen.lastError = `${decision.reason}${decision.detail ? `: ${decision.detail}` : ''}`;
    } else {
      this.queueSeen.lastOkAt = new Date(this.now()).toISOString();
    }
  }

  _headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    return headers;
  }

  async _post(requestText) {
    try {
      const res = await this.fetchImpl(`${this.queueUrl}/api/jobs`, {
        method: 'POST', headers: this._headers(), body: requestText, signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } catch (error) {
      return { error };
    }
  }

  /** Queue's lookup by idempotency key; null when Queue could not answer. */
  async _lookup(key) {
    try {
      const res = await this.fetchImpl(`${this.queueUrl}/api/jobs?idempotencyKey=${encodeURIComponent(key)}`, {
        headers: this._headers(), signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (!res.ok) return null;
      const body = await res.json();
      return Array.isArray(body?.jobs) ? body.jobs : null;
    } catch {
      return null;
    }
  }

  // ── Observation ───────────────────────────────────────────────────────────

  async health() {
    const db = await this.store.probe();
    const base = {
      service: this.service, isRunning: this.isRunning, storage: 'mariadb', universeId: this.universeId, db,
      timestamp: new Date(this.now()).toISOString(),
    };
    if (!db.ok) return { ok: false, body: { status: 'unavailable', ...base } };
    return { ok: true, body: { status: 'ok', ...base, tasksCount: await this.store.countEnabled() } };
  }

  async vitals(now = this.now()) {
    const db = await this.store.probe();
    const signals = {
      tasksRegistered: null,
      activeTasks: null,
      isRunning: this.isRunning,
      beatsSkippedTotal: null,
      occurrencesDue: null,
      tasks: {},
    };
    if (db.ok) {
      const schedules = await this.store.listSchedules();
      signals.tasksRegistered = schedules.length;
      signals.activeTasks = schedules.length;
      signals.beatsSkippedTotal = schedules.reduce((sum, s) => sum + s.missedTotal, 0);
      signals.occurrencesDue = await this.store.countDue();
      for (const s of schedules) {
        signals.tasks[s.scheduleId] = {
          lastBeatAgeSeconds: ageSeconds(s.lastEnqueuedAt, now),
          beatsCount: s.enqueuedTotal,
          cadenceSeconds: s.cadenceSeconds,
          lastSkippedReason: this.lastSkipped.get(s.scheduleId) || null,
          missedTotal: s.missedTotal,
          nextDueAt: s.nextDueAt,
          revision: s.revision,
        };
      }
    }
    return vitals({
      service: this.service,
      startedAt: this.startedAt,
      signals,
      checks: {
        storage: { ok: db.ok, latencyMs: db.latencyMs, ...(db.error ? { error: db.error } : {}) },
        queue: dependency({
          name: 'queue', url: this.queueUrl, lastOkAt: this.queueSeen.lastOkAt,
          lastError: this.queueSeen.lastError, attempts: this.queueSeen.attempts,
        }, now),
        lastTick: { at: this.lastTick.at, ok: this.lastTick.ok, error: this.lastTick.error },
      },
    }, now);
  }
}
