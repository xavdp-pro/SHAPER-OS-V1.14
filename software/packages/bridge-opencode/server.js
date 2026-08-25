#!/usr/bin/env node
import { createOpencodeBridgeServer } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.OPENCODE_BRIDGE_PORT || '4340', 10);
const HOST = process.env.HOST || process.env.OPENCODE_BRIDGE_BIND || '0.0.0.0';

console.log(`[bridge-opencode] Starting on ${HOST}:${PORT} (stub=${process.env.BRIDGE_OPENCODE_STUB === '1'} model=${process.env.OPENCODE_MODEL || 'opencode/nemotron-3.5-lightning-free'})`);
createOpencodeBridgeServer({
  port: PORT,
  bind: HOST,
  workspaceBase: process.env.OPENCODE_WS_BASE || '/tmp/opencode-workspaces',
});
