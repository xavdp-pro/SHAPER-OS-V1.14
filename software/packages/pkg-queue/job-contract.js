/**
 * @file job-contract.js
 * @package @shaper/pkg-queue
 * @description What a job request is, what a job record is, and how a change
 * applies to one — shared by every store, so the HTTP contract does not depend
 * on where jobs are kept. Pure: no I/O, and no clock unless one is passed in.
 *
 * Intent: software/packages/pkg-queue/INTENT.md#private-mariadb
 */
import crypto from 'node:crypto';

const INT_MAX = 2147483647;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,190}$/;
const STATUS = /^[A-Za-z][A-Za-z_]{0,31}$/;

/** Every refusal the queue makes about a job carries a stable code. */
export class QueueError extends Error {
  /**
   * @param {string} code - stable machine-readable reason
   * @param {string} message
   * @param {object} [extra] - fields a caller may act on (e.g. jobId)
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** HTTP status for each QueueError code. Unknown codes are a server fault. */
export const QUEUE_ERROR_STATUS = Object.freeze({
  INVALID_JSON: 400,
  INVALID_JOB_REQUEST: 400,
  INVALID_JOB_UPDATE: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  JOB_NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  JOB_STATE_CHANGED: 409,
  QUEUE_ROW_INVALID: 500,
});

/**
 * A storage failure is an unavailable queue (503), never a malformed request
 * and never a success. Same mapping as the Vault's storeErrorStatus.
 * @param {Error & { code?: string }} err
 * @returns {number}
 */
export function queueErrorStatus(err) {
  if (err && err.name === 'QueueError') return QUEUE_ERROR_STATUS[err.code] ?? 500;
  if (err && err.name === 'UnitDbError') return 503;
  const code = String((err && err.code) || '');
  if (/^(ER_|ECONN|ENOENT|EACCES|EPIPE|ETIMEDOUT|PROTOCOL_|POOL_)/.test(code)) return 503;
  return 500;
}

/**
 * @param {unknown} key
 * @returns {string}
 */
export function validateIdempotencyKey(key) {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) {
    throw new QueueError(
      'IDEMPOTENCY_KEY_INVALID',
      'idempotencyKey must be a string of 1 to 190 characters from [A-Za-z0-9._:-]',
    );
  }
  return key;
}

/**
 * JSON with object keys sorted at every depth, so two requests that differ
 * only in key order have one digest. Array order is meaningful and kept.
 * Undefined members are dropped exactly as JSON.stringify drops them.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    return text === undefined ? 'null' : text;
  }
  if (typeof value.toJSON === 'function') return canonicalJson(value.toJSON());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined && typeof value[k] !== 'function')
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

const invalidRequest = (message) => new QueueError('INVALID_JOB_REQUEST', message);
const invalidUpdate = (message) => new QueueError('INVALID_JOB_UPDATE', message);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkContractType(value, fail) {
  if (value !== null && value !== undefined && (typeof value !== 'string' || value.length > 64)) {
    throw fail('contractType must be a string of at most 64 characters');
  }
}

/**
 * Validates a job request and applies today's defaults (payload {}, one step).
 * `contractType` keeps what the request said; `derivedContractType` is what
 * the job record carries (the request's, else the payload's).
 *
 * @param {object} request - { type, payload?, totalSteps?, contractType?, idempotencyKey? }
 */
export function normalizeCreateRequest(request) {
  if (!isPlainObject(request)) throw invalidRequest('a job request is a JSON object');
  const { type, payload = {}, totalSteps, contractType, idempotencyKey } = request;
  if (typeof type !== 'string' || type.length === 0 || type.length > 190) {
    throw invalidRequest('type is required: a string of 1 to 190 characters');
  }
  if (payload === null) throw invalidRequest('payload must not be null (omit it for an empty payload)');
  const steps = totalSteps ?? 1;
  if (!Number.isSafeInteger(steps) || steps < 0 || steps > INT_MAX) {
    throw invalidRequest('totalSteps must be a non-negative integer');
  }
  checkContractType(contractType, invalidRequest);
  const derived = contractType || payload.contractType || null;
  checkContractType(derived, invalidRequest);
  return {
    type,
    payload,
    totalSteps: steps,
    contractType: contractType ?? null,
    derivedContractType: derived,
    idempotencyKey: idempotencyKey === undefined ? null : validateIdempotencyKey(idempotencyKey),
  };
}

/**
 * SHA-256 of the canonical JSON of what the request asks for: the same
 * logical request always has the same digest, whatever its key order.
 * @param {ReturnType<typeof normalizeCreateRequest>} normalized
 * @returns {string} 64 hex characters
 */
export function requestDigest(normalized) {
  const { type, payload, totalSteps, contractType } = normalized;
  return crypto.createHash('sha256')
    .update(canonicalJson({ type, payload, totalSteps, contractType }))
    .digest('hex');
}

/**
 * The record a new job starts as. Its shape is the API's job shape.
 * @param {ReturnType<typeof normalizeCreateRequest>} normalized
 * @param {{ id: string, digest: string, now: Date }} identity
 */
export function newJobRecord(normalized, { id, digest, now }) {
  const at = now.toISOString();
  return {
    id,
    type: normalized.type,
    payload: normalized.payload,
    contractType: normalized.derivedContractType,
    status: 'PENDING',
    progress: 0,
    step: 0,
    totalSteps: normalized.totalSteps,
    createdAt: at,
    updatedAt: at,
    result: null,
    error: null,
    qualityGateStatus: null,
    idempotencyKey: normalized.idempotencyKey,
    requestDigest: digest,
  };
}

/**
 * Same key and same request: the original job, no new one. Same key and a
 * different request: a conflict naming the job that owns the key.
 * @param {object} existing - the job that already holds the key
 * @param {string} digest - the digest of the request being replayed
 * @param {string} key
 * @returns {{ job: object, duplicate: true }}
 */
export function replayOrConflict(existing, digest, key) {
  if (existing.requestDigest === digest) return { job: existing, duplicate: true };
  throw new QueueError(
    'IDEMPOTENCY_CONFLICT',
    `idempotency key "${key}" already names job ${existing.id}, created from a different request`,
    { jobId: existing.id },
  );
}

/**
 * Validates a progress/status update. Unknown fields are ignored, as before;
 * a known field of the wrong type is refused instead of being stored.
 * @param {object} patch
 */
export function normalizeJobPatch(patch) {
  if (!isPlainObject(patch)) throw invalidUpdate('a job update is a JSON object');
  const out = {};
  if (patch.progress !== undefined) {
    if (typeof patch.progress !== 'number' || !Number.isFinite(patch.progress)) {
      throw invalidUpdate('progress must be a finite number');
    }
    out.progress = patch.progress;
  }
  if (patch.step !== undefined) {
    if (!Number.isSafeInteger(patch.step) || patch.step < 0 || patch.step > INT_MAX) {
      throw invalidUpdate('step must be a non-negative integer');
    }
    out.step = patch.step;
  }
  if (patch.status !== undefined) {
    if (typeof patch.status !== 'string' || !STATUS.test(patch.status)) {
      throw invalidUpdate('status must be a word of at most 32 letters or underscores');
    }
    out.status = patch.status;
  }
  if (patch.result !== undefined) out.result = patch.result;
  if (patch.error !== undefined) {
    if (patch.error !== null && typeof patch.error !== 'string') throw invalidUpdate('error must be a string or null');
    out.error = patch.error;
  }
  if (patch.contractType !== undefined) {
    checkContractType(patch.contractType, invalidUpdate);
    out.contractType = patch.contractType;
  }
  // Only an in-process caller can hand over a function; JSON never carries one.
  if (typeof patch.testRunner === 'function') out.testRunner = patch.testRunner;
  return out;
}

/**
 * Applies an update to a job and returns the new record. The quality gate
 * (Rule 20) decides COMPLETED versus FAILED; `gate(job)` is handed the job
 * with the update already applied, exactly as before the store port.
 *
 * @param {object} job
 * @param {ReturnType<typeof normalizeJobPatch>} changes
 * @param {{ gate: (job: object) => { passed: boolean, status?: string, error?: string }, now: Date }} options
 */
export function applyJobPatch(job, changes, { gate, now }) {
  const next = { ...job };
  if (changes.contractType !== undefined) next.contractType = changes.contractType;
  if (changes.progress !== undefined) next.progress = changes.progress;
  if (changes.step !== undefined) next.step = changes.step;
  if (changes.result !== undefined) next.result = changes.result;
  if (changes.error !== undefined) next.error = changes.error;

  if (changes.status === 'COMPLETED') {
    const gateRes = gate(next);
    next.qualityGateStatus = gateRes.status || (gateRes.passed ? 'PASSED' : 'FAILED');
    if (!gateRes.passed) {
      next.status = 'FAILED';
      next.error = `Quality Gate Error: ${gateRes.error}`;
    } else {
      next.status = 'COMPLETED';
    }
  } else if (changes.status !== undefined) {
    next.status = changes.status;
  }
  next.updatedAt = now.toISOString();
  return next;
}

function boundedText(value, limit) {
  let text = String(value);
  if (text.length > limit) text = `${text.slice(0, limit)}…`;
  // Escapes can lengthen the JSON form; shorten until the encoded form fits.
  while (JSON.stringify(text).length > limit + 64) text = `${text.slice(0, Math.floor(text.length * 0.75))}…`;
  return text;
}

/**
 * The bounded detail a history row carries: what moved, never the payload or
 * the result, which may be large and live on the job row. At most 1024
 * characters by construction (the column's width).
 *
 * @param {'created'|'updated'|'quality_gate'} kind
 * @param {object|null} before
 * @param {object} after
 * @returns {string} JSON
 */
export function transitionDetail(kind, before, after) {
  const detail = { kind, progress: after.progress, step: after.step };
  if (after.qualityGateStatus !== (before ? before.qualityGateStatus : null) && after.qualityGateStatus !== null) {
    detail.qualityGateStatus = after.qualityGateStatus;
  }
  if (after.error && after.error !== (before ? before.error : null)) detail.error = boundedText(after.error, 300);
  if (kind === 'created' && after.idempotencyKey) detail.idempotencyKey = after.idempotencyKey;
  const text = JSON.stringify(detail);
  if (text.length <= 1024) return text;
  delete detail.error;
  return JSON.stringify(detail);
}
