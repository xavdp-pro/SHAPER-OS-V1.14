import { Router } from 'express';
import http from 'node:http';
import { authMiddleware } from './auth.js';
import { discoverAppsFromFilesystem } from '../lib/vibeApps.js';
import { listVibeProjects, getVibeProject } from '../lib/vibeProjects.js';

const router = Router();

/** Folders under /apps (local disk scan). */
router.get('/vibe/apps', authMiddleware, (_req, res) => {
  res.json({ ok: true, root: '/apps', apps: discoverAppsFromFilesystem() });
});

/** List vibe-code projects (right panel). */
router.get('/vibe/projects', authMiddleware, (_req, res) => {
  res.json({ ok: true, projects: listVibeProjects() });
});

/** Dev server status (is port responding?) — for the Preview tab state. */
router.get('/vibe/projects/:id/status', authMiddleware, (req, res) => {
  const project = getVibeProject(req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: 'Unknown project' });
  const probe = http.request({
    host: project.devHost,
    port: project.devPort,
    path: '/',
    method: 'HEAD',
    timeout: 2500,
  }, (up) => {
    up.resume();
    res.json({ ok: true, up: true, status: up.statusCode, project });
  });
  probe.on('error', () => res.json({ ok: true, up: false, project }));
  probe.on('timeout', () => { probe.destroy(); res.json({ ok: true, up: false, project }); });
  probe.end();
});

/** Strip headers that prevent display in a same-origin iframe. */
function stripFramingHeaders(headers) {
  const out = { ...headers };
  delete out['x-frame-options'];
  delete out['X-Frame-Options'];
  if (out['content-security-policy']) {
    // Keep only what does not block same-origin iframe embedding.
    out['content-security-policy'] = String(out['content-security-policy'])
      .replace(/frame-ancestors[^;]*;?/gi, '');
  }
  return out;
}

/**
 * Same-origin reverse proxy to the project's dev server.
 * Mounted on /api/preview/:id → req.url = subpath on dev server side.
 * Note: Vite dev must run with base=/api/preview/:id/ so module graph / HMR
 * resolves under this prefix (see mds/CANVAS-PREVIEW.md).
 */
function proxyHandler(req, res) {
  const project = getVibeProject(req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: 'Unknown project' });

  // Strip prefix /api/preview/<id> to get the path on dev server side.
  const prefix = `/api/preview/${project.id}`;
  const upstreamPath = req.originalUrl.startsWith(prefix)
    ? (req.originalUrl.slice(prefix.length) || '/')
    : (req.url || '/');
  // No upstream compression: we must be able to rewrite HTML in plaintext.
  const fwdHeaders = { ...req.headers, host: `${project.devHost}:${project.devPort}` };
  delete fwdHeaders['accept-encoding'];
  // express.json() already consumed the request stream — re-send JSON body
  // or POSTs hang upstream waiting for Content-Length bytes that never arrive.
  const method = String(req.method || 'GET').toUpperCase();
  const contentType = String(req.headers['content-type'] || '');
  const parsedJsonBody = method !== 'GET' && method !== 'HEAD'
    && contentType.includes('application/json')
    && req.body !== undefined;
  let bodyBuf = null;
  if (parsedJsonBody) {
    bodyBuf = Buffer.from(JSON.stringify(req.body ?? null), 'utf8');
    fwdHeaders['content-length'] = String(bodyBuf.length);
    delete fwdHeaders['transfer-encoding'];
  }
  const options = {
    host: project.devHost,
    port: project.devPort,
    method: req.method,
    path: upstreamPath,
    headers: fwdHeaders,
    timeout: 30000,
  };
  const prefixUrl = `/api/preview/${project.id}`;
  const upstream = http.request(options, (up) => {
    const ct = String(up.headers['content-type'] || '');
    // For HTML: rewrite root-absolute URLs under preview prefix
    // (best-effort; 100% reliable if dev/build runs with base=prefix).
    if (ct.includes('text/html')) {
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        // Document is served under the prefix → relative resolves cleanly.
        // Rewrite only root-absolute URLs (="/… but not ="//…).
        html = html.replace(/((?:src|href)=)"\/(?!\/)/g, `$1"${prefixUrl}/`);
        const headers = stripFramingHeaders(up.headers);
        delete headers['content-length'];
        res.writeHead(up.statusCode || 200, headers);
        res.end(html);
      });
      return;
    }
    res.writeHead(up.statusCode || 502, stripFramingHeaders(up.headers));
    up.pipe(res);
  });
  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({
        ok: false,
        error: `Dev server unreachable (${project.devHost}:${project.devPort})`,
        detail: err.message,
        hint: `Start dev with base=/api/preview/${project.id}/`,
      });
    } else {
      res.end();
    }
  });
  upstream.on('timeout', () => { upstream.destroy(); });
  if (bodyBuf) {
    upstream.end(bodyBuf);
  } else {
    req.pipe(upstream);
  }
  return undefined;
}

// Express 5 (path-to-regexp v8): named wildcard, no bare `*`.
router.all('/preview/:id', authMiddleware, proxyHandler);
router.all('/preview/:id/{*rest}', authMiddleware, proxyHandler);

export default router;
