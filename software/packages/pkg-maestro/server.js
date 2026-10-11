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
 * explicitly. Nothing ever falls back to it, and it is refused when a
 * promotion or qualification flag is set.
 *
 * On MariaDB every route but a minimal health requires a Vault-signed
 * credential for audience `maestro` (maestro:read, maestro:admin), and every
 * occurrence goes to Queue under Maestro's own `queue` credential
 * (queue:enqueue, queue:read).
 *
 * On MariaDB, every report is an outbox row committed with the change it
 * reports; one relay lane delivers them to Logger under a logger-audience
 * credential renewed from Vault. No local JSONL audit is written: LOG_DIR
 * serves the memory scaffolding only.
 *
 * Intent: software/packages/pkg-maestro/INTENT.md#private-mariadb
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMaestroServer } from './index.js';
import { ingestLog } from '../pkg-logger/ingest-client.js';
import { assertDisposableStoreAllowed } from '../pkg-db/index.js';
import { readSecret } from '../pkg-auth/secret-file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHAPER_ROOT = path.resolve(__dirname, '../..');

const PORT = parseInt(process.env.PORT || process.env.MAESTRO_PORT || '8630', 10);
const HOST = process.env.HOST || process.env.MAESTRO_HOST || '0.0.0.0';
const LOG_DIR = process.env.LOG_DIR || '/data/brick-maestro/log';
const TASKS_FILE = process.env.MAESTRO_TASKS_FILE || '';
const BRIDGE_URL = process.env.MAESTRO_BRIDGE_URL || '';
const QUEUE_URL = process.env.MAESTRO_QUEUE_URL || '';
const LOGGER_URL = process.env.LOGGER_URL || '';
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

// The bridge token of the memory-mode legacy path is a private file
// (BRIDGE_AUTH_TOKEN_FILE; SOL-DECISIONS-2 §M). An environment value is DEV
// scaffolding, refused on MariaDB.
let BRIDGE_AUTH_TOKEN = '';
try {
  BRIDGE_AUTH_TOKEN = readSecret(process.env, 'BRIDGE_AUTH_TOKEN', { allowEnvValue: STORE !== 'mariadb' }) || '';
} catch (err) {
  refuse(err.code, err.message);
}
if (STORE === 'memory') {
  try {
    assertDisposableStoreAllowed({ unit: 'maestro', store: 'memory' });
  } catch (err) {
    refuse(err.code, err.message);
  }
}
let relay = null;
let maintenance = null;
let authorizeRequest = null;
let queueCredentials = null;

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

  const slug = process.env.SHAPER_UNIT_SLUG || 'maestro';
  if (slug !== 'maestro') {
    // Evidence is sourced as `maestro`; Logger binds the source to the
    // authenticated unit and would refuse every row of a unit named otherwise.
    refuse('EVIDENCE_SOURCE_MISMATCH', `SHAPER_UNIT_SLUG is ${slug}; this Maestro sources its evidence as maestro`);
  }
  let store;
  try {
    store = await MariaDbMaestroStore.open({ slug });
    // Every change commits its evidence to the outbox; a Maestro that could
    // never deliver it would pile up debt in silence.
    if (!LOGGER_URL) {
      throw Object.assign(new Error('LOGGER_URL is required with MAESTRO_STORE=mariadb: committed evidence is owed to Logger'), { code: 'LOGGER_URL_MISSING' });
    }
    const { runtimeAuthorizer, runtimeCredentialClient } = await import('../pkg-auth/runtime-identity.js');
    // Every route but a minimal health answers a Vault-signed credential for
    // audience `maestro`, checked current at Vault; Maestro calls Queue under
    // its own `queue` credential (DECISIONS-20261011 §E).
    authorizeRequest = runtimeAuthorizer({ ...process.env, SHAPER_UNIT_SLUG: slug });
    const identityClient = runtimeCredentialClient({ ...process.env, SHAPER_UNIT_SLUG: slug });
    queueCredentials = () => identityClient.headers('queue');
    const { createEvidenceRelay } = await import('../pkg-db/outbox.js');
    const { deliverLog } = await import('../pkg-logger/ingest-client.js');
    relay = createEvidenceRelay({
      pool: store.pool,
      credentials: () => identityClient.headers('logger'),
      deliver: (entry, signal, headers) => deliverLog({ loggerUrl: LOGGER_URL, entry, signal, headers }),
      report: (event) => console.warn(`[brick-maestro] ${JSON.stringify(event)}`),
      intervalMs: process.env.MAESTRO_RELAY_INTERVAL_MS,
      maxEvents: process.env.MAESTRO_RELAY_BATCH,
      timeoutMs: process.env.MAESTRO_RELAY_TIMEOUT_MS,
      shutdownMs: process.env.MAESTRO_SHUTDOWN_TIMEOUT_MS,
    });
    // The declared cleanup class (manifest dataLifecycle): delivered evidence
    // over 30 days, under a recovery point. Schedules and occurrences are kept.
    const { createMaintenanceLane, pruneDeliveredOutbox } = await import('../pkg-db/outbox.js');
    maintenance = createMaintenanceLane({
      jobs: { outbox: () => pruneDeliveredOutbox(store.pool) },
      report: (event) => console.log(`[brick-maestro] ${JSON.stringify(event)}`),
    });
  } catch (err) {
    if (store) await store.close().catch(() => {});
    refuse(err.code || 'ERROR', err.message);
  }
  console.log(`[brick-maestro] Storage: private MariaDB ${store.config.user}@localhost/${store.config.database} via ${store.config.socketPath}`);

  const scheduler = new DurableMaestro({
    store,
    universeId,
    queueUrl: QUEUE_URL,
    credentials: queueCredentials,
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

const server = createMaestroServer({ port: PORT, host: HOST, scheduler, authorizeRequest });

if (AUTO_START && STORE === 'memory') scheduler.startScheduler();

server.on('listening', async () => {
  let taskCount = null;
  try {
    taskCount = (await scheduler.listRegisteredTasks()).length;
  } catch (err) {
    console.error(`[brick-maestro] cannot list tasks: ${err.code || err.name} — ${err.message}`);
  }
  console.log(`[brick-maestro] Ready — ${taskCount ?? 'unknown'} task(s), listening on http://${HOST}:${server.address().port}`);
  if (STORE === 'mariadb') {
    await scheduler.recordEvidence('MAESTRO_STARTED', { tasks: taskCount, autoStart: AUTO_START, store: STORE });
    relay?.start();
    maintenance?.start();
  } else {
    // DEV scaffolding keeps its best-effort line; nothing durable is claimed.
    await ingestLog({
      loggerUrl: LOGGER_URL,
      pod: 'brick-maestro',
      event: 'MAESTRO_STARTED',
      data: { tasks: taskCount, autoStart: AUTO_START, store: STORE },
    });
  }
  if (AUTO_START && STORE === 'mariadb') {
    // The first tick reconciles every unsettled occurrence before any new wait.
    const summary = await scheduler.startScheduler();
    console.log(`[brick-maestro] Scheduler started; first tick ${JSON.stringify(summary)}`);
  }
});

/**
 * Stops accepting connections, lets requests in flight finish, then ends what
 * is still open — an event stream never ends by itself — after a short grace.
 */
function closeServer(server, graceMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => server.closeAllConnections?.(), graceMs);
    timer.unref?.();
    server.close(() => { clearTimeout(timer); resolve(); });
    server.closeIdleConnections?.();
  });
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[brick-maestro] Received ${signal}, shutting down...`);
  scheduler.stopScheduler();
  let code = 0;
  await closeServer(server);
  if (STORE === 'mariadb') {
    // No new evidence after the scheduler has drained; then the relay settles
    // the batch in flight; the database closes last.
    await scheduler.drain().catch(() => {});
    await maintenance?.close();
    try {
      await relay?.close();
    } catch (err) {
      console.error(`[brick-maestro] ${err.code || 'SHUTDOWN_UNCONFIRMED'}: evidence delivery in flight not confirmed; the debt is retained`);
      code = 1;
    }
    await scheduler.store.close().catch(() => {});
  } else if (typeof scheduler.close === 'function') {
    await scheduler.close().catch(() => {});
  }
  process.exit(code);
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
