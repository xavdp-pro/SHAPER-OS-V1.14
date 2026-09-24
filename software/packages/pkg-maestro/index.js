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
 *
 * `MaestroScheduler` below keeps its registry, timers and counters in memory:
 * it is the DEV scaffolding selected explicitly with MAESTRO_STORE=memory. The
 * brick's default is `DurableMaestro` (durable-scheduler.js), whose schedules
 * and occurrences live in the unit's private MariaDB.
 */

import http from 'node:http';
import { EventLogger } from '../pkg-logger/index.js';
import { vitals, ageSeconds } from '../pkg-logger/vitals.js';
import { TASK_KINDS, parseOccurrenceQuery } from './occurrence.js';

/** Task kinds the base understands. A universe may not invent a fourth here. */
export { TASK_KINDS };

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
 * A storage failure is an unavailable Maestro (503), never a malformed
 * request and never an empty answer. A named refusal carries its own status.
 * @param {Error & { code?: string, status?: number }} err
 * @returns {number}
 */
export function storeErrorStatus(err) {
  if (!err) return 500;
  if (err.name === 'UnitDbError') return 503;
  const code = String(err.code || '');
  if (/^(ER_|ECONN|PROTOCOL_|POOL_|ETIMEDOUT|EPIPE|EHOSTUNREACH)/.test(code)) return 503;
  if (err.name === 'ScheduleError') return err.status || 400;
  return 500;
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

/**
 * Creates the HTTP surface of `brick-maestro`.
 *
 * The same routes serve both schedulers: the in-memory `MaestroScheduler`
 * (DEV scaffolding) and the `DurableMaestro` whose truth is its private
 * MariaDB. Every handler awaits, so a database answer — or its absence — is
 * what the caller receives.
 *
 * @param {object} options
 * @param {number} [options.port=8630]
 * @param {string} [options.host='0.0.0.0']
 * @param {MaestroScheduler|object} [options.scheduler]
 * @returns {http.Server}
 */
export function createMaestroServer({ port = 8630, host = '0.0.0.0', scheduler = null } = {}) {
  const sched = scheduler || new MaestroScheduler();

  const server = http.createServer(async (req, res) => {
    const sendJson = (statusCode, data) => {
      if (res.headersSent) return;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    try {
      await route(req, sendJson);
    } catch (err) {
      const status = storeErrorStatus(err);
      sendJson(status, {
        error: status === 503 ? 'Maestro storage unavailable' : err.message,
        code: err.code || null,
        detail: err.message,
      });
    }
  });

  async function route(req, sendJson) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      if (typeof sched.health === 'function') {
        const health = await sched.health();
        return sendJson(health.ok ? 200 : 503, health.body);
      }
      return sendJson(200, {
        status: 'ok',
        service: sched.service,
        isRunning: sched.isRunning,
        tasksCount: sched.registry.size,
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && (pathname === '/api/vitals' || pathname === '/vitals')) {
      return sendJson(200, await sched.vitals());
    }

    if (req.method === 'GET' && pathname === '/api/tasks') {
      const includeDisabled = url.searchParams.get('include') === 'disabled';
      return sendJson(200, { status: 'ok', tasks: await sched.listRegisteredTasks({ includeDisabled }) });
    }

    if (req.method === 'GET' && pathname === '/api/occurrences') {
      if (typeof sched.listOccurrences !== 'function') {
        return sendJson(501, {
          error: 'occurrences are recorded only with MAESTRO_STORE=mariadb',
          code: 'NO_DURABLE_STORE',
        });
      }
      const query = parseOccurrenceQuery(url.searchParams);
      return sendJson(200, { status: 'ok', ...query, occurrences: await sched.listOccurrences(query) });
    }

    if (req.method === 'POST' && pathname === '/api/tasks/register') {
      let parsed;
      try {
        parsed = JSON.parse((await readBody(req)) || '{}');
      } catch (err) {
        return sendJson(400, { error: err.message, code: 'INVALID_JSON' });
      }
      try {
        const entry = await sched.registerTask(parsed);
        return sendJson(200, { status: 'ok', task: entry });
      } catch (err) {
        if (storeErrorStatus(err) === 503) throw err;
        return sendJson(400, { error: err.message, code: err.code || null });
      }
    }

    if (req.method === 'POST' && pathname.startsWith('/api/tasks/') && pathname.endsWith('/tick')) {
      const slug = decodeURIComponent(pathname.split('/')[3] || '');
      try {
        const result = await sched.triggerBeat(slug);
        return sendJson(200, { status: 'ok', result });
      } catch (err) {
        const status = storeErrorStatus(err);
        if (status === 503) throw err;
        return sendJson(status, { error: err.message, code: err.code || null });
      }
    }

    if (req.method === 'POST' && pathname === '/api/scheduler/start') {
      // The durable scheduler's first tick runs in the background; its
      // failures are recorded by the scheduler itself, never thrown here.
      Promise.resolve(sched.startScheduler()).catch(() => {});
      return sendJson(200, { status: 'ok', message: 'Scheduler started' });
    }

    if (req.method === 'POST' && pathname === '/api/scheduler/stop') {
      sched.stopScheduler();
      return sendJson(200, { status: 'ok', message: 'Scheduler stopped' });
    }

    return sendJson(404, { error: 'Not Found' });
  }

  server.listen(port, host);
  return server;
}
