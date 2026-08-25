#!/usr/bin/env node
import { createDeepseekBridgeServer } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.DEEPSEEK_BRIDGE_PORT || '4350', 10);
const HOST = process.env.HOST || process.env.DEEPSEEK_BRIDGE_BIND || '0.0.0.0';
const MODEL = process.env.OLLAMA_MODEL || process.env.DEEPSEEK_MODEL || 'nemotron-3-nano:30b';

console.log(`[bridge-deepseek] Starting on ${HOST}:${PORT} (model=${MODEL} stub=${process.env.BRIDGE_DEEPSEEK_STUB === '1'})`);
createDeepseekBridgeServer({
  port: PORT,
  bind: HOST,
  model: MODEL,
  workspaceBase: process.env.DEEPSEEK_WS_BASE || '/tmp/deepseek-workspaces',
});
