#!/usr/bin/env node
import { createAgyBridgeServer, resolveAgyModel, AGY_MODEL_ENV, AGY_MODEL_ENV_ALT } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.AGY_BRIDGE_PORT || '4330', 10);
const HOST = process.env.HOST || process.env.AGY_BRIDGE_BIND || '0.0.0.0';
const STUB = process.env.BRIDGE_AGY_STUB === '1';
const MODEL = resolveAgyModel(process.env);

// Rule 0J: a missing configuration halts and says what to provide. This
// start-up used to let the library fall back to a hardcoded model, so the
// bridge ran on a name nobody had measured and answered healthy on it.
if (!STUB && !MODEL) {
  console.error(`[bridge-agy] HALT: ${AGY_MODEL_ENV} (or ${AGY_MODEL_ENV_ALT}) is not set and this bridge names no default model (Rule 7).`);
  console.error(`[bridge-agy] Measure the engines reachable from this host, pick one, and export ${AGY_MODEL_ENV}=<model id> — or set BRIDGE_AGY_STUB=1 for the simulated bridge.`);
  process.exit(2);
}

console.log(`[bridge-agy] Starting on ${HOST}:${PORT} (model=${MODEL || '(stub — no model)'} stub=${STUB})`);
createAgyBridgeServer({ port: PORT, bind: HOST, defaultModel: MODEL, workspaceBase: process.env.AGY_WS_BASE || '/tmp/agy-workspaces' });
