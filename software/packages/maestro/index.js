/**
 * @file index.js
 * @package @shaper/maestro-engine
 * @description Orchestration and cadence engine (Beat Scheduler) for AI agent Podman containers.
 * Supervises and paces each registered podmail in the universe.
 */

import http from 'node:http';
import { EventLogger } from '../logger/index.js';
import { vitals, ageSeconds, dependency, writable } from '../logger/vitals.js';

export class MaestroScheduler {
  constructor({
    pod = 'maestro-v1',
    logDir = '/tmp/maestro-logs',
    beatHandler = null,
  } = {}) {
    this.pod = pod;
    this.logger = new EventLogger({ pod, logDir });
    this.registry = new Map();
    this.timers = new Map();
    this.isRunning = false;
    this.beatHandler = beatHandler;
    this.startedAt = new Date().toISOString();
    this.beatsSkippedTotal = 0;
  }

  vitals(now = Date.now()) {
    const podsSummary = {};
    for (const [slug, entry] of this.registry.entries()) {
      podsSummary[slug] = {
        lastBeatAgeSeconds: ageSeconds(entry.lastBeatAt, now),
        beatsCount: entry.beatsCount || 0,
        cadenceSeconds: entry.cadenceSeconds,
        lastSkippedReason: entry.lastSkippedReason || null,
      };
    }

    return vitals({
      service: 'maestro-v1',
      startedAt: this.startedAt,
      signals: {
        podsRegistered: this.registry.size,
        activePods: Array.from(this.registry.values()).filter((p) => p.status === 'active').length,
        isRunning: this.isRunning,
        beatsSkippedTotal: this.beatsSkippedTotal,
        pods: podsSummary,
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
   * Registers a Podman Mail container in Maestro's official registry.
   *
   * @param {Object} podmailConfig
   * @param {string} podmailConfig.slug - Unique identifier (e.g. mail-v1-contact-zoutik-shop)
   * @param {string} podmailConfig.mailbox - Monitored email address (e.g. contact@zoutik.example.com)
   * @param {number} podmailConfig.port - Internal or network port
   * @param {string} [podmailConfig.vaultKey] - Key in vault-v1
   * @param {number} [podmailConfig.cadenceSeconds=60] - Cadence interval in seconds
   * @param {string} [podmailConfig.contextPath] - Path to AGENT-CONTEXT.md file
   * @returns {Object} - Registered entry
   */
  registerPodMail(podmailConfig) {
    if (!podmailConfig.slug || !podmailConfig.mailbox || !podmailConfig.port) {
      throw new Error('slug, mailbox and port are required to register a podmail');
    }

    const entry = {
      slug: podmailConfig.slug,
      mailbox: podmailConfig.mailbox,
      port: podmailConfig.port,
      vaultKey: podmailConfig.vaultKey || `mailbox-${podmailConfig.slug}`,
      cadenceSeconds: podmailConfig.cadenceSeconds || 60,
      contextPath: podmailConfig.contextPath || `/apps/${podmailConfig.slug}/context/AGENT-CONTEXT.md`,
      status: 'active',
      lastBeatAt: null,
      lastProcessedCount: 0,
      registeredAt: new Date().toISOString(),
    };

    this.registry.set(podmailConfig.slug, entry);

    this.logger.log({
      event: 'PODMAIL_REGISTERED',
      data: { slug: entry.slug, mailbox: entry.mailbox, port: entry.port, cadence: entry.cadenceSeconds },
    });

    if (this.isRunning) {
      this._schedulePodBeat(entry);
    }

    return entry;
  }

  /**
   * Register a parameterized agent task (mail, bridge, or generic).
   * One brick-agent image — N registry entries, not N Podman images.
   *
   * @param {Object} taskConfig
   * @param {string} taskConfig.slug
   * @param {string} [taskConfig.kind='bridge'] - mail | bridge | generic
   * @param {string} [taskConfig.bridgeType] - agy | cursor | claude | opencode
   * @param {string} [taskConfig.bridgeUrl] - base URL e.g. http://127.0.0.1:4330
   * @param {string} [taskConfig.mailbox]
   * @param {number} taskConfig.port - legacy field / bridge port hint
   * @param {string} [taskConfig.vaultKey]
   * @param {number} [taskConfig.cadenceSeconds=300]
   * @param {string} [taskConfig.contextPath]
   * @param {string} [taskConfig.contextText]
   * @param {string} [taskConfig.beatMessage]
   */
  registerAgentTask(taskConfig) {
    const slug = taskConfig.slug || taskConfig.id || taskConfig.name || 'agent-task';
    const entry = this.registerPodMail({
      ...taskConfig,
      slug,
      mailbox: taskConfig.mailbox || `${slug}@local`,
      port: taskConfig.port || 80,
    });
    entry.kind = taskConfig.kind || 'bridge';
    entry.bridgeType = taskConfig.bridgeType || 'agy';
    entry.bridgeUrl = taskConfig.bridgeUrl || (taskConfig.port ? `http://127.0.0.1:${taskConfig.port}` : null);
    entry.contextText = taskConfig.contextText || null;
    entry.beatMessage = taskConfig.beatMessage || null;
    entry.checkpointPath = taskConfig.checkpointPath || null;
    this.registry.set(entry.slug, entry);
    return entry;
  }

  /**
   * Triggers a "Beat" (sync pulse) to a registered podmail.
   *
   * @param {string} slug - Podmail identifier
   * @param {Function} [beatHandler] - Mock handler or HTTP executor
   * @returns {Promise<Object>} - Beat report
   */
  async triggerBeat(slug, beatHandler = null) {
    const entry = this.registry.get(slug);
    if (!entry) {
      throw new Error(`Podmail not registered in Maestro: ${slug}`);
    }

    const start = Date.now();
    let result = { ok: true, newMessages: 0 };

    const handler = beatHandler || this.beatHandler;
    if (typeof handler === 'function') {
      result = await handler(entry);
    }

    const duration = Date.now() - start;
    entry.lastBeatAt = new Date().toISOString();
    entry.lastProcessedCount += (result.newMessages || 0);

    const logEntry = this.logger.log({
      event: 'BEAT_EXECUTED',
      data: {
        slug: entry.slug,
        mailbox: entry.mailbox,
        new_messages: result.newMessages || 0,
      },
      durationMs: duration,
    });

    return {
      slug: entry.slug,
      mailbox: entry.mailbox,
      status: 'ok',
      new_messages: result.newMessages || 0,
      duration_ms: duration,
      log_entry: logEntry,
    };
  }

  _schedulePodBeat(entry) {
    if (this.timers.has(entry.slug)) {
      clearInterval(this.timers.get(entry.slug));
    }
    const intervalMs = (entry.cadenceSeconds || 60) * 1000;
    const timer = setInterval(() => {
      this.triggerBeat(entry.slug, this.beatHandler).catch(err => {
        this.logger.log({
          level: 'ERROR',
          event: 'BEAT_ERROR',
          data: { slug: entry.slug, error: err.message }
        });
      });
    }, intervalMs);
    this.timers.set(entry.slug, timer);
  }

  startScheduler() {
    this.isRunning = true;
    for (const entry of this.registry.values()) {
      this._schedulePodBeat(entry);
    }
    this.logger.log({ event: 'SCHEDULER_STARTED', data: { podsCount: this.registry.size } });
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
   * Returns the list of all registered podmails and their cadence state.
   * @returns {Array<Object>}
   */
  listRegisteredPods() {
    return Array.from(this.registry.values());
  }
}

/**
 * Creates an HTTP REST server for Maestro.
 * @param {object} options
 * @param {number} [options.port=8530]
 * @param {string} [options.host='0.0.0.0']
 * @param {MaestroScheduler} [options.scheduler]
 * @returns {http.Server}
 */
export function createMaestroServer({ port = 8530, host = '0.0.0.0', scheduler = null } = {}) {
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
        service: 'maestro-v1',
        isRunning: sched.isRunning,
        podsCount: sched.registry.size,
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'GET' && (pathname === '/api/vitals' || pathname === '/vitals')) {
      try {
        const v = sched.vitals();
        return sendJson(200, v);
      } catch (err) {
        return sendJson(500, { error: err.message });
      }
    }

    if (req.method === 'GET' && pathname === '/api/pods') {
      return sendJson(200, {
        status: 'ok',
        pods: sched.listRegisteredPods()
      });
    }

    if (req.method === 'POST' && pathname === '/api/pods/register') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const config = JSON.parse(body || '{}');
          const entry = sched.registerPodMail(config);
          return sendJson(200, { status: 'ok', pod: entry });
        } catch (err) {
          return sendJson(400, { error: err.message });
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname.startsWith('/api/pods/') && pathname.endsWith('/tick')) {
      const parts = pathname.split('/');
      const slug = parts[3];
      sched.triggerBeat(slug)
        .then(result => sendJson(200, { status: 'ok', result }))
        .catch(err => sendJson(500, { error: err.message }));
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
