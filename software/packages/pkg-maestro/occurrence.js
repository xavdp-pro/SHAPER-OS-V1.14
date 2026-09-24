/**
 * @file occurrence.js
 * @package @shaper/pkg-maestro
 * @description The pure half of Maestro's durable scheduling: what a declared
 * schedule is, which instants it plans, which of them are due or missed, how an
 * occurrence is named, and what a Queue answer means. No clock, no database, no
 * network — every function here returns the same answer for the same input, so
 * a restart, a second process or a restored database computes the same thing.
 *
 * Intent: software/packages/pkg-maestro/INTENT.md#private-mariadb
 */

import crypto from 'node:crypto';

/** Task kinds the base understands. A universe may not invent a fourth here. */
export const TASK_KINDS = new Set(['generic', 'bridge', 'queue']);

export const DEFAULT_CADENCE_SECONDS = 300;
export const DEFAULT_JOB_TYPE = 'agent.inject';
export const DEFAULT_ANCHOR_AT = '1970-01-01T00:00:00.000Z';
export const MAX_CADENCE_SECONDS = 366 * 24 * 3600;

/** Missed-occurrence policies this build implements. */
export const MISSED_POLICIES = new Set(['skip', 'coalesce_latest']);
/** Policies the target contract names and this build refuses rather than approximates. */
export const DEFERRED_MISSED_POLICIES = new Set(['catch_up_bounded', 'halt']);

export const OCCURRENCE_STATES = new Set(['PLANNED', 'DUE', 'ENQUEUED', 'MISSED', 'CANCELLED']);

/** At most this many MISSED rows are written by one evaluation; the rest are counted. */
export const MAX_MISSED_ROWS_PER_EVALUATION = 100;

export const OCCURRENCE_QUERY_DEFAULT_LIMIT = 50;
export const OCCURRENCE_QUERY_MAX_LIMIT = 500;

const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;
const JOB_TYPE_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const UNIVERSE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** A refusal Maestro can name. `status` is the HTTP answer it maps to. */
export class ScheduleError extends Error {
  /**
   * @param {string} code - stable machine-readable reason
   * @param {string} message
   * @param {number} [status=400]
   */
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ScheduleError';
    this.code = code;
    this.status = status;
  }
}

/**
 * The universe identity every occurrence id carries.
 * @param {string} universeId
 * @returns {string}
 */
export function assertUniverseId(universeId) {
  if (typeof universeId !== 'string' || !universeId.trim()) {
    throw new ScheduleError('UNIVERSE_ID_MISSING', 'SHAPER_UNIVERSE_ID is required: it is part of every occurrence identity');
  }
  if (!UNIVERSE_ID_PATTERN.test(universeId)) {
    throw new ScheduleError('UNIVERSE_ID_INVALID', `SHAPER_UNIVERSE_ID must match ${UNIVERSE_ID_PATTERN}; got ${JSON.stringify(universeId)}`);
  }
  return universeId;
}

/** @param {string} text @returns {string} lowercase hex SHA-256 */
export function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * JSON with object keys sorted at every depth and undefined dropped: two
 * declarations that say the same thing in a different key order are one text.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function optionalText(task, field) {
  const value = task[field];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ScheduleError('INVALID_SCHEDULE', `${field} must be text when declared`);
  }
  return value;
}

function isoInstant(value, field) {
  const ms = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(ms) || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new ScheduleError('INVALID_SCHEDULE', `${field} must be an ISO-8601 instant with an explicit offset; got ${JSON.stringify(value)}`);
  }
  return new Date(ms).toISOString();
}

/**
 * The one form Maestro acts on and stores: every field it understands, with its
 * default written out, and nothing else. A declaration Maestro does not fully
 * understand is refused whole — it never starts a partially understood timer.
 *
 * @param {object} task - one entry of the universe's task schedule
 * @returns {object} the normalized declaration
 */
export function normalizeDeclaration(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new ScheduleError('INVALID_SCHEDULE', 'a task declaration must be an object');
  }
  const slug = task.slug;
  if (!slug) throw new ScheduleError('INVALID_SCHEDULE', 'slug is required to register a task');
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw new ScheduleError('INVALID_SCHEDULE', `slug must match ${SLUG_PATTERN} (it is the schedule id and a URL segment); got ${JSON.stringify(slug)}`);
  }

  const kind = task.kind ?? 'generic';
  if (!TASK_KINDS.has(kind)) {
    throw new ScheduleError('INVALID_SCHEDULE', `unknown task kind: ${kind} (expected ${Array.from(TASK_KINDS).join(', ')})`);
  }

  const cadenceSeconds = task.cadenceSeconds ?? DEFAULT_CADENCE_SECONDS;
  if (!Number.isInteger(cadenceSeconds) || cadenceSeconds < 1 || cadenceSeconds > MAX_CADENCE_SECONDS) {
    throw new ScheduleError('INVALID_SCHEDULE', `cadenceSeconds must be an integer between 1 and ${MAX_CADENCE_SECONDS}; got ${JSON.stringify(task.cadenceSeconds)}`);
  }

  const missedPolicy = task.missedPolicy ?? 'skip';
  if (DEFERRED_MISSED_POLICIES.has(missedPolicy)) {
    throw new ScheduleError('INVALID_SCHEDULE', `missedPolicy "${missedPolicy}" is named by the target contract but not implemented in this build; declare skip or coalesce_latest`);
  }
  if (!MISSED_POLICIES.has(missedPolicy)) {
    throw new ScheduleError('INVALID_SCHEDULE', `missedPolicy must be one of ${Array.from(MISSED_POLICIES).join(', ')}; got ${JSON.stringify(missedPolicy)}`);
  }

  const lateToleranceSeconds = task.lateToleranceSeconds ?? defaultLateTolerance(cadenceSeconds);
  if (!Number.isInteger(lateToleranceSeconds) || lateToleranceSeconds < 1 || lateToleranceSeconds > cadenceSeconds) {
    throw new ScheduleError('INVALID_SCHEDULE', `lateToleranceSeconds must be an integer between 1 and the cadence (${cadenceSeconds}); got ${JSON.stringify(task.lateToleranceSeconds)}`);
  }

  const anchorAt = task.anchorAt == null ? DEFAULT_ANCHOR_AT : isoInstant(task.anchorAt, 'anchorAt');

  const jobType = task.jobType ?? DEFAULT_JOB_TYPE;
  if (typeof jobType !== 'string' || !JOB_TYPE_PATTERN.test(jobType)) {
    throw new ScheduleError('INVALID_SCHEDULE', `jobType must match ${JOB_TYPE_PATTERN}; got ${JSON.stringify(task.jobType)}`);
  }

  const enabled = task.enabled ?? true;
  if (typeof enabled !== 'boolean') throw new ScheduleError('INVALID_SCHEDULE', 'enabled must be true or false when declared');

  const port = task.port ?? null;
  if (port !== null && !(Number.isInteger(port) && port > 0 && port < 65536)) {
    throw new ScheduleError('INVALID_SCHEDULE', `port must be a TCP port number when declared; got ${JSON.stringify(task.port)}`);
  }

  const bridgeUrl = optionalText(task, 'bridgeUrl') || (port ? `http://127.0.0.1:${port}` : null);

  return {
    slug,
    kind,
    cadenceSeconds,
    anchorAt,
    missedPolicy,
    lateToleranceSeconds,
    enabled,
    jobType,
    instruction: optionalText(task, 'instruction'),
    beatMessage: optionalText(task, 'beatMessage'),
    contextPath: optionalText(task, 'contextPath'),
    contextText: optionalText(task, 'contextText'),
    checkpointPath: optionalText(task, 'checkpointPath'),
    bridgeType: optionalText(task, 'bridgeType'),
    bridgeUrl,
    model: optionalText(task, 'model'),
    vaultKey: optionalText(task, 'vaultKey') || `vault-${slug}`,
    label: optionalText(task, 'label'),
    port,
  };
}

/**
 * Lateness an instant may carry and still be due: half the cadence, at least
 * one second (timer jitter), at most thirty.
 * @param {number} cadenceSeconds
 */
export function defaultLateTolerance(cadenceSeconds) {
  return Math.max(1, Math.min(30, Math.floor(cadenceSeconds / 2)));
}

/**
 * The revision of a declaration: SHA-256 of its canonical normalized form.
 * @param {object} declaration - normalized or raw; it is normalized first
 * @returns {string} 64 hex characters
 */
export function scheduleRevision(declaration) {
  return sha256Hex(canonicalJson(normalizeDeclaration(declaration)));
}

/**
 * The deterministic identity of one occurrence, and the Queue idempotency key.
 *
 *   'occ-' + hex SHA-256 of `${universeId}|${scheduleId}|${revision}|${plannedAtIsoUtc}`
 *
 * @param {object} parts
 * @param {string} parts.universeId
 * @param {string} parts.scheduleId
 * @param {string} parts.revision
 * @param {string|number|Date} parts.plannedAt - an instant; rendered as ISO UTC with milliseconds
 * @returns {string}
 */
export function occurrenceId({ universeId, scheduleId, revision, plannedAt }) {
  assertUniverseId(universeId);
  if (typeof scheduleId !== 'string' || !SLUG_PATTERN.test(scheduleId)) {
    throw new ScheduleError('INVALID_SCHEDULE', `scheduleId must match ${SLUG_PATTERN}`);
  }
  if (typeof revision !== 'string' || !/^[0-9a-f]{64}$/.test(revision)) {
    throw new ScheduleError('INVALID_SCHEDULE', 'revision must be 64 lowercase hex characters');
  }
  return `occ-${sha256Hex(`${universeId}|${scheduleId}|${revision}|${isoUtc(plannedAt)}`)}`;
}

/**
 * @param {string|number|Date} instant
 * @returns {string} e.g. 2026-09-24T10:05:00.000Z
 */
export function isoUtc(instant) {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) throw new ScheduleError('INVALID_INSTANT', `not an instant: ${JSON.stringify(instant)}`);
  return new Date(ms).toISOString();
}

/**
 * The first planned instant at or after `fromMs`: `anchor + k · cadence`, k ≥ 0.
 * @param {number} anchorMs
 * @param {number} cadenceSeconds
 * @param {number} fromMs
 * @returns {number}
 */
export function firstInstantAtOrAfter(anchorMs, cadenceSeconds, fromMs) {
  const cadenceMs = cadenceSeconds * 1000;
  return anchorMs + Math.max(0, Math.ceil((fromMs - anchorMs) / cadenceMs)) * cadenceMs;
}

/**
 * Which instants of a schedule became due, which were missed, and what comes
 * next — computed from the stored anchor, cadence and last planned instant,
 * never from the moment a timer happened to fire.
 *
 * Instants are `anchor + k · cadence` for k ≥ 0, from the first one at or after
 * the moment this revision became active. Everything in (lastPlanned, now] is
 * settled by one evaluation:
 *
 * - `skip` — the latest instant is DUE if it is at most `lateToleranceSeconds`
 *   late; every other instant is MISSED and never replayed.
 * - `coalesce_latest` — the latest instant is DUE, whatever its lateness, and
 *   stands for every earlier one, which is recorded MISSED.
 * - Either way, while the schedule still holds an unsettled DUE occurrence, the
 *   new instants are MISSED: the backlog per schedule is one, never a pile.
 *
 * At most `maxMissedRows` MISSED instants (the most recent) are returned for
 * recording; the rest are counted in `missedNotRecorded`, never dropped silently.
 *
 * @param {object} input
 * @param {number} input.anchorMs
 * @param {number} input.cadenceSeconds
 * @param {number} input.activeFromMs - when this revision became active
 * @param {number|null} input.lastPlannedMs - latest instant already settled for this revision
 * @param {number} input.nowMs
 * @param {'skip'|'coalesce_latest'} input.missedPolicy
 * @param {number} input.lateToleranceSeconds
 * @param {boolean} [input.hasUnsettled=false]
 * @param {number} [input.maxMissedRows]
 */
export function planEvaluation({
  anchorMs,
  cadenceSeconds,
  activeFromMs,
  lastPlannedMs = null,
  nowMs,
  missedPolicy,
  lateToleranceSeconds,
  hasUnsettled = false,
  maxMissedRows = MAX_MISSED_ROWS_PER_EVALUATION,
}) {
  const cadenceMs = cadenceSeconds * 1000;
  const firstIndex = Math.max(0, lastPlannedMs != null
    ? Math.floor((lastPlannedMs - anchorMs) / cadenceMs) + 1
    : Math.ceil((activeFromMs - anchorMs) / cadenceMs));
  const lastIndex = Math.floor((nowMs - anchorMs) / cadenceMs);
  const at = (k) => anchorMs + k * cadenceMs;
  const nextDueMs = at(Math.max(firstIndex, lastIndex + 1));

  if (lastIndex < firstIndex) {
    return { dueMs: null, missed: [], missedCount: 0, missedNotRecorded: 0, lastPlannedMs, nextDueMs };
  }

  const latestMs = at(lastIndex);
  let dueMs = null;
  let latestReason = null;
  if (hasUnsettled) latestReason = 'previous_occurrence_unsettled';
  else if (missedPolicy === 'coalesce_latest') dueMs = latestMs;
  else if (nowMs - latestMs <= lateToleranceSeconds * 1000) dueMs = latestMs;
  else latestReason = 'late_beyond_tolerance';

  let olderReason = 'late_beyond_tolerance';
  if (hasUnsettled) olderReason = 'previous_occurrence_unsettled';
  else if (missedPolicy === 'coalesce_latest') olderReason = 'coalesced_into_latest';

  const total = lastIndex - firstIndex + 1;
  const missedCount = total - (dueMs === null ? 0 : 1);
  const missed = [];
  let k = lastIndex;
  if (dueMs === null && missed.length < maxMissedRows) {
    missed.push({ plannedMs: latestMs, reason: latestReason });
  }
  k -= 1;
  while (k >= firstIndex && missed.length < maxMissedRows) {
    missed.push({ plannedMs: at(k), reason: olderReason });
    k -= 1;
  }
  missed.reverse();

  return {
    dueMs,
    missed,
    missedCount,
    missedNotRecorded: missedCount - missed.length,
    lastPlannedMs: latestMs,
    nextDueMs,
  };
}

/**
 * Seconds to wait before retrying an occurrence that has had `attempts` tries:
 * 5 s, 10 s, 20 s … capped at five minutes.
 * @param {number} attempts
 * @returns {number} milliseconds
 */
export function retryDelayMs(attempts) {
  const n = Math.max(1, attempts);
  return Math.min(300_000, 5_000 * 2 ** (n - 1));
}

/**
 * What one Queue answer to `POST /api/jobs` means for an occurrence. Pure: the
 * caller supplies what came back, or the error when nothing did.
 *
 *   enqueued  — Queue durably holds the job (created now, or accepted earlier
 *               under the same key); record its id and mark ENQUEUED.
 *   retry     — nothing durable was learnt; stay DUE and retry with the same key.
 *   conflict  — the key already names a different request; a typed failure,
 *               never retried blindly.
 *   rejected  — Queue refused this request; the same bytes would be refused again.
 *
 * @param {object} answer
 * @param {number} [answer.status]
 * @param {object} [answer.body]
 * @param {Error|string} [answer.error] - set when no HTTP answer arrived
 * @returns {{ outcome: 'enqueued'|'retry'|'conflict'|'rejected', reason: string, jobId?: string, duplicate?: boolean, detail?: string }}
 */
export function classifyQueueAnswer({ status, body, error } = {}) {
  if (error || !Number.isInteger(status)) {
    return { outcome: 'retry', reason: 'queue_unreachable', detail: String(error?.message || error || 'no HTTP answer') };
  }
  if (status >= 200 && status < 300) {
    const jobId = body?.job?.id;
    if (typeof jobId !== 'string' || !jobId) {
      return { outcome: 'retry', reason: 'queue_answer_without_job', detail: `HTTP ${status} carried no job id` };
    }
    if (status === 201 && body.duplicate === false) {
      return { outcome: 'enqueued', reason: 'queue_created', jobId, duplicate: false };
    }
    if (status === 200 && body.duplicate === true) {
      return { outcome: 'enqueued', reason: 'queue_duplicate_accepted', jobId, duplicate: true };
    }
    // The job exists and its id is known, so the link is recorded; but the
    // answer did not confirm the idempotency contract, and says so.
    return { outcome: 'enqueued', reason: 'queue_accepted_idempotency_unconfirmed', jobId, duplicate: body.duplicate === true };
  }
  if (status === 409) {
    if (body?.code === 'IDEMPOTENCY_CONFLICT') {
      return { outcome: 'conflict', reason: 'queue_idempotency_conflict', detail: String(body?.error || 'IDEMPOTENCY_CONFLICT') };
    }
    return { outcome: 'rejected', reason: 'queue_conflict_409', detail: String(body?.error || body?.code || 'conflict') };
  }
  if (status === 408 || status === 425 || status === 429) {
    return { outcome: 'retry', reason: `queue_busy_${status}`, detail: String(body?.error || '') };
  }
  if (status >= 400 && status < 500) {
    return { outcome: 'rejected', reason: `queue_rejected_${status}`, detail: String(body?.error || body?.code || '') };
  }
  if (status >= 500) {
    return { outcome: 'retry', reason: `queue_error_${status}`, detail: String(body?.error || '') };
  }
  return { outcome: 'retry', reason: `queue_unexpected_${status}`, detail: '' };
}

/**
 * Bounded query parameters for GET /api/occurrences.
 * @param {URLSearchParams} params
 * @returns {{ scheduleId: string|null, state: string|null, limit: number }}
 */
export function parseOccurrenceQuery(params) {
  const scheduleId = params.get('schedule') || null;
  if (scheduleId !== null && !SLUG_PATTERN.test(scheduleId)) {
    throw new ScheduleError('INVALID_QUERY', `schedule must match ${SLUG_PATTERN}`);
  }
  const state = params.get('state') || null;
  if (state !== null && !OCCURRENCE_STATES.has(state)) {
    throw new ScheduleError('INVALID_QUERY', `state must be one of ${Array.from(OCCURRENCE_STATES).join(', ')}`);
  }
  const rawLimit = params.get('limit');
  let limit = OCCURRENCE_QUERY_DEFAULT_LIMIT;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > OCCURRENCE_QUERY_MAX_LIMIT) {
      throw new ScheduleError('INVALID_QUERY', `limit must be an integer between 1 and ${OCCURRENCE_QUERY_MAX_LIMIT}`);
    }
  }
  return { scheduleId, state, limit };
}
