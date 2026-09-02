#!/usr/bin/env node
import { createOpencodeBridgeServer, resolveOpencodeModel, OPENCODE_MODEL_ENV } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.OPENCODE_BRIDGE_PORT || '4440', 10);
const HOST = process.env.HOST || process.env.OPENCODE_BRIDGE_BIND || '0.0.0.0';
const STUB = process.env.BRIDGE_OPENCODE_STUB === '1';
const MODEL = resolveOpencodeModel(process.env);

// Rule 0J: a missing configuration halts and says what to provide. This
// start-up used to log "(not set — measure it)" and then start anyway, which
// is a warning where the law asks for a halt.
if (!STUB && !MODEL) {
  console.error(`[bridge-opencode] HALT: ${OPENCODE_MODEL_ENV} is not set and this bridge names no default model (Rule 7).`);
  console.error(`[bridge-opencode] Measure the engines reachable from this host, pick one, and export ${OPENCODE_MODEL_ENV}=<model id> — or set BRIDGE_OPENCODE_STUB=1 for the simulated bridge.`);
  process.exit(2);
}

console.log(`[bridge-opencode] Starting on ${HOST}:${PORT} (stub=${STUB} model=${MODEL || '(stub — no model)'})`);
createOpencodeBridgeServer({
  port: PORT,
  bind: HOST,
  defaultModel: MODEL,
  workspaceBase: process.env.OPENCODE_WS_BASE || '/tmp/opencode-workspaces',
});
