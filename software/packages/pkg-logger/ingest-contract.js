/**
 * @module @shaper/pkg-logger/ingest-contract
 * What an accepted event is, independent of where it is stored.
 *
 * Everything here is pure (Node built-ins only, no database): request limits,
 * the normalised claim a source submits, the canonical JSON both digests are
 * computed over, the logger-assigned identity, the mapping between a record and
 * its MariaDB row, and the idempotency decision. The MariaDB store applies these
 * inside one transaction; the tests hold them without a database.
 *
 * Intent: software/packages/pkg-logger/INTENT.md#private-mariadb
 */

import crypto from 'node:crypto';

import { VALID_LEVELS, generateExecutionId } from './events.js';

/** Version of the canonical record the per-event digest covers. */
export const LOGGER_RECORD_VERSION = 1;

/** The pod name under which the logger records its own security events. */
export const LOGGER_POD = 'brick-logger';

/** Hard ceiling for one event's canonical `data`, mirrored by a CHECK in sql/schema.sql. */
export const MAX_EVENT_BYTES_CEILING = 1_048_576;

export const DEFAULT_LIMITS = Object.freeze({
  maxBodyBytes: 1_048_576, // one POST /api/ingest body, bytes
  maxEventBytes: 65_536, // one event's canonical `data`, bytes
  maxBatch: 500, // entries in one array ingest
  maxQueryLimit: 1000, // events returned by one GET /api/events/last
});

/** Column bounds of sql/schema.sql, in characters. */
export const FIELD_LIMITS = Object.freeze({
  pod: 128,
  event: 128,
  correlationId: 191,
  executionId: 191,
  sourceEventId: 191,
});

/** |duration_ms| must fit DECIMAL(15,1). */
const MAX_ABS_DURATION_MS = 1e14;

/**
 * A refusal the logger answers with a typed code and an HTTP status.
 */
export class LoggerIngestError extends Error {
  /**
   * @param {number} status - HTTP status the server answers with
   * @param {string} code - stable machine-readable reason
   * @param {string} message
   * @param {object} [details] - additive fields for the response body
   */
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'LoggerIngestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Reads the ingest limits from the environment. A value that is present and
 * wrong refuses the start; it never silently becomes a default.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ maxBodyBytes: number, maxEventBytes: number, maxBatch: number, maxQueryLimit: number }}
 */
export function resolveLimits(env = process.env) {
  const read = (name, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > max) {
      throw new LoggerIngestError(500, 'INVALID_LIMIT', `${name} must be an integer between 1 and ${max}; got ${JSON.stringify(raw)}`);
    }
    return value;
  };
  return {
    maxBodyBytes: read('LOGGER_MAX_BODY_BYTES', DEFAULT_LIMITS.maxBodyBytes),
    maxEventBytes: read('LOGGER_MAX_EVENT_BYTES', DEFAULT_LIMITS.maxEventBytes, MAX_EVENT_BYTES_CEILING),
    maxBatch: read('LOGGER_MAX_BATCH', DEFAULT_LIMITS.maxBatch),
    maxQueryLimit: DEFAULT_LIMITS.maxQueryLimit,
  };
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace,
 * ECMAScript number serialisation (compatible with RFC 8785 for the values
 * JSON.parse produces). The same value always yields the same bytes.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
      }
      const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: ${typeof value} is not JSON`);
  }
}

export function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function optionalId(value, field, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new LoggerIngestError(400, 'INVALID_FIELD', `${field} must be a string`);
  }
  const text = String(value);
  if (text.length > max) {
    throw new LoggerIngestError(400, 'FIELD_TOO_LONG', `${field} is longer than ${max} characters`);
  }
  return text;
}

/**
 * Normalises one submitted entry into the claim the logger records. The
 * normalisation is the one `formatEventRecord` has always applied (upper-case
 * event, known level or INFO, correlation derived from data.jobId, duration
 * rounded to 0.1 ms); what it adds is bounds, so a stored row always fits.
 *
 * Nothing the logger generates (id, receipt time, a default execution id) is
 * part of the claim: the claim is what the source said, and it is what an
 * idempotent replay is compared on.
 *
 * @param {unknown} entry
 * @param {{ maxEventBytes: number }} [limits]
 * @returns {{ pod: string, event: string, level: string, correlationId: string|null, executionId: string|null, durationMs: number|null, sourceEventId: string|null, data: object, dataJson: string }}
 */
export function normalizeIngestEntry(entry, limits = DEFAULT_LIMITS) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new LoggerIngestError(400, 'INVALID_ENTRY', 'Ingest entry must be a JSON object');
  }
  if (!entry.event) {
    throw new LoggerIngestError(400, 'EVENT_REQUIRED', 'Ingest entry requires an event field');
  }

  const pod = entry.pod === undefined || entry.pod === null || entry.pod === '' ? 'unknown' : entry.pod;
  if (typeof pod !== 'string') throw new LoggerIngestError(400, 'INVALID_FIELD', 'pod must be a string');
  if (pod.length > FIELD_LIMITS.pod) throw new LoggerIngestError(400, 'FIELD_TOO_LONG', `pod is longer than ${FIELD_LIMITS.pod} characters`);

  const event = String(entry.event).toUpperCase();
  if (event.length > FIELD_LIMITS.event) throw new LoggerIngestError(400, 'FIELD_TOO_LONG', `event is longer than ${FIELD_LIMITS.event} characters`);

  const upperLevel = String(entry.level || 'INFO').toUpperCase();
  const level = VALID_LEVELS.has(upperLevel) ? upperLevel : 'INFO';

  const data = entry.data && typeof entry.data === 'object' ? entry.data : {};
  const dataJson = canonicalJson(data);
  const maxEventBytes = limits.maxEventBytes ?? DEFAULT_LIMITS.maxEventBytes;
  if (Buffer.byteLength(dataJson, 'utf8') > maxEventBytes) {
    throw new LoggerIngestError(413, 'EVENT_TOO_LARGE', `event data exceeds ${maxEventBytes} bytes; store a reference and a digest instead`);
  }

  const correlationId = optionalId(
    entry.correlation_id || entry.correlationId || data.jobId || data.correlationId || null,
    'correlationId',
    FIELD_LIMITS.correlationId,
  );
  const executionId = optionalId(entry.execution_id || entry.executionId || null, 'executionId', FIELD_LIMITS.executionId);

  const elapsed = entry.duration_ms ?? entry.durationMs ?? 0;
  const rounded = Math.round(Number(elapsed || 0) * 10) / 10;
  const durationMs = Number.isFinite(rounded) ? rounded + 0 : null; // + 0 folds -0
  if (durationMs !== null && Math.abs(durationMs) >= MAX_ABS_DURATION_MS) {
    throw new LoggerIngestError(400, 'FIELD_OUT_OF_RANGE', 'duration_ms is out of range');
  }

  const rawSourceId = entry.sourceEventId ?? entry.source_event_id ?? null;
  let sourceEventId = null;
  if (rawSourceId !== null) {
    if (typeof rawSourceId !== 'string' || rawSourceId.length === 0 || rawSourceId.length > FIELD_LIMITS.sourceEventId
      || /[\u0000-\u001f\u007f]/.test(rawSourceId)) {
      throw new LoggerIngestError(
        400,
        'INVALID_SOURCE_EVENT_ID',
        `sourceEventId must be a non-empty string of at most ${FIELD_LIMITS.sourceEventId} characters without control characters`,
      );
    }
    sourceEventId = rawSourceId;
  }

  return {
    pod,
    event,
    level,
    correlationId,
    executionId,
    durationMs,
    sourceEventId,
    data: JSON.parse(dataJson),
    dataJson,
  };
}

/**
 * Digest of what the source claimed: the basis of "same id, same content".
 * @param {ReturnType<typeof normalizeIngestEntry>} claim
 * @returns {string} 64 hex characters
 */
export function claimDigest(claim) {
  return sha256Hex(canonicalJson({
    kind: 'shaper.logger.claim',
    v: LOGGER_RECORD_VERSION,
    pod: claim.pod,
    event: claim.event,
    level: claim.level,
    correlationId: claim.correlationId,
    executionId: claim.executionId,
    durationMs: claim.durationMs,
    sourceEventId: claim.sourceEventId,
    data: claim.data,
  }));
}

/**
 * Digest of the canonical stored event: the claim as normalised plus what
 * Logger assigned on receipt (id, receipt time, execution id). Recomputable by
 * anyone who reads the row; see `rowToRecord`.
 *
 * @param {object} record - a record as `assembleRecord` shapes it
 * @returns {string} 64 hex characters
 */
export function eventDigest(record) {
  return sha256Hex(canonicalJson({
    kind: 'shaper.logger.event',
    v: LOGGER_RECORD_VERSION,
    id: record.id,
    receivedAt: record.at,
    pod: record.pod,
    event: record.event,
    level: record.level,
    correlationId: record.correlationId,
    executionId: record.execution_id,
    durationMs: record.duration_ms,
    sourceEventId: record.sourceEventId,
    data: record.data,
  }));
}

/**
 * The one shape a stored event is answered in, whether it was just written or
 * read back: the canonical event of events.js, plus `id`, `sourceEventId` and
 * `digest`. One builder, so a replay answers byte for byte what the first
 * ingest answered.
 */
export function assembleRecord({ id, at, pod, event, level, correlationId, executionId, data, durationMs, sourceEventId, digest }) {
  return {
    id,
    at,
    timestamp: at,
    pod,
    event,
    level,
    correlationId,
    correlation_id: correlationId,
    execution_id: executionId,
    data,
    duration_ms: durationMs,
    sourceEventId,
    digest,
  };
}

/**
 * Builds the record Logger stores for a claim received at `receivedAtMs`.
 * @param {ReturnType<typeof normalizeIngestEntry>} claim
 * @param {{ id: string, receivedAtMs: number }} receipt
 */
export function buildRecord(claim, { id, receivedAtMs }) {
  const record = assembleRecord({
    id,
    at: new Date(receivedAtMs).toISOString(),
    pod: claim.pod,
    event: claim.event,
    level: claim.level,
    correlationId: claim.correlationId,
    executionId: claim.executionId || generateExecutionId(),
    data: claim.data,
    durationMs: claim.durationMs,
    sourceEventId: claim.sourceEventId,
    digest: null,
  });
  record.digest = eventDigest(record);
  return record;
}

/** ISO-8601 UTC → MariaDB DATETIME(3) literal, UTC by construction. */
export function toDbDatetime(msOrIso) {
  const ms = typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso);
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 23);
}

/** MariaDB DATETIME string (UTC, as read with dateStrings) → ISO-8601 with milliseconds. */
export function fromDbDatetime(value) {
  const text = String(value).trim().replace(' ', 'T');
  return new Date(`${text}Z`).toISOString();
}

/** Values for INSERT INTO events, in EVENT_COLUMNS order. */
export function recordToRow(record) {
  return {
    received_at: toDbDatetime(record.at),
    id: record.id,
    pod: record.pod,
    event: record.event,
    level: record.level,
    correlation_id: record.correlationId,
    execution_id: record.execution_id,
    source_event_id: record.sourceEventId,
    duration_ms: record.duration_ms === null ? null : record.duration_ms.toFixed(1),
    data: canonicalJson(record.data),
    record_version: LOGGER_RECORD_VERSION,
    digest: record.digest,
  };
}

/** A row read back from `events` (mysql2, dateStrings, DECIMAL as string) → the record. */
export function rowToRecord(row) {
  return assembleRecord({
    id: row.id,
    at: fromDbDatetime(row.received_at),
    pod: row.pod,
    event: row.event,
    level: row.level,
    correlationId: row.correlation_id ?? null,
    executionId: row.execution_id ?? null,
    data: JSON.parse(row.data),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    sourceEventId: row.source_event_id ?? null,
    digest: row.digest,
  });
}

/**
 * Logger-assigned identities: UUIDv7 (48-bit millisecond time, 12-bit counter,
 * 62 random bits). The generator is monotonic within a process — a clock that
 * stalls or steps back never reorders two receipts — and returns the
 * millisecond it used, which becomes the receipt time, so (received_at, id)
 * orders events exactly as they were received.
 *
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {(buf: Buffer, offset: number, size: number) => void} [options.randomFill]
 * @returns {() => { id: string, ms: number }}
 */
export function createEventIdGenerator({ now = Date.now, randomFill = crypto.randomFillSync } = {}) {
  let lastMs = -1;
  let counter = 0;
  return function nextEventId() {
    let ms = Math.floor(now());
    if (ms <= lastMs) {
      ms = lastMs;
      counter += 1;
      if (counter > 0xfff) {
        ms = lastMs + 1;
        counter = 0;
      }
    } else {
      counter = 0;
    }
    lastMs = ms;
    const bytes = Buffer.alloc(16);
    bytes.writeUIntBE(ms, 0, 6);
    bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
    bytes[7] = counter & 0xff;
    randomFill(bytes, 8, 8);
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return { id, ms };
  };
}

/**
 * Same source event id: the stored claim digest decides.
 * @param {string} storedClaimDigest
 * @param {string} submittedClaimDigest
 * @returns {'replay'|'conflict'}
 */
export function replayDecision(storedClaimDigest, submittedClaimDigest) {
  return storedClaimDigest === submittedClaimDigest ? 'replay' : 'conflict';
}

/**
 * The refusal of a reused source event id. The claim digests travel as
 * `evidence` for the security event Logger records, not in the HTTP answer:
 * the submitter is not yet authenticated, and a digest of another source's
 * claim is not something to hand it.
 */
export function sourceEventConflict({ pod, sourceEventId, index = null, originalEventId = null, originalReceivedAt = null, storedClaimDigest = null, submittedClaimDigest = null, correlationId = null }) {
  const err = new LoggerIngestError(
    409,
    'SOURCE_EVENT_CONFLICT',
    `source event id ${JSON.stringify(sourceEventId)} from ${JSON.stringify(pod)} was already recorded with different content`,
    { pod, sourceEventId, index, originalEventId, originalReceivedAt },
  );
  err.evidence = { storedClaimDigest, submittedClaimDigest, correlationId };
  return err;
}

/**
 * Resolves duplicates inside one batch before the database sees it: a second
 * entry with the same (pod, sourceEventId) and the same claim is a replay of
 * the first; with a different claim the whole batch is refused. Entries
 * without a source id are never deduplicated.
 *
 * @param {Array<ReturnType<typeof normalizeIngestEntry>>} claims
 * @returns {Array<{ index: number, claim: object, claimDigest: string, duplicateOf: number|null }>}
 */
export function planBatch(claims) {
  const firstByKey = new Map();
  return claims.map((claim, index) => {
    const digest = claimDigest(claim);
    const step = { index, claim, claimDigest: digest, duplicateOf: null };
    if (!claim.sourceEventId) return step;
    const key = `${claim.pod}\u0000${claim.sourceEventId}`;
    const first = firstByKey.get(key);
    if (!first) {
      firstByKey.set(key, step);
      return step;
    }
    if (replayDecision(first.claimDigest, digest) === 'conflict') {
      throw sourceEventConflict({
        pod: claim.pod,
        sourceEventId: claim.sourceEventId,
        index,
        storedClaimDigest: first.claimDigest,
        submittedClaimDigest: digest,
        correlationId: claim.correlationId,
      });
    }
    step.duplicateOf = first.index;
    return step;
  });
}

/**
 * Filters of GET /api/events/last. `pod` and `limit` are the historical
 * contract; correlation, event and a receipt-time window are additive.
 *
 * @param {URLSearchParams} params
 * @param {{ maxQueryLimit: number }} [limits]
 */
export function parseEventQuery(params, limits = DEFAULT_LIMITS) {
  const rawLimit = params.get('limit');
  let limit = 50;
  if (rawLimit !== null && rawLimit !== '') {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new LoggerIngestError(400, 'INVALID_QUERY', 'limit must be a positive integer');
    }
  }
  limit = Math.min(limit, limits.maxQueryLimit ?? DEFAULT_LIMITS.maxQueryLimit);

  const time = (name) => {
    const raw = params.get(name);
    if (raw === null || raw === '') return null;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) throw new LoggerIngestError(400, 'INVALID_QUERY', `${name} must be an ISO-8601 time`);
    return ms;
  };

  const event = params.get('event');
  return {
    pod: params.get('pod') || null,
    correlationId: params.get('correlationId') || params.get('correlation_id') || null,
    event: event ? event.toUpperCase() : null,
    since: time('since'),
    until: time('until'),
    limit,
  };
}
