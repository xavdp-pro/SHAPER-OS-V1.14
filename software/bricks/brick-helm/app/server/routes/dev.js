import { Router } from 'express';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { authMiddleware } from './auth.js';
import {
  getDevSessionInfo, setConversationWorkspace, devSessionPath,
} from '../lib/bridgeClient.js';
import { config } from '../config.js';

const router = Router();

router.get('/dev-session', authMiddleware, (_req, res) => {
  res.json({ ok: true, ...getDevSessionInfo() });
});

router.post('/dev-session/bind', authMiddleware, async (req, res) => {
  const path = String(req.body?.path || devSessionPath() || '').trim();
  const workspace = String(req.body?.workspace || '').trim()
    || config.cli.devWorkspaces[config.cli.devConversation];
  if (!path || !workspace) {
    return res.status(400).json({ ok: false, error: 'path and workspace are required' });
  }
  try {
    const result = await setConversationWorkspace(path, workspace);
    res.json({ ok: true, path, workspace, ...result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * Client-side breadcrumbs land here: a phone has no console, so audio/voice
 * debugging is impossible without shipping the events back to disk.
 */
const CLIENT_LOG_PATH = resolve(process.cwd(), 'data/client-debug.log');

router.post('/dev/client-log', authMiddleware, async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [req.body];
  const ua = String(req.get('user-agent') || '').slice(0, 160);
  const lines = entries.slice(0, 50).map((e) => JSON.stringify({
    at: new Date().toISOString(),
    tag: String(e?.tag || 'client').slice(0, 40),
    msg: String(e?.msg || '').slice(0, 500),
    data: e?.data ?? null,
    ua,
  }));
  if (!lines.length) return res.json({ ok: true, written: 0 });
  try {
    await mkdir(dirname(CLIENT_LOG_PATH), { recursive: true });
    await appendFile(CLIENT_LOG_PATH, `${lines.join('\n')}\n`, 'utf8');
    res.json({ ok: true, written: lines.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
