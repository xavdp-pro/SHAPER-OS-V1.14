#!/usr/bin/env node
import { createCursorBridgeServer } from './index.js';

const PORT = parseInt(process.env.PORT || process.env.CURSOR_BRIDGE_PORT || '4310', 10);
const HOST = process.env.HOST || process.env.CURSOR_BRIDGE_BIND || '0.0.0.0';
const MODE = process.env.CURSOR_MODE || 'normal';

console.log(`[bridge-cursor] Starting on ${HOST}:${PORT} (model=composer-2.5 mode=${MODE} stub=${process.env.BRIDGE_CURSOR_STUB === '1'})`);
createCursorBridgeServer({
  port: PORT,
  bind: HOST,
  mode: MODE,
  workspaceBase: process.env.CURSOR_WS_BASE || '/tmp/cursor-workspaces',
});
