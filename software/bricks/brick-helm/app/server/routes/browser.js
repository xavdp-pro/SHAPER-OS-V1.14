import { Router } from 'express';
import http from 'node:http';
import { authMiddleware } from './auth.js';
import { getUser } from '../lib/usersStore.js';
import {
  listContainers, startNeko, rebuildNeko, stopContainer, removeContainer,
} from '../lib/browserContainers.js';

const router = Router();

async function requireAdmin(req, res) {
  const user = await getUser(Number(req.user?.sub)).catch(() => null);
  if (!user || user.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Admin access required' });
    return null;
  }
  return user;
}

/** List browser containers (right-panel POC). */
router.get('/browser/containers', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json(await listContainers());
});

/** Start a Neko container (WebRTC browser). */
router.post('/browser/neko', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json(await startNeko({ name: req.body?.name || 'kovzu-neko' }));
});

/** Recreate the container from scratch (rebuild). */
router.post('/browser/:name/rebuild', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json(await rebuildNeko({ name: req.params.name }));
});

router.post('/browser/:name/stop', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json(await stopContainer(req.params.name));
});

router.delete('/browser/:name', authMiddleware, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json(await removeContainer(req.params.name));
});

/* —— Same-origin proxy to container UI (tab iframe) —— */

function findPort(containers, name) {
  const c = (containers || []).find((x) => x.name === name);
  return c?.port || null;
}

function proxyToContainer(req, res, port) {
  const prefix = `/api/browser/proxy/${req.params.name}`;
  const upstreamPath = req.originalUrl.startsWith(prefix)
    ? (req.originalUrl.slice(prefix.length) || '/')
    : (req.url || '/');
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers['accept-encoding'];
  const up = http.request({
    host: '127.0.0.1', port, method: req.method, path: upstreamPath, headers, timeout: 30000,
  }, (upRes) => {
    const h = { ...upRes.headers };
    delete h['x-frame-options'];
    if (h['content-security-policy']) {
      h['content-security-policy'] = String(h['content-security-policy']).replace(/frame-ancestors[^;]*;?/gi, '');
    }
    res.writeHead(upRes.statusCode || 502, h);
    upRes.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.status(502).json({ ok: false, error: 'Container unreachable' }); else res.end(); });
  up.on('timeout', () => up.destroy());
  req.pipe(up);
}

async function proxyHandler(req, res) {
  if (!(await requireAdmin(req, res))) return;
  const { containers } = await listContainers();
  const port = findPort(containers, req.params.name);
  if (!port) return res.status(404).json({ ok: false, error: 'Unknown container or port' });
  return proxyToContainer(req, res, port);
}

router.all('/browser/proxy/:name', authMiddleware, proxyHandler);
router.all('/browser/proxy/:name/{*rest}', authMiddleware, proxyHandler);

export default router;
