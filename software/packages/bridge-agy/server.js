#!/usr/bin/env node
import { createAgyBridgeServer } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.AGY_BRIDGE_PORT || '4330', 10);
const HOST = process.env.HOST || process.env.AGY_BRIDGE_BIND || '0.0.0.0';

console.log(`[bridge-agy] Starting on ${HOST}:${PORT} (stub=${process.env.BRIDGE_AGY_STUB === '1'})`);
createAgyBridgeServer({ port: PORT, bind: HOST, workspaceBase: process.env.AGY_WS_BASE || '/tmp/agy-workspaces' });
