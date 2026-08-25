import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { getUser } from '../lib/usersStore.js';
import {
  cancelClaudeLogin,
  completeClaudeLogin,
  getClaudeAuthStatus,
  startClaudeLogin,
} from '../lib/claudeNativeAuth.js';
import {
  getRemoteControlStatus,
  startRemoteControl,
  stopRemoteControl,
} from '../lib/claudeRemoteControl.js';

const router = Router();

async function requireAdmin(req, res) {
  const user = await getUser(Number(req.user?.sub));
  if (!user || user.status !== 'active' || user.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Accès admin requis' });
    return false;
  }
  return true;
}

router.get('/admin/claude-auth/status', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const status = await getClaudeAuthStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/admin/claude-auth/login-start', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const { url } = await startClaudeLogin();
    res.json({ ok: true, url });
  } catch (err) {
    const code = err.message === 'login_already_pending' ? 409 : 502;
    res.status(code).json({ ok: false, error: err.message });
  }
});

router.post('/admin/claude-auth/login-complete', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const result = await completeClaudeLogin(req.body?.code);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/admin/claude-auth/login-cancel', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json(cancelClaudeLogin());
});

router.get('/admin/claude-remote/status', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json({ ok: true, ...getRemoteControlStatus() });
});

router.post('/admin/claude-remote/start', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const model = String(req.body?.model || 'sonnet').trim() || 'sonnet';
    const sessionName = String(req.body?.sessionName || '').trim();
    const result = await startRemoteControl({ model, sessionName });
    if (!result.ok) {
      res.status(502).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/admin/claude-remote/stop', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json(stopRemoteControl());
});

export default router;
