#!/usr/bin/env node
import { createCursorBridgeServer, resolveCursorModel, CURSOR_MODEL_ENV } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.CURSOR_BRIDGE_PORT || '4310', 10);
const HOST = process.env.HOST || process.env.CURSOR_BRIDGE_BIND || '0.0.0.0';
const MODE = process.env.CURSOR_MODE || 'normal';
const STUB = process.env.BRIDGE_CURSOR_STUB === '1';
const MODEL = resolveCursorModel(process.env);

// Rule 0J: a missing configuration halts and says what to provide. This
// start-up used to print a hardcoded model name and run on it whatever the
// environment said; a bridge that answers healthy on an expired default is
// worse than one that refuses to start.
if (!STUB && !MODEL) {
  console.error(`[bridge-cursor] HALT: ${CURSOR_MODEL_ENV} is not set and this bridge names no default model (Rule 7).`);
  console.error(`[bridge-cursor] Measure the engines reachable from this host, pick one, and export ${CURSOR_MODEL_ENV}=<model id> — or set BRIDGE_CURSOR_STUB=1 for the simulated bridge.`);
  process.exit(2);
}

console.log(`[bridge-cursor] Starting on ${HOST}:${PORT} (model=${MODEL || '(stub — no model)'} mode=${MODE} stub=${STUB})`);
createCursorBridgeServer({
  port: PORT,
  bind: HOST,
  model: MODEL,
  mode: MODE,
  workspaceBase: process.env.CURSOR_WS_BASE || '/tmp/cursor-workspaces',
});
