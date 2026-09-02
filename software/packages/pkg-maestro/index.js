/**
 * @file index.js
 * @package @shaper/pkg-maestro
 * @description Cadence engine for a universe. Maestro holds the declared
 * `task-*` registry, paces each task, and hands the work to the queue or to a
 * bridge. It knows what a task is; it knows nothing about what a task is for.
 *
 * A task carries a slug and a cadence. Everything else — a bridge, a context,
 * a port, a label — is optional, because a universe declares only what its own
 * work needs. Requiring a field that only mail traffic ever had is how the
 * base stopped being generic in the first place.
 */

import http from 'node:http';
import { EventLogger } from '../pkg-logger/index.js';
import { vitals, ageSeconds, dependency, writable } from '../pkg-logger/vitals.js';

/** Task kinds the base understands. A universe may not invent a fourth here. */
export const TASK_KINDS = new Set(['generic', 'bridge', 'queue']);

export class MaestroScheduler {
  constructor({
    service = 'brick-maestro',
    logDir = '/tmp/maestro-logs',
    beatHandler = null,
  } = {}) {
    this.service = service;
    this.logger = new EventLogger({ pod: service, logDir });
    this.registry = new Map();
    this.timers = new Map();
    this.isRunning = false;
    this.beatHandler = beatHandler;
    this.startedAt = new Date().toISOString();
    this.beatsSkippedTotal = 0;
  }

  vitals(now = Date.now()) {
    const tasksSummary = {};
    for (const [slug, entry] of this.registry.entries()) {
      tasksSummary[slug] = {
        lastBeatAgeSeconds: ageSeconds(entry.lastBeatAt, now),
        beatsCount: entry.beatsCount || 0,
        cadenceSeconds: entry.cadenceSeconds,
        lastSkippedReason: entry.lastSkippedReason || null,
      };
    }

    return vitals({
      service: this.service,
      startedAt: this.startedAt,
      signals: {
        tasksRegistered: this.registry.size,
        activeTasks: Array.from(this.registry.values()).filter((t) => t.status === 'active').length,
        isRunning: this.isRunning,
        beatsSkippedTotal: this.beatsSkippedTotal,
        tasks: tasksSummary,
      },
    }, now);
  }

  /**
   * Set or replace the default beat handler used by scheduled ticks.
   * @param {Function|null} handler
   */
  setBeatHandler(handler) {
    this.beatHandler = handler;
  }

  /**
   * Registers a declared `task-*` in this universe's cadence registry.
   *
   * One `brick-maestro` image serves N registry entries; a new task is a new
   * entry, never a new image.
   *
   * @param {Object} taskConfig
   * @param {string} taskConfig.slug - Unique task identifier (e.g. `task-base-proof`)
   * @param {string} [taskConfig.kind='generic'] - generic | bridge | queue
   * @param {number} [taskConfig.cadenceSeconds=300] - Seconds between beats
   * @param {string} [taskConfig.instruction] - What the task asks of the engine
   * @param {string} [taskConfig.bridgeType] - Which `brick-bridge-*` executes it
   * @param {string} [taskConfig.bridgeUrl] - Base URL of that bridge
   * @param {string} [taskConfig.contextPath] - Path to the universe `ctx-*` file
   * @param {string} [taskConfig.contextText] - Inline context, when no file exists
   * @param {string} [taskConfig.beatMessage] - Message sent on each beat
   * @param {string} [taskConfig.vaultKey] - Secret this task may read
   * @param {string} [taskConfig.label] - Free-form subject the task acts on
   * @param {number} [taskConfig.port] - Port hint, when the task targets one
   * @returns {Object} The registered entry
   */
  registerTask(taskConfig = {}) {
    const slug = taskConfig.slug;
    if (!slug) {
      throw new Error('slug is required to register a task');
    }

    const kind = taskConfig.kind || 'generic';
    if (!TASK_KINDS.has(kind)) {
      throw new Error(`unknown task kind: ${kind} (expected ${Array.from(TASK_KINDS).join(', ')})`);
    }

    const port = taskConfig.port ?? null;
    const entry = {
      slug,
      kind,
      cadenceSeconds: taskConfig.cadenceSeconds || 300,
      instruction: taskConfig.instruction ?? null,
      bridgeType: taskConfig.bridgeType ?? null,
      bridgeUrl: taskConfig.bridgeUrl || (port ? `http://127.0.0.1:${port}` : null),
      contextPath: taskConfig.contextPath ?? null,
      contextText: taskConfig.contextText ?? null,
      beatMessage: taskConfig.beatMessage ?? null,
      checkpointPath: taskConfig.checkpointPath ?? null,
      vaultKey: taskConfig.vaultKey || `vault-${slug}`,
      label: taskConfig.label ?? null,
      port,
      status: 'active',
      lastBeatAt: null,
      processedTotal: 0,
      registeredAt: new Date().toISOString(),
    };

    this.registry.set(slug, entry);

    this.logger.log({
      event: 'TASK_REGISTERED',
      data: { slug: entry.slug, kind: entry.kind, cadence: entry.cadenceSeconds },
    });

    if (this.isRunning) {
      this._scheduleTaskBeat(entry);
    }

    return entry;
  }

  /**
   * Triggers a beat — one cadence pulse — for a registered task.
   *
   * @param {string} slug - Task identifier
   * @param {Function} [beatHandler] - Executor, defaulting to the scheduler's own
   * @returns {Promise<Object>} Beat report
   */
  async triggerBeat(slug, beatHandler = null) {
    const entry = this.registry.get(slug);
    if (!entry) {
      throw new Error(`Task not registered in Maestro: ${slug}`);
    }

    const start = Date.now();
    let result = { ok: true, processed: 0 };

    const handler = beatHandler || this.beatHandler;
    if (typeof handler === 'function') {
      result = await handler(entry);
    }

    const processed = result?.processed || 0;
    const duration = Date.now() - start;
    entry.lastBeatAt = new Date().toISOString();
    entry.processedTotal += processed;

    const logEntry = this.logger.log({
      event: 'BEAT_EXECUTED',
      data: { slug: entry.slug, kind: entry.kind, processed },
      durationMs: duration,
    });

    return {
      slug: entry.slug,
      kind: entry.kind,
      status: 'ok',
      processed,
      duration_ms: duration,
      log_entry: logEntry,
    };
  }

  _scheduleTaskBeat(entry) {
    if (this.timers.has(entry.slug)) {
      clearInterval(this.timers.get(entry.slug));
    }
    const intervalMs = (entry.cadenceSeconds || 300) * 1000;
    const timer = setInterval(() => {
      this.triggerBeat(entry.slug, this.beatHandler).catch((err) => {
        this.logger.log({
          level: 'ERROR',
          event: 'BEAT_ERROR',
          data: { slug: entry.slug, error: err.message },
        });
      });
    }, intervalMs);
    this.timers.set(entry.slug, timer);
  }

  startScheduler() {
    this.isRunning = true;
    for (const entry of this.registry.values()) {
      this._scheduleTaskBeat(entry);
    }
    this.logger.log({ event: 'SCHEDULER_STARTED', data: { tasksCount: this.registry.size } });
  }

  stopScheduler() {
    this.isRunning = false;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.logger.log({ event: 'SCHEDULER_STOPPED' });
  }

  /**
   * Returns every registered task with its cadence state.
   * @returns {Array<Object>}
   */
  listRegisteredTasks() {
    return Array.from(this.registry.values());
  }
}

/**
 * Creates the HTTP surface of `brick-maestro`.
 * @param {object} options
 * @param {number} [options.port=8630]
 * @param {string} [options.host='0.0.0.0']
 * @param {MaestroScheduler} [options.scheduler]
 * @returns {http.Server}
 */
export function createMaestroServer({ port = 8630, host = '0.0.0.0', scheduler = null } = {}) {
  const sched = scheduler || new MaestroScheduler();

  const server = http.createServer((req, res) => {
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      return sendJson(200, {
        status: 'ok',
        service: sched.service,
        isRunning: sched.isRunning,
        tasksCount: sched.registry.size,
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && (pathname === '/api/vitals' || pathname === '/vitals')) {
      try {
        return sendJson(200, sched.vitals());
      } catch (err) {
        return sendJson(500, { error: err.message });
      }
    }

    if (req.method === 'GET' && pathname === '/api/tasks') {
      return sendJson(200, { status: 'ok', tasks: sched.listRegisteredTasks() });
    }

    if (req.method === 'POST' && pathname === '/api/tasks/register') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const entry = sched.registerTask(JSON.parse(body || '{}'));
          return sendJson(200, { status: 'ok', task: entry });
        } catch (err) {
          return sendJson(400, { error: err.message });
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/api/tasks/') && pathname.endsWith('/tick')) {
      const slug = pathname.split('/')[3];
      sched.triggerBeat(slug)
        .then((result) => sendJson(200, { status: 'ok', result }))
        .catch((err) => sendJson(500, { error: err.message }));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/scheduler/start') {
      sched.startScheduler();
      return sendJson(200, { status: 'ok', message: 'Scheduler started' });
    }

    if (req.method === 'POST' && pathname === '/api/scheduler/stop') {
      sched.stopScheduler();
      return sendJson(200, { status: 'ok', message: 'Scheduler stopped' });
    }

    sendJson(404, { error: 'Not Found' });
  });

  server.listen(port, host);
  return server;
}
