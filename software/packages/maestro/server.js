#!/usr/bin/env node
/**
 * @package @shaper/maestro
 * Daemon — loads tasks from MAESTRO_TASKS_FILE, logs all beats via @shaper/logger.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MaestroScheduler, createMaestroServer } from './index.js';
import { createAgentBeatHandler } from '../agent/index.js';
import { createQueueBeatHandler } from './queue-beat.js';
import { VaultClient } from '../vault/index.js';
import { ingestLog } from '../logger/ingest-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHAPER_ROOT = path.resolve(__dirname, '../..');

const PORT = parseInt(process.env.PORT || process.env.MAESTRO_PORT || '8530', 10);
const HOST = process.env.HOST || process.env.MAESTRO_HOST || '0.0.0.0';
const LOG_DIR = process.env.LOG_DIR || '/data/maestro-v1/log';
const TASKS_FILE = process.env.MAESTRO_TASKS_FILE || '';
const BRIDGE_URL = process.env.MAESTRO_BRIDGE_URL || '';
const QUEUE_URL = process.env.MAESTRO_QUEUE_URL || '';
const VAULT_URL = process.env.VAULT_URL || '';
const VAULT_TOKEN = process.env.VAULT_TOKEN || '';
const LOGGER_URL = process.env.LOGGER_URL || '';
const BRIDGE_AUTH_TOKEN = process.env.BRIDGE_AUTH_TOKEN || '';
const CHECKPOINT_PATH = process.env.UNIV7_CHECKPOINT || process.env.CHECKPOINT_PATH || '';
const AUTO_START = process.env.MAESTRO_AUTO_START === '1';

console.log(`[maestro-v1] Starting on ${HOST}:${PORT}...`);

const vaultClient = VAULT_URL
  ? new VaultClient({ vaultUrl: VAULT_URL, vaultToken: VAULT_TOKEN || undefined })
  : null;

// Two ways to spend a beat, and they are not equivalent.
//
// Through the queue (preferred): the maestro only says "now". The queue owns
// dispatch, follows the run to its end, records the verdict and the cost. One
// entry point, one ledger, one place that has to be right.
//
// Straight to the bridge (legacy): the maestro dispatches and reports a success
// it never observed, and work then flows through two paths with no common
// ledger. Kept because live pods still run this way; the queue supersedes it as
// soon as MAESTRO_QUEUE_URL is set.
const beatHandler = QUEUE_URL
  ? createQueueBeatHandler({
    queueUrl: QUEUE_URL,
    authToken: BRIDGE_AUTH_TOKEN,
    loggerUrl: LOGGER_URL || null,
  })
  : BRIDGE_URL
    ? createAgentBeatHandler({
      bridgeBaseUrl: BRIDGE_URL,
      authToken: BRIDGE_AUTH_TOKEN,
      vaultClient,
      loggerUrl: LOGGER_URL || null,
      checkpointPath: CHECKPOINT_PATH || null,
      mailStubMode: process.env.MAIL_AGENT_STUB !== '0',
    })
    : null;

console.log(QUEUE_URL
  ? `[maestro-v1] Beats go through the queue at ${QUEUE_URL}`
  : '[maestro-v1] Beats go straight to the bridge — set MAESTRO_QUEUE_URL to route them through the queue');

const scheduler = new MaestroScheduler({ pod: 'maestro-v1', logDir: LOG_DIR, beatHandler });

if (TASKS_FILE && fs.existsSync(TASKS_FILE)) {
  const tasksPath = path.isAbsolute(TASKS_FILE) ? TASKS_FILE : path.resolve(SHAPER_ROOT, TASKS_FILE);
  const tasksBaseDir = path.dirname(path.dirname(tasksPath));
  const raw = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
  const tasks = Array.isArray(raw) ? raw : (raw.tasks || []);
  for (const task of tasks) {
    if (task.contextPath && !path.isAbsolute(task.contextPath)) {
      const candidate = path.resolve(tasksBaseDir, task.contextPath);
      task.contextPath = fs.existsSync(candidate) ? candidate : path.resolve(SHAPER_ROOT, task.contextPath);
    }
    if (task.checkpointPath && !path.isAbsolute(task.checkpointPath)) {
      task.checkpointPath = path.resolve(tasksBaseDir, task.checkpointPath);
    }
    scheduler.registerAgentTask(task);
  }
  console.log(`[maestro-v1] Loaded ${tasks.length} task(s)`);
}

const server = createMaestroServer({ port: PORT, host: HOST, scheduler });

if (AUTO_START) scheduler.startScheduler();

server.on('listening', async () => {
  console.log(`[maestro-v1] Ready — ${scheduler.listRegisteredPods().length} task(s)`);
  await ingestLog({
    loggerUrl: LOGGER_URL,
    pod: 'maestro',
    event: 'MAESTRO_STARTED',
    data: { tasks: scheduler.listRegisteredPods().length, autoStart: AUTO_START },
  });
});

process.on('SIGTERM', () => { scheduler.stopScheduler(); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { scheduler.stopScheduler(); server.close(() => process.exit(0)); });
