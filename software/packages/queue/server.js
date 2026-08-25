#!/usr/bin/env node
/**
 * @package @shaper/queue
 * HTTP job queue + optional auto-dispatch worker (QUEUE_AUTO_DISPATCH=1).
 */
import { createQueueServer } from './index.js';
import { startQueueAgentWorker } from './worker.js';

const PORT = parseInt(process.env.PORT || process.env.QUEUE_PORT || '8540', 10);
const HOST = process.env.HOST || process.env.QUEUE_HOST || '0.0.0.0';
const AUTO = process.env.QUEUE_AUTO_DISPATCH === '1';

console.log(`[queue-v1] Starting Job Queue Gateway on ${HOST}:${PORT}...`);

const server = createQueueServer({ port: PORT, host: HOST });
let worker = null;

server.on('listening', () => {
  console.log(`[queue-v1] Ready and listening on http://${HOST}:${PORT}`);
  if (AUTO) {
    worker = startQueueAgentWorker({
      queue: server.jobQueue,
      bridgeUrl: process.env.QUEUE_BRIDGE_URL || 'http://127.0.0.1:4340',
      bridgeToken: process.env.QUEUE_BRIDGE_TOKEN || process.env.BRIDGE_AUTH_TOKEN || '',
      pollMs: Number(process.env.QUEUE_POLL_MS || 2000),
    });
  } else {
    console.log('[queue-v1] QUEUE_AUTO_DISPATCH off — jobs stay PENDING until a worker patches them');
  }
});

function shutdown() {
  if (worker) worker.stop();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
