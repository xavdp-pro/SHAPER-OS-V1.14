import net from 'node:net';
import { getVibeProject } from './vibeProjects.js';

const PREFIX_RE = /^\/api\/preview\/([^/?]+)(\/[^?]*)?/;

/**
 * Proxy WebSocket (HMR Vite) du panneau Aperçu vers le dev server du projet.
 * N'agit QUE sur /api/preview/<id>/… — laisse les autres upgrades (voix) tranquilles.
 */
export function attachPreviewWebSocket(server) {
  server.on('upgrade', (req, socket, head) => {
    const m = String(req.url || '').match(PREFIX_RE);
    if (!m) return; // pas une preview → autres handlers (voix)
    const project = getVibeProject(m[1]);
    if (!project) { socket.destroy(); return; }

    const prefix = `/api/preview/${project.id}`;
    const upstreamPath = req.url.startsWith(prefix)
      ? (req.url.slice(prefix.length) || '/')
      : (m[2] || '/');

    const upstream = net.connect(project.devPort, project.devHost, () => {
      const headers = { ...req.headers, host: `${project.devHost}:${project.devPort}` };
      let raw = `${req.method} ${upstreamPath} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        if (v == null) continue;
        raw += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`;
      }
      raw += '\r\n';
      upstream.write(raw);
      if (head && head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', () => { try { socket.destroy(); } catch { /* */ } });
    socket.on('error', () => { try { upstream.destroy(); } catch { /* */ } });
  });
}
