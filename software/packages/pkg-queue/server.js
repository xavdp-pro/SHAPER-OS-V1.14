#!/usr/bin/env node
/**
 * @package @shaper/pkg-queue
 * HTTP job queue + optional auto-dispatch worker (QUEUE_AUTO_DISPATCH=1).
 *
 * Storage is the unit's private MariaDB (Rules 4 and 26). The memory and JSONL
 * stores remain only as declared DEV scaffolding, chosen explicitly with
 * QUEUE_STORE=memory or QUEUE_STORE=file; nothing falls back to them, and
 * neither is accepted when a promotion or qualification flag is set.
 *
 * On MariaDB every route but a minimal health requires a Vault-signed
 * credential for audience `queue` and the route's scope (queue:enqueue,
 * queue:read, queue:claim, queue:attempt): 401 absent or invalid, 403
 * audience, scope or revocation, 503 when Vault cannot confirm it.
 *
 * Lifecycle: open the store → settle every job left RUNNING as interrupted
 * (whatever the worker setting) → listen → start the evidence relay and, if
 * asked, the worker. Stop: worker, relay drain, server, database.
 *
 * Intent: software/packages/pkg-queue/INTENT.md#lifecycle
 */
import { JobQueue, createQueueServer } from './index.js';
import { startQueueAgentWorker } from './worker.js';
import { assertDisposableStoreAllowed } from '../pkg-db/index.js';

const PORT = parseInt(process.env.PORT || process.env.QUEUE_PORT || '8640', 10);
const HOST = process.env.HOST || process.env.QUEUE_HOST || '0.0.0.0';
const AUTO = process.env.QUEUE_AUTO_DISPATCH === '1';
const STORE = (process.env.QUEUE_STORE || 'mariadb').trim();

function refuse(err) {
  console.error(`[brick-queue] refusing to start: ${err.code || 'ERROR'} — ${err.message}`);
  process.exit(1);
}

const storeOptions = {
  // Off by default: the gate is opt-in during build-out, enabled per universe
  // via QUALITY_GATE_ENFORCE=1 once its deliverable contracts are declared.
  enforceQualityGate: process.env.QUALITY_GATE_ENFORCE === '1',
  gedRoot: process.env.GED_ROOT || null,
  loggerUrl: process.env.LOGGER_URL || null,
};

let queue;
let relay = null;
let maintenance = null;
let authorizeRequest = null;
if (STORE === 'mariadb') {
  const { MariaDbJobQueue } = await import('./mariadb-store.js');
  const slug = process.env.SHAPER_UNIT_SLUG || 'queue';
  if (slug !== 'queue') {
    // Evidence is sourced as `queue`; Logger binds the source to the
    // authenticated unit and would refuse every row of a unit named otherwise.
    refuse(Object.assign(new Error(`SHAPER_UNIT_SLUG is ${slug}; this Queue sources its evidence as queue`), { code: 'EVIDENCE_SOURCE_MISMATCH' }));
  }
  try {
    queue = await MariaDbJobQueue.open({ slug, ...storeOptions });
    // Every transition commits its evidence to the outbox; a Queue that could
    // never deliver it would pile up debt in silence.
    if (!storeOptions.loggerUrl) {
      throw Object.assign(new Error('LOGGER_URL is required with QUEUE_STORE=mariadb: committed evidence is owed to Logger'), { code: 'LOGGER_URL_MISSING' });
    }
    const { runtimeAuthorizer, runtimeCredentialClient } = await import('../pkg-auth/runtime-identity.js');
    // Every route but a minimal health answers a Vault-signed credential for
    // audience `queue`, checked current at Vault (DECISIONS-20261011 §E).
    authorizeRequest = runtimeAuthorizer({ ...process.env, SHAPER_UNIT_SLUG: slug });
    const identityClient = runtimeCredentialClient({ ...process.env, SHAPER_UNIT_SLUG: slug });
    const { createEvidenceRelay } = await import('../pkg-db/outbox.js');
    const { deliverLog } = await import('../pkg-logger/ingest-client.js');
    relay = createEvidenceRelay({
      pool: queue.pool,
      credentials: () => identityClient.headers('logger'),
      deliver: (entry, signal, headers) => deliverLog({ loggerUrl: storeOptions.loggerUrl, entry, signal, headers }),
      report: (event) => console.warn(`[brick-queue] ${JSON.stringify(event)}`),
      intervalMs: process.env.QUEUE_RELAY_INTERVAL_MS,
      maxEvents: process.env.QUEUE_RELAY_BATCH,
      timeoutMs: process.env.QUEUE_RELAY_TIMEOUT_MS,
      shutdownMs: process.env.QUEUE_SHUTDOWN_TIMEOUT_MS,
    });
    // The declared cleanup class (manifest dataLifecycle): delivered evidence
    // over 30 days, under a recovery point. Jobs and their history are kept.
    const { createMaintenanceLane, pruneDeliveredOutbox } = await import('../pkg-db/outbox.js');
    maintenance = createMaintenanceLane({
      jobs: { outbox: () => pruneDeliveredOutbox(queue.pool) },
      report: (event) => console.log(`[brick-queue] ${JSON.stringify(event)}`),
    });
  } catch (err) {
    if (queue) await queue.close().catch(() => {});
    refuse(err);
  }
  const { jobs, byStatus } = queue.hydrated;
  const states = Object.entries(byStatus).map(([s, n]) => `${s} ${n}`).join(', ') || 'none';
  console.log(`[brick-queue] Storage: private MariaDB ${queue.config.user}@localhost/${queue.config.database} via ${queue.config.socketPath} (schema v${queue.schemaVersion}; ${jobs} job(s) read back: ${states})`);
  if (process.env.QUEUE_STORAGE_FILE) {
    console.warn(`[brick-queue] QUEUE_STORAGE_FILE=${process.env.QUEUE_STORAGE_FILE} is ignored: the store is MariaDB`);
  }
} else if (STORE === 'file') {
  try {
    assertDisposableStoreAllowed({ unit: 'queue', store: 'file' });
  } catch (err) {
    refuse(err);
  }
  const storageFile = process.env.QUEUE_STORAGE_FILE;
  if (!storageFile) {
    console.error('[brick-queue] QUEUE_STORE=file needs an explicit QUEUE_STORAGE_FILE');
    process.exit(1);
  }
  queue = new JobQueue({ storageFile, ...storeOptions });
  console.warn(`[brick-queue] DEV scaffolding: JSONL file store ${storageFile}. It never satisfies Rule 26.`);
} else if (STORE === 'memory') {
  try {
    assertDisposableStoreAllowed({ unit: 'queue', store: 'memory' });
  } catch (err) {
    refuse(err);
  }
  queue = new JobQueue(storeOptions);
  console.warn('[brick-queue] DEV scaffolding: in-memory store — every job is lost when this process ends. It never satisfies Rule 26.');
} else {
  console.error(`[brick-queue] QUEUE_STORE must be "mariadb", "file" or "memory"; got "${STORE}"`);
  process.exit(1);
}

// Restart recovery belongs to the service, not to the optional worker: a job
// left RUNNING by the previous process is settled before anything is served.
try {
  const settled = await queue.recoverInterrupted();
  if (settled.length) {
    console.warn(`[brick-queue] ${settled.length} job(s) found RUNNING at start settled FAILED as interrupted (outcome unknown, not replayed): ${settled.map((j) => j.id).join(', ')}`);
  }
} catch (err) {
  if (typeof queue.close === 'function') await queue.close().catch(() => {});
  refuse(err);
}

console.log(`[brick-queue] Starting Job Queue Gateway on ${HOST}:${PORT}...`);

const server = createQueueServer({ port: PORT, host: HOST, queue, authorizeRequest });
let worker = null;

server.on('listening', () => {
  console.log(`[brick-queue] Ready and listening on http://${HOST}:${server.address().port}`);
  relay?.start();
  maintenance?.start();
  if (AUTO) {
    worker = startQueueAgentWorker({
      queue: server.jobQueue,
      bridgeUrl: process.env.QUEUE_BRIDGE_URL || 'http://127.0.0.1:4440',
      bridgeToken: process.env.QUEUE_BRIDGE_TOKEN || process.env.BRIDGE_AUTH_TOKEN || '',
      pollMs: Number(process.env.QUEUE_POLL_MS || 2000),
    });
  } else {
    console.log('[brick-queue] QUEUE_AUTO_DISPATCH off — jobs stay PENDING until a worker patches them');
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
  console.log(`[brick-queue] Received ${signal}, shutting down...`);
  if (worker) worker.stop();
  let code = 0;
  // All settle before the database closes, whichever finishes first.
  const [, relayed] = await Promise.allSettled([closeServer(server), relay ? relay.close() : Promise.resolve(),
    maintenance ? maintenance.close() : Promise.resolve()]);
  if (relayed.status === 'rejected') {
    // The batch in flight did not settle in time: its debt stays in MariaDB.
    console.error(`[brick-queue] ${relayed.reason?.code || 'SHUTDOWN_UNCONFIRMED'}: evidence delivery in flight not confirmed; the debt is retained`);
    code = 1;
  }
  if (typeof queue.close === 'function') await queue.close().catch(() => {});
  process.exit(code);
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
