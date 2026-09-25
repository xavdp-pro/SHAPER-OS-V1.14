#!/usr/bin/env node
import { createMuseBridgeServer, resolveMuseModel, MUSE_MODEL_ENV } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.MUSE_BRIDGE_PORT || '4320', 10);
const HOST = process.env.HOST || process.env.MUSE_BRIDGE_BIND || '0.0.0.0';
const STUB = process.env.BRIDGE_MUSE_STUB === '1';
const MODEL = resolveMuseModel(process.env);

if (!STUB && !MODEL) {
  console.error(`[bridge-muse] HALT: ${MUSE_MODEL_ENV} is not set and this bridge names no default model (Rule 7).`);
  console.error(`[bridge-muse] Measure the engines reachable from this host, pick one, and export ${MUSE_MODEL_ENV}=<model id> — or set BRIDGE_MUSE_STUB=1 for the simulated bridge.`);
  process.exit(2);
}

console.log(`[bridge-muse] Starting on ${HOST}:${PORT} (model=${MODEL || '(stub — no model)'} stub=${STUB})`);
createMuseBridgeServer({
  port: PORT,
  bind: HOST,
  defaultModel: MODEL,
  workspaceBase: process.env.MUSE_WS_BASE || '/tmp/muse-workspaces',
});
