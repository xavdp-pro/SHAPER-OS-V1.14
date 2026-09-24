#!/usr/bin/env node
/**
 * @package @shaper/pkg-queue
 * HTTP job queue + optional auto-dispatch worker (QUEUE_AUTO_DISPATCH=1).
 *
 * Storage is the unit's private MariaDB (Rules 4 and 26). The memory and JSONL
 * stores remain only as declared DEV scaffolding, chosen explicitly with
 * QUEUE_STORE=memory or QUEUE_STORE=file; nothing falls back to them.
 */
import { JobQueue, createQueueServer } from './index.js';
import { startQueueAgentWorker } from './worker.js';

const PORT = parseInt(process.env.PORT || process.env.QUEUE_PORT || '8640', 10);
const HOST = process.env.HOST || process.env.QUEUE_HOST || '0.0.0.0';
const AUTO = process.env.QUEUE_AUTO_DISPATCH === '1';
const STORE = (process.env.QUEUE_STORE || 'mariadb').trim();

const storeOptions = {
  // Off by default: the gate is opt-in during build-out, enabled per universe
  // via QUALITY_GATE_ENFORCE=1 once its deliverable contracts are declared.
  enforceQualityGate: process.env.QUALITY_GATE_ENFORCE === '1',
  gedRoot: process.env.GED_ROOT || null,
  loggerUrl: process.env.LOGGER_URL || null,
};

let queue;
if (STORE === 'mariadb') {
  const { MariaDbJobQueue } = await import('./mariadb-store.js');
  const slug = process.env.SHAPER_UNIT_SLUG || 'queue';
  try {
    queue = await MariaDbJobQueue.open({ slug, ...storeOptions });
  } catch (err) {
    console.error(`[brick-queue] refusing to start: ${err.code || 'ERROR'} — ${err.message}`);
    process.exit(1);
  }
  const { jobs, byStatus } = queue.hydrated;
  const states = Object.entries(byStatus).map(([s, n]) => `${s} ${n}`).join(', ') || 'none';
  console.log(`[brick-queue] Storage: private MariaDB ${queue.config.user}@localhost/${queue.config.database} via ${queue.config.socketPath} (schema v${queue.schemaVersion}; ${jobs} job(s) read back: ${states})`);
  if (process.env.QUEUE_STORAGE_FILE) {
    console.warn(`[brick-queue] QUEUE_STORAGE_FILE=${process.env.QUEUE_STORAGE_FILE} is ignored: the store is MariaDB`);
  }
} else if (STORE === 'file') {
  const storageFile = process.env.QUEUE_STORAGE_FILE;
  if (!storageFile) {
    console.error('[brick-queue] QUEUE_STORE=file needs an explicit QUEUE_STORAGE_FILE');
    process.exit(1);
  }
  queue = new JobQueue({ storageFile, ...storeOptions });
  console.warn(`[brick-queue] DEV scaffolding: JSONL file store ${storageFile}. It never satisfies Rule 26.`);
} else if (STORE === 'memory') {
  queue = new JobQueue(storeOptions);
  console.warn('[brick-queue] DEV scaffolding: in-memory store — every job is lost when this process ends. It never satisfies Rule 26.');
} else {
  console.error(`[brick-queue] QUEUE_STORE must be "mariadb", "file" or "memory"; got "${STORE}"`);
  process.exit(1);
}

console.log(`[brick-queue] Starting Job Queue Gateway on ${HOST}:${PORT}...`);

const server = createQueueServer({ port: PORT, host: HOST, queue });
let worker = null;

server.on('listening', () => {
  console.log(`[brick-queue] Ready and listening on http://${HOST}:${PORT}`);
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

function shutdown() {
  if (worker) worker.stop();
  server.close(async () => {
    if (typeof queue.close === 'function') await queue.close().catch(() => {});
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
