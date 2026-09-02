#!/usr/bin/env node
/**
 * @file server.js
 * @package @shaper/pkg-logger
 * @description Standalone container entrypoint for the JSONL audit log collector gateway.
 */

import { createLoggerServer } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.LOGGER_PORT || '8620', 10);
const HOST = process.env.HOST || process.env.LOGGER_HOST || '0.0.0.0';
const LOG_DIR = process.env.LOG_DIR || '/data/logger';

console.log(`[brick-logger] Starting Log Collector on ${HOST}:${PORT}...`);
console.log(`[brick-logger] Storage: ${LOG_DIR}`);

const server = createLoggerServer({ port: PORT, host: HOST, logDir: LOG_DIR });

server.on('listening', () => {
  console.log(`[brick-logger] Ready and listening on http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[brick-logger] Received SIGTERM, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[brick-logger] Received SIGINT, shutting down...');
  server.close(() => process.exit(0));
});
