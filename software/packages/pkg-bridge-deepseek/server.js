#!/usr/bin/env node
import { createDeepseekBridgeServer, resolveDeepseekModel, DEEPSEEK_MODEL_ENV, DEEPSEEK_MODEL_ENV_ALT } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.DEEPSEEK_BRIDGE_PORT || '4350', 10);
const HOST = process.env.HOST || process.env.DEEPSEEK_BRIDGE_BIND || '0.0.0.0';
const STUB = process.env.BRIDGE_DEEPSEEK_STUB === '1';
const MODEL = resolveDeepseekModel(process.env);

// Rule 0J: a missing configuration halts and says what to provide. This
// start-up used to fall back to a hardcoded model — a different one from the
// package's own default — so the bridge ran on a name nobody had measured.
if (!STUB && !MODEL) {
  console.error(`[bridge-deepseek] HALT: ${DEEPSEEK_MODEL_ENV} (or ${DEEPSEEK_MODEL_ENV_ALT}) is not set and this bridge names no default model (Rule 7).`);
  console.error(`[bridge-deepseek] Measure the engines reachable from this host, pick one, and export ${DEEPSEEK_MODEL_ENV}=<model id> — or set BRIDGE_DEEPSEEK_STUB=1 for the simulated bridge.`);
  process.exit(2);
}

console.log(`[bridge-deepseek] Starting on ${HOST}:${PORT} (model=${MODEL || '(stub — no model)'} stub=${STUB})`);
createDeepseekBridgeServer({
  port: PORT,
  bind: HOST,
  model: MODEL,
  workspaceBase: process.env.DEEPSEEK_WS_BASE || '/tmp/deepseek-workspaces',
});
