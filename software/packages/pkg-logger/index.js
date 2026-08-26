/**
 * @module @shaper/pkg-logger
 * Append-only structured JSONL audit logger and HTTP ingest gateway.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { EventEmitter } from 'node:events';

import { vitals, ageSeconds, writable } from './vitals.js';
import { formatEventRecord, generateExecutionId, KNOWN_EVENTS, VALID_LEVELS, validateEventRecord } from './events.js';

export { ingestLog } from './ingest-client.js';
export * from './vitals.js';
export * from './events.js';

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
 * Creates an HTTP REST + SSE gateway for centralized JSONL log collection.
 * @param {object} options
 * @param {number} [options.port=8520]
 * @param {string} [options.host='0.0.0.0']
 * @param {string} [options.logDir='/data/logger']
 * @param {LogCollector} [options.collector]
 * @returns {http.Server}
 */
export function createLoggerServer({
  port = 8520,
  host = '0.0.0.0',
  logDir = '/data/logger',
  collector = null,
} = {}) {
  const logCollector = collector || new LogCollector({ logDir });
  const sseClients = new Set();

  logCollector.emitter.on('event', (record) => {
    const frame = `event: log\ndata: ${JSON.stringify(record)}\n\n`;
    for (const client of sseClients) {
      client.write(frame);
    }
  });

  const server = http.createServer(async (req, res) => {
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      return sendJson(200, {
        status: 'ok',
        service: 'brick-logger',
        podsCount: logCollector.listPods().length,
        logDir: logCollector.logDir,
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && (pathname === '/api/vitals' || pathname === '/vitals')) {
      try {
        const v = await logCollector.vitals();
        return sendJson(200, v);
      } catch (err) {
        return sendJson(500, { error: err.message });
      }
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
      const pod = url.searchParams.get('pod') || null;
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      return sendJson(200, {
        status: 'ok',
        events: logCollector.readLastEvents(pod, limit),
      });
    }

    if (req.method === 'GET' && pathname === '/api/pods') {
      return sendJson(200, {
        status: 'ok',
        pods: logCollector.listPods(),
      });
    }

    if (req.method === 'POST' && pathname === '/api/ingest') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (Array.isArray(parsed)) {
            const records = parsed.map((entry) => logCollector.ingest(entry));
            return sendJson(200, { status: 'ok', processed: records.length, records });
          }
          const record = logCollector.ingest(parsed);
          return sendJson(200, { status: 'ok', record });
        } catch (err) {
          return sendJson(400, { error: err.message });
        }
      });
      return;
    }

    sendJson(404, { error: 'Not Found' });
  });

  server.listen(port, host);
  return server;
}
