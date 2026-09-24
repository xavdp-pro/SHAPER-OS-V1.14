#!/usr/bin/env node
/**
 * @package @shaper/pkg-maestro
 * Daemon — loads the declared tasks from MAESTRO_TASKS_FILE and paces them.
 *
 * Storage is the unit's private MariaDB (Rules 4 and 26): MAESTRO_STORE=mariadb,
 * the brick default. Schedules and occurrences live there, every occurrence is
 * submitted to Queue under its deterministic idempotency key, and a restart
 * reconciles from what MariaDB holds.
 *
 * MAESTRO_STORE=memory keeps the in-memory registry and timers — and with them
 * the direct-to-bridge legacy path — as declared DEV scaffolding, selected
 * explicitly. Nothing ever falls back to it.
 *
 * Intent: software/packages/pkg-maestro/INTENT.md#private-mariadb
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMaestroServer } from './index.js';
import { ingestLog } from '../pkg-logger/ingest-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHAPER_ROOT = path.resolve(__dirname, '../..');

const PORT = parseInt(process.env.PORT || process.env.MAESTRO_PORT || '8630', 10);
const HOST = process.env.HOST || process.env.MAESTRO_HOST || '0.0.0.0';
const LOG_DIR = process.env.LOG_DIR || '/data/brick-maestro/log';
const TASKS_FILE = process.env.MAESTRO_TASKS_FILE || '';
const BRIDGE_URL = process.env.MAESTRO_BRIDGE_URL || '';
const QUEUE_URL = process.env.MAESTRO_QUEUE_URL || '';
const LOGGER_URL = process.env.LOGGER_URL || '';
const BRIDGE_AUTH_TOKEN = process.env.BRIDGE_AUTH_TOKEN || '';
const AUTO_START = process.env.MAESTRO_AUTO_START === '1';
const STORE = (process.env.MAESTRO_STORE || 'mariadb').trim();

function refuse(code, message) {
  console.error(`[brick-maestro] refusing to start: ${code} — ${message}`);
  process.exit(1);
}

if (STORE !== 'mariadb' && STORE !== 'memory') {
  console.error(`[brick-maestro] MAESTRO_STORE must be "mariadb" or "memory"; got "${STORE}"`);
  process.exit(1);
}

console.log(`[brick-maestro] Starting on ${HOST}:${PORT}...`);

/**
 * The durable path. Every precondition that needs no database is checked
 * before the database is opened, and each refusal names its reason.
 */
async function startDurable() {
  const { assertUniverseId, normalizeDeclaration } = await import('./occurrence.js');
  const { loadTaskDeclarations } = await import('./task-paths.js');

  let universeId;
  try {
    universeId = assertUniverseId(process.env.SHAPER_UNIVERSE_ID || '');
  } catch (err) {
    refuse(err.code, `${err.message} (MAESTRO_STORE=mariadb)`);
  }
  if (!QUEUE_URL) {
    refuse('QUEUE_URL_MISSING', 'MAESTRO_QUEUE_URL is required with MAESTRO_STORE=mariadb: every occurrence goes through Queue, and this path has no direct bridge');
  }
  if (BRIDGE_URL) {
    console.warn('[brick-maestro] MAESTRO_BRIDGE_URL is ignored with MAESTRO_STORE=mariadb: the direct-to-bridge path exists only as memory-mode legacy');
  }

  let declarations = [];
  if (TASKS_FILE) {
    try {
      const loaded = loadTaskDeclarations(TASKS_FILE, { shaperRoot: SHAPER_ROOT });
      for (const warning of loaded.warnings) console.warn(`[brick-maestro] ${warning}`);
      declarations = loaded.tasks.map((task) => normalizeDeclaration(task));
    } catch (err) {
      refuse(err.code || 'INVALID_SCHEDULE', err.message);
    }
  } else {
    console.log('[brick-maestro] No MAESTRO_TASKS_FILE: no declared schedule, Maestro stays idle and creates no work');
  }

  const { MariaDbMaestroStore } = await import('./mariadb-store.js');
  const { DurableMaestro } = await import('./durable-scheduler.js');

  let store;
  try {
    store = await MariaDbMaestroStore.open({ slug: process.env.SHAPER_UNIT_SLUG || 'maestro' });
  } catch (err) {
    refuse(err.code || 'ERROR', err.message);
  }
  console.log(`[brick-maestro] Storage: private MariaDB ${store.config.user}@localhost/${store.config.database} via ${store.config.socketPath}`);

  const scheduler = new DurableMaestro({
    store,
    universeId,
    queueUrl: QUEUE_URL,
    authToken: BRIDGE_AUTH_TOKEN,
    loggerUrl: LOGGER_URL || null,
    logDir: LOG_DIR,
  });
  try {
    const { results, retired } = await scheduler.materializeDeclared(declarations);
    for (const r of results) console.log(`[brick-maestro] Schedule ${r.scheduleId}: ${r.outcome} (revision ${r.revision.slice(0, 12)})`);
    for (const id of retired) console.warn(`[brick-maestro] Schedule ${id}: no longer declared, disabled (its history stays)`);
  } catch (err) {
    await store.close().catch(() => {});
    refuse(err.code || 'ERROR', err.message);
  }
  console.log(`[brick-maestro] Universe ${universeId}; occurrences go to the queue at ${QUEUE_URL}`);
  return scheduler;
}

/**
 * Today's in-memory behaviour, unchanged: DEV scaffolding only.
 */
async function startMemory() {
  const fs = await import('node:fs');
  const { MaestroScheduler } = await import('./index.js');
  const { createAgentRuntimeHandler } = await import('../pkg-agent-runtime/index.js');
  const { createQueueBeatHandler } = await import('./queue-beat.js');
  const { resolveContextPath, resolveCheckpointPath } = await import('./task-paths.js');

  console.warn('[brick-maestro] DEV scaffolding: MAESTRO_STORE=memory keeps schedules, timers and counters in memory. It never satisfies Rule 26.');

  // Two ways to spend a beat, and they are not equivalent.
  //
  // Through the queue (preferred): the maestro only says "now". The queue owns
  // dispatch, follows the run to its end, records the verdict and the cost. One
  // entry point, one ledger, one place that has to be right.
  //
  // Straight to the bridge (legacy): the maestro dispatches and reports a success
  // it never observed, and work then flows through two paths with no common
  // ledger. Kept for memory mode only; the queue supersedes it as soon as
  // MAESTRO_QUEUE_URL is set, and the durable store never takes this path.
  const beatHandler = QUEUE_URL
    ? createQueueBeatHandler({
      queueUrl: QUEUE_URL,
      authToken: BRIDGE_AUTH_TOKEN,
      loggerUrl: LOGGER_URL || null,
    })
    : BRIDGE_URL
      ? createAgentRuntimeHandler({
        bridgeBaseUrl: BRIDGE_URL,
        authToken: BRIDGE_AUTH_TOKEN,
        loggerUrl: LOGGER_URL || null,
      })
      : null;

  console.log(QUEUE_URL
    ? `[brick-maestro] Beats go through the queue at ${QUEUE_URL}`
    : '[brick-maestro] Beats go straight to the bridge — set MAESTRO_QUEUE_URL to route them through the queue');

  const scheduler = new MaestroScheduler({ service: 'brick-maestro', logDir: LOG_DIR, beatHandler });

  if (TASKS_FILE && fs.existsSync(TASKS_FILE)) {
    const tasksPath = path.isAbsolute(TASKS_FILE) ? TASKS_FILE : path.resolve(SHAPER_ROOT, TASKS_FILE);
    const scheduleDir = path.dirname(tasksPath);
    const raw = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    const tasks = Array.isArray(raw) ? raw : (raw.tasks || []);
    for (const task of tasks) {
      if (task.contextPath) {
        const resolved = resolveContextPath(task.contextPath, { scheduleDir, shaperRoot: SHAPER_ROOT });
        // A context file that cannot be found skips its beat for good. Say so at
        // boot, naming every place we looked, instead of letting the operator
        // discover it as a silent `context_unreadable` five minutes later.
        if (!resolved.found) {
          console.warn(`[brick-maestro] Task ${task.slug}: declared context "${task.contextPath}" not found — looked in ${resolved.tried.join(', ')}`);
        }
        task.contextPath = resolved.path;
      }
      task.checkpointPath = resolveCheckpointPath(task.checkpointPath, { scheduleDir });
      scheduler.registerTask(task);
    }
    console.log(`[brick-maestro] Loaded ${tasks.length} task(s)`);
  }
  return scheduler;
}

const scheduler = STORE === 'mariadb' ? await startDurable() : await startMemory();

const server = createMaestroServer({ port: PORT, host: HOST, scheduler });

if (AUTO_START && STORE === 'memory') scheduler.startScheduler();

server.on('listening', async () => {
  let taskCount = null;
  try {
    taskCount = (await scheduler.listRegisteredTasks()).length;
  } catch (err) {
    console.error(`[brick-maestro] cannot list tasks: ${err.code || err.name} — ${err.message}`);
  }
  console.log(`[brick-maestro] Ready — ${taskCount ?? 'unknown'} task(s), listening on http://${HOST}:${server.address().port}`);
  await ingestLog({
    loggerUrl: LOGGER_URL,
    pod: 'brick-maestro',
    event: 'MAESTRO_STARTED',
    data: { tasks: taskCount, autoStart: AUTO_START, store: STORE },
  });
  if (AUTO_START && STORE === 'mariadb') {
    // The first tick reconciles every unsettled occurrence before any new wait.
    const summary = await scheduler.startScheduler();
    console.log(`[brick-maestro] Scheduler started; first tick ${JSON.stringify(summary)}`);
  }
});

function shutdown(signal) {
  console.log(`[brick-maestro] Received ${signal}, shutting down...`);
  scheduler.stopScheduler();
  server.close(async () => {
    if (typeof scheduler.close === 'function') await scheduler.close().catch(() => {});
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
