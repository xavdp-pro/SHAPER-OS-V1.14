/**
 * @module @shaper/pkg-logger/events
 * Shared Event Vocabulary and Canonical Contract (Task 2).
 *
 * ── The Canonical Event Shape ──────────────────────────────────────────────
 * {
 *   "at": "2026-08-23T18:00:00.000Z",           // ISO timestamp (event occurrence)
 *   "timestamp": "2026-08-23T18:00:00.000Z",    // Backward compatibility mirror of "at"
 *   "pod": "brick-maestro",                      // Emitting brick / container
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
 * Events the base emits. The base declares its own vocabulary and no one
 * else's: a catalogue package that emits its own events registers them with
 * `registerEvents()` at import time, so the registry grows outward without the
 * base ever naming a brick it does not ship.
 */
export const BASE_EVENTS = {
  // ── Maestro cadence ─────────────────────────────────────────────────────
  MAESTRO_STARTED: {
    brick: 'brick-maestro',
    description: 'Cadence engine initialised and listening',
    fields: ['tasks', 'autoStart'],
  },
  TASK_REGISTERED: {
    brick: 'brick-maestro',
    description: 'A declared task entered the cadence registry',
    fields: ['slug', 'kind', 'cadence'],
  },
  SCHEDULER_STARTED: {
    brick: 'brick-maestro',
    description: 'Cadence pacing started for every registered task',
    fields: ['tasksCount'],
  },
  SCHEDULER_STOPPED: {
    brick: 'brick-maestro',
    description: 'Cadence pacing stopped',
    fields: [],
  },
  BEAT_STARTED: {
    brick: 'brick-maestro',
    description: 'Cadence beat initiated for a task',
    fields: ['slug', 'kind'],
  },
  BEAT_ENQUEUED: {
    brick: 'brick-maestro',
    description: 'Cadence beat dispatched as an asynchronous job into the queue',
    fields: ['slug', 'kind', 'queue'],
  },
  BEAT_SKIPPED: {
    brick: 'brick-maestro',
    description: 'Cadence beat omitted due to backpressure, unreachable queue, or missing prerequisites',
    fields: ['reason', 'jobId', 'since', 'queue', 'error', 'bridge', 'path'],
  },
  BEAT_EXECUTED: {
    brick: 'brick-maestro',
    description: 'Cadence beat executed and its outcome counted',
    fields: ['slug', 'kind', 'processed'],
  },
  BEAT_COMPLETED: {
    brick: 'brick-maestro',
    description: 'Cadence beat completed successfully',
    fields: ['slug', 'processed'],
  },
  BEAT_FAILED: {
    brick: 'brick-maestro',
    description: 'Cadence beat execution failed',
    fields: ['reason', 'bridge'],
  },
  BEAT_ERROR: {
    brick: 'brick-maestro',
    description: 'Scheduled beat threw before it could report an outcome',
    fields: ['slug', 'error'],
  },
  AGENT_BEAT_INJECT: {
    brick: 'brick-maestro',
    description: 'Task work dispatched directly to an execution bridge',
    fields: ['slug', 'kind', 'processed', 'bridge_type', 'run_id'],
  },

  // ── Queue & job lifecycle ───────────────────────────────────────────────
  JOB_ENQUEUED: {
    brick: 'brick-queue',
    description: 'New asynchronous job submitted to the queue',
    fields: ['jobId', 'type', 'contractType'],
  },
  JOB_STARTED: {
    brick: 'brick-queue',
    description: 'Queue worker dispatched job to a bridge worker',
    fields: ['jobId', 'type', 'bridgeUrl', 'model'],
  },
  JOB_PROGRESS: {
    brick: 'brick-queue',
    description: 'Queue worker updated job step execution progress',
    fields: ['jobId', 'step', 'totalSteps'],
  },
  JOB_COMPLETED: {
    brick: 'brick-queue',
    description: 'Job execution completed and quality gate verified',
    fields: ['jobId', 'durationMs', 'exitCode', 'result'],
  },
  JOB_FAILED: {
    brick: 'brick-queue',
    description: 'Job execution or quality gate verification failed',
    fields: ['jobId', 'durationMs', 'exitCode', 'error'],
  },
};

/**
 * Every event known to this process: the base vocabulary, plus whatever
 * catalogue packages have registered.
 */
export const KNOWN_EVENTS = { ...BASE_EVENTS };

/**
 * Declares events emitted by a package outside the base.
 *
 * This is how `pkg-mail-agent` or `pkg-ged-engine` make their events readable
 * without the base having to know they exist. A catalogue package calls this at
 * import time; the base ships no entry for a brick it does not contain.
 *
 * @param {Object<string, {brick: string, description: string, fields: string[]}>} events
 * @returns {Object} The merged registry
 */
export function registerEvents(events = {}) {
  for (const [name, spec] of Object.entries(events)) {
    if (!/^[A-Z0-9_]+$/.test(name)) {
      throw new Error(`registerEvents: ${name} must be SCREAMING_SNAKE_CASE`);
    }
    if (!spec || !spec.brick || !spec.description) {
      throw new Error(`registerEvents: ${name} must declare a brick and a description`);
    }
    if (BASE_EVENTS[name]) {
      throw new Error(`registerEvents: ${name} is a base event and cannot be redefined`);
    }
    KNOWN_EVENTS[name] = { fields: [], ...spec };
  }
  return KNOWN_EVENTS;
}

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
 * @param {string} entry.pod - Emitting brick identifier (e.g. "brick-maestro")
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
