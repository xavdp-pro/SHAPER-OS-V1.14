/**
 * @file livereload.js
 * Hot reload without a bundler: server watches public/, open browsers
 * listen to an SSE stream and react.
 *
 * Two distinct behaviors due to differing costs:
 *   - stylesheets are hot-reapplied while preserving page state
 *     (current folder, selection, open panel);
 *   - everything else reloads the page.
 *
 * Active only when GED_DEV=1. In production, the endpoint does not exist and
 * the script is not injected: zero trace in delivered assets.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEV = process.env.GED_DEV === '1';

const clients = new Set();
let watcher = null;
let timer = null;

/** Script injected into index.html in dev mode, never in production. */
export const CLIENT_SNIPPET = `
<script>
(() => {
  let retry = 0;
  const connect = () => {
    const es = new EventSource('/api/livereload');
    es.onopen = () => { retry = 0; console.info('[ged] hot reload active'); };
    es.addEventListener('css', (e) => {
      // Re-applies stylesheet without losing page state.
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        const url = new URL(link.href, location.origin);
        url.searchParams.set('v', Date.now());
        link.href = url.pathname + url.search;
      }
      console.info('[ged] stylesheet reloaded:', e.data);
    });
    es.addEventListener('reload', () => location.reload());
    es.onerror = () => {
      es.close();
      retry = Math.min(retry + 1, 10);
      setTimeout(connect, 300 * retry); // server restarting: reconnect
    };
  };
  connect();
})();
</script>`;

/** Attaches SSE endpoint. Returns true if request was handled. */
export function handleLiveReload(req, res, pathname) {
  if (!DEV || pathname !== '/api/livereload') return false;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
  return true;
}

const watchers = [];

function notify(filename) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const isCss = path.extname(filename).toLowerCase() === '.css';
    const frame = `event: ${isCss ? 'css' : 'reload'}\ndata: ${filename}\n\n`;
    for (const c of clients) c.write(frame);
    console.log(`[ged-dev] ${filename} → ${isCss ? 'stylesheet reloaded' : 'page reloaded'} (${clients.size} tab${clients.size > 1 ? 's' : ''})`);
  }, 80); // allows editor to finish writing
}

/**
 * Watches public/ and notifies connected browsers.
 * Recursive watching is not supported everywhere (Linux before Node 20), so we
 * attempt it and fall back to explicit per-folder watchers.
 */
export function watchPublic(publicDir) {
  if (!DEV || watchers.length) return;

  const watchDir = (dir, prefix = '') => {
    try {
      watchers.push(fs.watch(dir, (_event, filename) => {
        if (filename) notify(prefix ? `${prefix}/${filename}` : filename);
      }));
    } catch (err) {
      console.warn(`[ged-dev] watching impossible on ${dir}:`, err.message);
    }
  };

  try {
    watchers.push(fs.watch(publicDir, { recursive: true }, (_event, filename) => {
      if (filename) notify(filename);
    }));
  } catch {
    // Fallback: root directory then each of its subdirectories.
    watchDir(publicDir);
    for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
      if (entry.isDirectory()) watchDir(path.join(publicDir, entry.name), entry.name);
    }
  }
  console.log(`[ged-dev] hot reload active on ${publicDir} (${watchers.length} watcher${watchers.length > 1 ? 's' : ''})`);
}

