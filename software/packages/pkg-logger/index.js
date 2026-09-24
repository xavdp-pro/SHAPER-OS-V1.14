/**
 * @module @shaper/pkg-logger
 * Structured event logger and HTTP ingest gateway.
 *
 * The library surface (EventLogger, LogCollector, vitals, events, ingest
 * client) is dependency-free and imported by other units. The brick serves the
 * unit's private MariaDB through ./mariadb-store.js, which only server.js loads.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { EventEmitter } from 'node:events';

import { vitals, ageSeconds, writable } from './vitals.js';
import { formatEventRecord, generateExecutionId } from './events.js';
import {
  DEFAULT_LIMITS,
  LoggerIngestError,
  normalizeIngestEntry,
  parseEventQuery,
} from './ingest-contract.js';

export { ingestLog } from './ingest-client.js';
export * from './vitals.js';
export * from './events.js';
export * from './ingest-contract.js';

export class EventLogger {
  /**
   * @param {Object} options
   * @param {string} options.pod - Unique container/pod name (e.g. mail-v1-contact)
   * @param {string} options.logDir - Directory where activity.jsonl is written
   * @param {string} [options.filename='activity.jsonl'] - Log file name
   */
  constructor({ pod, logDir, filename = 'activity.jsonl' }) {
    if (!pod) throw new Error('EventLogger requires a pod identifier');
    if (!logDir) throw new Error('EventLogger requires a log directory path');

    this.pod = pod;
    this.logDir = logDir;
    this.filePath = path.join(logDir, filename);

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Creates a short, unique execution ID.
   * @returns {string} (e.g. run-a1b2c3)
   */
  static generateExecutionId() {
    return generateExecutionId();
  }

  /**
   * Writes a structured event to activity.jsonl.
   *
   * @param {Object} entry
   * @param {string} [entry.executionId] - Execution run ID
   * @param {string} [entry.correlationId] - Cross-brick trace ID
   * @param {'INFO'|'WARN'|'ERROR'|'DEBUG'} [entry.level='INFO'] - Severity level
   * @param {string} entry.event - Event name in SCREAMING_SNAKE_CASE (e.g. MAIL_RECEIVED)
   * @param {Record<string, any>} [entry.data={}] - Event metadata
   * @param {number} [entry.durationMs=0] - Execution duration in milliseconds
   * @returns {Object} - Complete recorded canonical event object
   */
  log({
    executionId = null,
    execution_id = null,
    correlationId = null,
    correlation_id = null,
    level = 'INFO',
    event,
    data = {},
    durationMs = 0,
    duration_ms = null,
  }) {
    if (!event) throw new Error('EventLogger: event name is required');

    const entryObj = formatEventRecord({
      pod: this.pod,
      event,
      level,
      data,
      correlationId: correlationId || correlation_id,
      executionId: executionId || execution_id,
      durationMs: duration_ms ?? durationMs ?? 0,
    });

    const line = JSON.stringify(entryObj) + '\n';
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    fs.appendFileSync(this.filePath, line, 'utf8');

    return entryObj;
  }

  /**
   * Reads the last N events from the JSONL file.
   * @param {number} [limit=50]
   * @returns {Object[]}
   */
  readLastEvents(limit = 50) {
    if (!fs.existsSync(this.filePath)) return [];

    const content = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!content) return [];

    const lines = content.split('\n');
    const slice = lines.slice(Math.max(0, lines.length - limit));

    return slice.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  }
}

/**
 * Centralized multi-pod JSONL log collector.
 */
export class LogCollector {
  /**
   * @param {object} options
   * @param {string} options.logDir - Root directory for per-pod log folders
   */
  constructor({ logDir }) {
    if (!logDir) throw new Error('LogCollector requires a log directory path');
    this.logDir = logDir;
    this.loggers = new Map();
    this.emitter = new EventEmitter();
    this.startedAt = new Date().toISOString();
    this.lastWriteAt = null;

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  async vitals(now = Date.now()) {
    const allEvents = this.readLastEvents(null, 100);
    const lastEvent = allEvents[allEvents.length - 1];
    const eventsLast60s = allEvents.filter((e) => e.timestamp && (now - Date.parse(e.timestamp)) <= 60000).length;

    let bytesOnDisk = 0;
    try {
      const pods = this.listPods();
      for (const p of pods) {
        const fp = path.join(this.logDir, p, 'activity.jsonl');
        if (fs.existsSync(fp)) bytesOnDisk += fs.statSync(fp).size;
      }
    } catch {}

    const diskCheck = await writable(fs, this.logDir);

    return vitals({
      service: 'brick-logger',
      startedAt: this.startedAt,
      signals: {
        podsCount: this.listPods().length,
        eventsLast60s,
        lastWriteAgeSeconds: lastEvent ? ageSeconds(lastEvent.timestamp, now) : ageSeconds(this.lastWriteAt, now),
        bytesOnDisk,
      },
      checks: {
        disk: diskCheck,
      },
    }, now);
  }

  /**
   * @param {string} pod
   * @returns {EventLogger}
   */
  getLogger(pod) {
    const normalizedPod = pod || 'unknown';
    if (!this.loggers.has(normalizedPod)) {
      const podDir = path.join(this.logDir, normalizedPod);
      this.loggers.set(normalizedPod, new EventLogger({ pod: normalizedPod, logDir: podDir }));
    }
    return this.loggers.get(normalizedPod);
  }

  /**
   * Ingest a structured log entry and broadcast to SSE subscribers.
   * @param {object} entry
   * @returns {object}
   */
  ingest(entry) {
    if (!entry || !entry.event) {
      throw new Error('Ingest entry requires an event field');
    }

    const pod = entry.pod || 'unknown';
    const record = this.getLogger(pod).log({
      executionId: entry.execution_id || entry.executionId || null,
      correlationId: entry.correlation_id || entry.correlationId || null,
      level: entry.level || 'INFO',
      event: entry.event,
      data: entry.data || {},
      durationMs: entry.duration_ms ?? entry.durationMs ?? 0,
    });

    this.lastWriteAt = new Date().toISOString();
    this.emitter.emit('event', record);
    return record;
  }

  /**
   * @param {string} [pod]
   * @param {number} [limit=50]
   * @returns {object[]}
   */
  readLastEvents(pod = null, limit = 50) {
    if (pod) {
      return this.getLogger(pod).readLastEvents(limit);
    }

    const pods = this.listPods();
    const allEvents = [];
    for (const podName of pods) {
      allEvents.push(...this.getLogger(podName).readLastEvents(limit));
    }
    return allEvents
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
      .slice(-limit);
  }

  /**
   * @returns {string[]}
   */
  listPods() {
    if (!fs.existsSync(this.logDir)) return [];

    return fs.readdirSync(this.logDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }
}

/**
 * The JSONL collector behind the same asynchronous contract as the MariaDB
 * store. Declared DEV scaffolding: it keeps what it is given and nothing more —
 * no idempotency on source event ids, no digest, no transaction.
 */
export class FileEventStore {
  /** @param {LogCollector} collector */
  constructor(collector) {
    this.collector = collector;
    this.storageKind = 'file';
    this.emitter = collector.emitter;
    this.logDir = collector.logDir;
  }

  async ingest(claims) {
    return claims.map((claim) => ({
      record: this.collector.ingest({
        pod: claim.pod,
        event: claim.event,
        level: claim.level,
        data: claim.data,
        correlation_id: claim.correlationId,
        execution_id: claim.executionId,
        duration_ms: claim.durationMs,
      }),
      replayed: false,
    }));
  }

  async query({ pod = null, correlationId = null, event = null, since = null, until = null, limit = 50 } = {}) {
    const filtered = correlationId || event || since !== null || until !== null;
    if (!filtered) return this.collector.readLastEvents(pod, limit);
    return this.collector.readLastEvents(pod, Number.MAX_SAFE_INTEGER)
      .filter((e) => !correlationId || e.correlationId === correlationId || e.correlation_id === correlationId)
      .filter((e) => !event || e.event === event)
      .filter((e) => since === null || Date.parse(e.timestamp) >= since)
      .filter((e) => until === null || Date.parse(e.timestamp) < until)
      .slice(-limit);
  }

  async listPods() {
    return this.collector.listPods();
  }

  async vitals(now = Date.now()) {
    return this.collector.vitals(now);
  }
}

/**
 * A storage failure is an unavailable logger (503), never a malformed request;
 * a typed refusal answers with its own status.
 * @param {Error & { code?: string, status?: number }} err
 * @returns {number}
 */
export function storeErrorStatus(err) {
  if (err instanceof LoggerIngestError) return err.status;
  if (err && err.name === 'UnitDbError') return 503;
  const code = String((err && err.code) || '');
  if (/^(ER_|ECONN|ENOENT|EACCES|ENOSPC|EROFS|EIO|EPIPE|ETIMEDOUT|PROTOCOL_|POOL_)/.test(code)) return 503;
  return 500;
}

/**
 * Reads a request body up to `maxBytes`, decoding UTF-8 once over the whole
 * body. A larger body is refused before it is buffered.
 */
function readBoundedBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new LoggerIngestError(413, 'BODY_TOO_LARGE', `request body exceeds ${maxBytes} bytes`);
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(tooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * Creates an HTTP REST + SSE gateway over an event store.
 *
 * With `store`, the gateway serves that store (the brick passes the MariaDB
 * store). Without it, it serves the JSONL `collector`, or a new one under
 * `logDir` — the in-process and DEV path, unchanged for library callers.
 *
 * @param {object} options
 * @param {number} [options.port=8620]
 * @param {string} [options.host='0.0.0.0']
 * @param {string} [options.logDir='/data/logger']
 * @param {LogCollector} [options.collector]
 * @param {object} [options.store] - an event store (ingest, query, listPods, vitals, emitter[, probe])
 * @param {object} [options.limits] - see DEFAULT_LIMITS
 * @returns {http.Server}
 */
export function createLoggerServer({
  port = 8620,
  host = '0.0.0.0',
  logDir = '/data/logger',
  collector = null,
  store = null,
  limits = {},
} = {}) {
  const eventStore = store || new FileEventStore(collector || new LogCollector({ logDir }));
  const bounds = { ...DEFAULT_LIMITS, ...limits };
  const sseClients = new Set();

  eventStore.emitter.on('event', (record) => {
    const frame = `event: log\ndata: ${JSON.stringify(record)}\n\n`;
    for (const client of sseClients) {
      client.write(frame);
    }
  });

  const server = http.createServer(async (req, res) => {
    const sendJson = (statusCode, data, headers = {}) => {
      if (res.headersSent) return;
      res.writeHead(statusCode, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(data));
    };

    try {
      await route(req, res, sendJson);
    } catch (err) {
      const status = storeErrorStatus(err);
      if (err instanceof LoggerIngestError) {
        // A refused body is not read further: the connection closes behind the answer.
        const headers = err.code === 'BODY_TOO_LARGE' ? { Connection: 'close' } : {};
        return sendJson(status, { error: err.message, code: err.code, ...err.details }, headers);
      }
      return sendJson(status, {
        error: status === 503 ? 'Logger storage unavailable' : 'Logger request failed',
        code: err.code || null,
        detail: err.message,
      });
    }
  });

  async function ingest(req, sendJson) {
    const body = await readBoundedBody(req, bounds.maxBodyBytes);
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch (err) {
      throw new LoggerIngestError(400, 'INVALID_JSON', err.message);
    }
    const batch = Array.isArray(parsed);
    const entries = batch ? parsed : [parsed];
    if (entries.length > bounds.maxBatch) {
      throw new LoggerIngestError(413, 'BATCH_TOO_LARGE', `a batch holds at most ${bounds.maxBatch} entries`);
    }
    // Every entry is validated before anything is written.
    const claims = entries.map((entry, index) => {
      try {
        return normalizeIngestEntry(entry, bounds);
      } catch (err) {
        if (batch && err instanceof LoggerIngestError) err.details = { ...err.details, index };
        throw err;
      }
    });
    const results = claims.length ? await eventStore.ingest(claims) : [];
    if (batch) {
      const replays = results.flatMap((r, index) => (r.replayed ? [index] : []));
      return sendJson(200, {
        status: 'ok',
        processed: results.length,
        records: results.map((r) => r.record),
        ...(replays.length ? { replayed: replays } : {}),
      });
    }
    const [{ record, replayed }] = results;
    return sendJson(200, { status: 'ok', record, ...(replayed ? { replayed: true } : {}) });
  }

  async function route(req, res, sendJson) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      const db = typeof eventStore.probe === 'function' ? await eventStore.probe() : null;
      if (db && !db.ok) {
        return sendJson(503, {
          status: 'unavailable',
          service: 'brick-logger',
          storage: eventStore.storageKind,
          db,
          timestamp: new Date().toISOString(),
        });
      }
      return sendJson(200, {
        status: 'ok',
        service: 'brick-logger',
        storage: eventStore.storageKind,
        ...(db ? { db } : {}),
        podsCount: (await eventStore.listPods()).length,
        ...(eventStore.logDir ? { logDir: eventStore.logDir } : {}),
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && (pathname === '/api/vitals' || pathname === '/vitals')) {
      return sendJson(200, await eventStore.vitals());
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 30000);

      req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/events/last') {
      const filters = parseEventQuery(url.searchParams, bounds);
      return sendJson(200, {
        status: 'ok',
        events: await eventStore.query(filters),
      });
    }

    if (req.method === 'GET' && pathname === '/api/pods') {
      return sendJson(200, {
        status: 'ok',
        pods: await eventStore.listPods(),
      });
    }

    if (req.method === 'POST' && pathname === '/api/ingest') {
      return ingest(req, sendJson);
    }

    sendJson(404, { error: 'Not Found' });
  }

  server.listen(port, host);
  return server;
}
