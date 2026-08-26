/**
 * @module @shaper/pkg-logger/events
 * Shared Event Vocabulary and Canonical Contract (Task 2).
 *
 * ── The Canonical Event Shape ──────────────────────────────────────────────
 * {
 *   "at": "2026-08-23T18:00:00.000Z",           // ISO timestamp (event occurrence)
 *   "timestamp": "2026-08-23T18:00:00.000Z",    // Backward compatibility mirror of "at"
 *   "pod": "maestro",                            // Emitting component / pod / brick
 *   "event": "BEAT_ENQUEUED",                    // SCREAMING_SNAKE_CASE event name
 *   "level": "INFO",                             // Severity: INFO | WARN | ERROR | DEBUG
 *   "correlationId": "job-1787507845305-1",      // Cross-brick trace / activity identifier
 *   "correlation_id": "job-1787507845305-1",    // Snake_case mirror for correlationId
 *   "execution_id": "run-a1b2c3",                // Local run identifier
 *   "data": { ... },                             // Structured event payload
 *   "duration_ms": 12.4                          // Elapsed time in milliseconds
 * }
 */

import crypto from 'node:crypto';

export const VALID_LEVELS = new Set(['INFO', 'WARN', 'ERROR', 'DEBUG']);

/**
 * Registry of known, documented events emitted across Shaper OS bricks.
 */
export const KNOWN_EVENTS = {
  // ── Maestro Lifecycle ───────────────────────────────────────────────────
  MAESTRO_STARTED: {
    brick: 'maestro',
    description: 'Maestro beat scheduler initialized and listening',
    fields: ['tasks', 'autoStart'],
  },
  BEAT_STARTED: {
    brick: 'maestro',
    description: 'Scheduled cadence beat initiated for a pod',
    fields: ['slug', 'kind', 'mailbox'],
  },
  BEAT_ENQUEUED: {
    brick: 'maestro',
    description: 'Cadence beat dispatched as an asynchronous job into the Queue',
    fields: ['slug', 'kind', 'queue'],
  },
  BEAT_SKIPPED: {
    brick: 'maestro',
    description: 'Cadence beat omitted due to backpressure, unreachable queue, or missing prerequisites',
    fields: ['reason', 'jobId', 'since', 'queue', 'error', 'bridge', 'path'],
  },
  BEAT_FAILED: {
    brick: 'maestro',
    description: 'Cadence beat execution failed',
    fields: ['reason', 'bridge'],
  },
  AGENT_BEAT_INJECT: {
    brick: 'maestro',
    description: 'Agent work dispatched directly to an execution bridge',
    fields: ['slug', 'mailbox', 'new_messages', 'bridge_type', 'run_id'],
  },
  BEAT_COMPLETED: {
    brick: 'maestro',
    description: 'Cadence beat completed successfully',
    fields: ['slug', 'new_messages'],
  },

  // ── Mail Agent Lifecycle ─────────────────────────────────────────────────
  MAIL_CHECK_STARTED: {
    brick: 'mail-agent',
    description: 'Mailbox check cycle started',
    fields: ['vault_key', 'stub'],
  },
  MAIL_CHECK_FAILED: {
    brick: 'mail-agent',
    description: 'Mailbox check cycle failed (vault error, connection error)',
    fields: ['reason', 'error'],
  },
  MAIL_INBOX_CHECK: {
    brick: 'mail-agent',
    description: 'Mailbox check completed with message counts',
    fields: ['unseen', 'new_messages', 'stub'],
  },

  // ── Queue & Job Lifecycle ────────────────────────────────────────────────
  JOB_ENQUEUED: {
    brick: 'queue',
    description: 'New asynchronous job submitted to the Queue',
    fields: ['jobId', 'type', 'contractType'],
  },
  JOB_STARTED: {
    brick: 'queue',
    description: 'Queue worker dispatched job to bridge worker',
    fields: ['jobId', 'type', 'bridgeUrl', 'model'],
  },
  JOB_PROGRESS: {
    brick: 'queue',
    description: 'Queue worker updated job step execution progress',
    fields: ['jobId', 'step', 'totalSteps'],
  },
  JOB_COMPLETED: {
    brick: 'queue',
    description: 'Job execution completed and quality gate verified',
    fields: ['jobId', 'durationMs', 'exitCode', 'result'],
  },
  JOB_FAILED: {
    brick: 'queue',
    description: 'Job execution or quality gate verification failed',
    fields: ['jobId', 'durationMs', 'exitCode', 'error'],
  },

  // ── Pipeline Lifecycle ───────────────────────────────────────────────────
  DOCUMENT_INGESTED: {
    brick: 'pipeline',
    description: 'Document received for OCR / vector extraction',
    fields: ['docId', 'fileName', 'mimeType', 'sizeBytes'],
  },
  DOCUMENT_EXTRACTED: {
    brick: 'pipeline',
    description: 'Document extraction completed with text and geometric witnesses',
    fields: ['docId', 'charCount', 'pageCount', 'witnesses'],
  },
  EXTRACTION_FAILED: {
    brick: 'pipeline',
    description: 'Document extraction error',
    fields: ['docId', 'error'],
  },
};

/**
 * Creates a unique execution run ID.
 * @returns {string} e.g. "run-a1b2c3"
 */
export function generateExecutionId() {
  return `run-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Normalizes and formats an event record into the canonical shape.
 *
 * @param {object} entry
 * @param {string} entry.pod - Pod / brick identifier (e.g. "maestro", "mail-agent")
 * @param {string} entry.event - Event name in SCREAMING_SNAKE_CASE
 * @param {string} [entry.level='INFO'] - Severity level
 * @param {object} [entry.data={}] - Event metadata
 * @param {string|null} [entry.correlationId=null] - Trace / correlation ID across bricks
 * @param {string|null} [entry.executionId=null] - Local run identifier
 * @param {number} [entry.durationMs=0] - Duration in milliseconds
 * @param {number} [now=Date.now()] - Timestamp
 * @returns {object} Canonical event record
 */
export function formatEventRecord({
  pod,
  event,
  level = 'INFO',
  data = {},
  correlationId = null,
  correlation_id = null,
  executionId = null,
  execution_id = null,
  durationMs = 0,
  duration_ms = null,
} = {}, now = Date.now()) {
  if (!event) throw new Error('formatEventRecord: event name is required');

  const isoTime = new Date(now).toISOString();
  const normalizedLevel = String(level || 'INFO').toUpperCase();
  const safeLevel = VALID_LEVELS.has(normalizedLevel) ? normalizedLevel : 'INFO';
  const execId = executionId || execution_id || generateExecutionId();
  const corrId = correlationId || correlation_id || data?.jobId || data?.correlationId || null;
  const elapsed = duration_ms ?? durationMs ?? 0;

  return {
    at: isoTime,
    timestamp: isoTime,
    pod: pod || 'unknown',
    event: String(event).toUpperCase(),
    level: safeLevel,
    correlationId: corrId,
    correlation_id: corrId,
    execution_id: execId,
    data: data && typeof data === 'object' ? data : {},
    duration_ms: Math.round(Number(elapsed || 0) * 10) / 10,
  };
}

/**
 * Validates whether an event record conforms to the canonical contract.
 *
 * @param {object} record
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEventRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['Record must be a non-null object'] };
  }

  if (!record.at || isNaN(Date.parse(record.at))) {
    errors.push('record.at must be a valid ISO-8601 date string');
  }

  if (!record.pod || typeof record.pod !== 'string') {
    errors.push('record.pod must be a non-empty string');
  }

  if (!record.event || typeof record.event !== 'string' || !/^[A-Z0-9_]+$/.test(record.event)) {
    errors.push('record.event must be a SCREAMING_SNAKE_CASE string');
  }

  if (!record.level || !VALID_LEVELS.has(record.level)) {
    errors.push(`record.level must be one of ${Array.from(VALID_LEVELS).join(', ')}`);
  }

  if (record.data && typeof record.data !== 'object') {
    errors.push('record.data must be an object');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
