#!/usr/bin/env node
/**
 * @file server.js
 * @package @shaper/pkg-logger
 * @description Standalone / container entrypoint for the Logger unit.
 *
 * Storage is the unit's private MariaDB (Rules 4 and 26). The JSONL collector
 * remains only as declared DEV scaffolding, chosen explicitly with
 * LOGGER_STORE=file and an explicit LOG_DIR; nothing falls back to it, and it
 * is refused when a promotion or qualification flag is set.
 *
 * Intent: software/packages/pkg-logger/INTENT.md#private-mariadb
 */

import { createLoggerServer, resolveLimits } from './index.js';
import { assertDisposableStoreAllowed } from '../pkg-db/index.js';

const PORT = parseInt(process.env.PORT || process.env.LOGGER_PORT || '8620', 10);
const HOST = process.env.HOST || process.env.LOGGER_HOST || '0.0.0.0';
const STORE = (process.env.LOGGER_STORE || 'mariadb').trim();

function refuse(err) {
  console.error(`[brick-logger] refusing to start: ${err.code || 'ERROR'} — ${err.message}`);
  process.exit(1);
}

let limits;
try {
  limits = resolveLimits(process.env);
} catch (err) {
  refuse(err);
}

let store = null;
let authorizeRequest = null;
let logDir = null;
if (STORE === 'mariadb') {
  const { MariaDbLoggerStore } = await import('./mariadb-store.js');
  const slug = process.env.SHAPER_UNIT_SLUG || 'logger';
  try {
    store = await MariaDbLoggerStore.open({ slug, limits });
    const { runtimeAuthorizer } = await import('../pkg-auth/runtime-identity.js');
    authorizeRequest = runtimeAuthorizer({ ...process.env, SHAPER_UNIT_SLUG: slug });
  } catch (err) {
    refuse(err);
  }
  console.log(`[brick-logger] Storage: private MariaDB ${store.config.user}@localhost/${store.config.database} via ${store.config.socketPath} (schema ${store.schemaVersion})`);
} else if (STORE === 'file') {
  try {
    assertDisposableStoreAllowed({ unit: 'logger', store: 'file' });
  } catch (err) {
    refuse(err);
  }
  logDir = process.env.LOG_DIR;
  if (!logDir) {
    console.error('[brick-logger] LOGGER_STORE=file needs an explicit LOG_DIR');
    process.exit(1);
  }
  console.warn(`[brick-logger] DEV scaffolding: JSONL files under ${logDir}. They never satisfy Rules 4 and 26.`);
} else {
  console.error(`[brick-logger] LOGGER_STORE must be "mariadb" or "file"; got "${STORE}"`);
  process.exit(1);
}

console.log(`[brick-logger] Starting Log Collector on ${HOST}:${PORT}...`);
console.log(`[brick-logger] Limits: body ${limits.maxBodyBytes} B, event data ${limits.maxEventBytes} B, batch ${limits.maxBatch}`);

const server = createLoggerServer({ port: PORT, host: HOST, logDir, store, limits, authorizeRequest });

server.on('listening', () => {
  console.log(`[brick-logger] Ready and listening on http://${HOST}:${server.address().port}`);
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
  console.log(`[brick-logger] Received ${signal}, shutting down...`);
  await closeServer(server);
  if (store) await store.close().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
