#!/usr/bin/env node
/**
 * Manager web gateway for univ-wordpress-father.
 * Serves an interactive dashboard and provides API for configuring child WordPress instances.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { routingFromEnv } from '../../../software/packages/wp-dns-convention/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WP_MANAGER_PORT || 9470);
const SUPERVISOR_URL = process.env.SUPERVISOR_URL || 'http://127.0.0.1:9460';
const ROUTING_FILE = process.env.WP_ROUTING_FILE || path.join(__dirname, '..', 'routing.json');

/**
 * Public URL of the child store. No domain is committed: WP_SITE_HOST is supplied
 * at deploy time by the human operator (a zone they already manage in Cloudflare).
 * Without it, the gateway falls back to the local address, which is always true.
 */
function publicSiteUrl() {
  const host = process.env.WP_SITE_HOST;
  return host && host.trim() ? `https://${host.trim()}` : 'http://127.0.0.1:9580';
}

function loadRouting() {
  if (fs.existsSync(ROUTING_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8'));
    } catch (err) {
      console.warn(`[manager-gateway] invalid ${ROUTING_FILE}:`, err.message);
    }
  }
  return routingFromEnv();
}

/** Execute a wp-cli command inside the container network */
function runWpCli(args = []) {
  return new Promise((resolve) => {
    const cmdArgs = [
      'run', '--rm', '--network', 'shaper-wp-net',
      '--volumes-from', 'univ-wordpress-child-wordpress',
      '-e', 'WORDPRESS_DB_HOST=univ-wordpress-child-mariadb:3306',
      '-e', 'WORDPRESS_DB_USER=wp',
      '-e', 'WORDPRESS_DB_PASSWORD=wp-dev-pass',
      '-e', 'WORDPRESS_DB_NAME=wordpress',
      'docker.io/library/wordpress:cli-php8.2',
      'wp', ...args, '--path=/var/www/html'
    ];

    execFile('podman', cmdArgs, { timeout: 30000 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error ? error.code : 0,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim()
      });
    });
  });
}

async function getWpStatus() {
  const isInstalledRes = await runWpCli(['core', 'is-installed']);
  if (!isInstalledRes.ok) {
    return {
      installed: false,
      status: 'Ready for initial setup',
      siteUrl: publicSiteUrl()
    };
  }

  const [titleRes, descRes, langRes] = await Promise.all([
    runWpCli(['option', 'get', 'blogname']),
    runWpCli(['option', 'get', 'blogdescription']),
    runWpCli(['option', 'get', 'WPLANG'])
  ]);

  return {
    installed: true,
    status: 'Operational',
    siteTitle: titleRes.stdout || 'WordPress Store',
    tagline: descRes.stdout || '',
    language: langRes.stdout || 'fr_FR',
    siteUrl: publicSiteUrl()
  };
}

function htmlPage(routing) {
  const sitesRows = routing.sites.map((s) => `
    <tr>
      <td><strong>${s.siteSlug}</strong></td>
      <td><a href="${s.publicUrl}" target="_blank" rel="noopener">${s.hostname} ↗</a></td>
      <td><code>127.0.0.1:${s.localPort}</code></td>
      <td><span class="badge badge-child">${s.child}</span></td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SHAPER OS — WordPress Fleet Manager</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --heading: #f0f6fc;
      --primary: #238636;
      --primary-hover: #2ea043;
      --blue: #58a6ff;
      --badge-bg: #21262d;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      max-width: 1040px;
      margin: 2rem auto;
      padding: 0 1.25rem;
      line-height: 1.5;
    }
    h1, h2, h3 { color: var(--heading); margin-top: 0; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
      margin-bottom: 1.5rem;
    }
    .header h1 { font-size: 1.5rem; margin: 0; display: flex; align-items: center; gap: 0.5rem; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.5rem;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    th, td { text-align: left; padding: 0.75rem 0.5rem; border-bottom: 1px solid var(--border); }
    th { color: var(--heading); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    code { background: var(--badge-bg); padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.85rem; color: #79c0ff; }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-success { background: #23863633; color: #3fb950; border: 1px solid #238636; }
    .badge-child { background: var(--badge-bg); color: var(--text); border: 1px solid var(--border); }
    
    .form-group { margin-bottom: 1rem; }
    label { display: block; margin-bottom: 0.35rem; color: var(--heading); font-size: 0.9rem; font-weight: 500; }
    input[type="text"], input[type="email"], select {
      width: 100%;
      max-width: 480px;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: #0d1117;
      color: var(--heading);
      font-size: 0.95rem;
    }
    input:focus, select:focus { outline: none; border-color: var(--blue); }
    button {
      background: var(--primary);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.1);
      padding: 0.6rem 1.2rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: background 0.15s ease;
    }
    button:hover { background: var(--primary-hover); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    pre {
      background: #0a0c10;
      border: 1px solid var(--border);
      color: #e6edf3;
      padding: 1rem;
      border-radius: 6px;
      overflow: auto;
      font-size: 0.85rem;
    }
    .feedback { margin-top: 0.75rem; font-size: 0.9rem; font-weight: 500; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌐 SHAPER OS — WordPress Manager</h1>
    <div><span class="badge badge-success">Père Connecté (:9470)</span></div>
  </div>

  <!-- Paramétrage WordPress -->
  <div class="card">
    <h2>⚙️ Paramétrage du WordPress (<a href="${publicSiteUrl()}" target="_blank">${process.env.WP_SITE_HOST || '127.0.0.1:9580'}</a>)</h2>
    <p style="color:#8b949e; font-size:0.9rem;">Pilotez le titre, le slogan et la langue de votre WordPress directement depuis ce Manager Père.</p>

    <form id="wpForm" onsubmit="saveWpConfig(event)">
      <div class="form-group">
        <label for="siteTitle">Titre du Site</label>
        <input type="text" id="siteTitle" placeholder="Ex: Boutique Démo SHAPER OS" required />
      </div>

      <div class="form-group">
        <label for="tagline">Slogan / Description</label>
        <input type="text" id="tagline" placeholder="Ex: Boutique souveraine autonome façonnée sur mesure" />
      </div>

      <div class="form-group">
        <label for="language">Langue de l'interface</label>
        <select id="language">
          <option value="fr_FR">Français (fr_FR)</option>
          <option value="en_US">English (en_US)</option>
          <option value="es_ES">Español (es_ES)</option>
        </select>
      </div>

      <button type="submit" id="btnSubmit">💾 Enregistrer les paramètres sur le WordPress</button>
      <div id="formMsg" class="feedback"></div>
    </form>
  </div>

  <!-- Table de Routage -->
  <div class="card">
    <h2>🗺️ Arborescence & Univers Supervisés</h2>
    <table>
      <thead><tr><th>Slug</th><th>URL Publique (Cloudflare)</th><th>Port Local</th><th>Univers Fils</th></tr></thead>
      <tbody>${sitesRows}</tbody>
    </table>
  </div>

  <!-- Télémétrie Superviseur -->
  <div class="card">
    <h2>📡 Télémétrie & Sondes de Santé (Règle 23)</h2>
    <pre id="children">Chargement des sondes...</pre>
  </div>

  <script>
    async function loadStatus() {
      try {
        const res = await fetch('/api/wp/status');
        const data = await res.json();
        if (data.ok && data.wp) {
          if (data.wp.siteTitle) document.getElementById('siteTitle').value = data.wp.siteTitle;
          if (data.wp.tagline) document.getElementById('tagline').value = data.wp.tagline;
          if (data.wp.language) document.getElementById('language').value = data.wp.language;
        }
      } catch (err) {
        console.error('Erreur chargement statut:', err);
      }

      fetch('/api/supervisor/children')
        .then((r) => r.json())
        .then((d) => { document.getElementById('children').textContent = JSON.stringify(d, null, 2); })
        .catch((e) => { document.getElementById('children').textContent = String(e); });
    }

    async function saveWpConfig(e) {
      e.preventDefault();
      const btn = document.getElementById('btnSubmit');
      const msg = document.getElementById('formMsg');
      btn.disabled = true;
      btn.textContent = '⏳ Application en cours...';
      msg.textContent = '';

      const payload = {
        title: document.getElementById('siteTitle').value,
        tagline: document.getElementById('tagline').value,
        language: document.getElementById('language').value,
      };

      try {
        const res = await fetch('/api/wp/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok) {
          msg.style.color = '#3fb950';
          msg.textContent = '✅ Paramètres appliqués avec succès sur le WordPress !';
        } else {
          msg.style.color = '#f85149';
          msg.textContent = '❌ Erreur: ' + (data.error || 'Échec');
        }
      } catch (err) {
        msg.style.color = '#f85149';
        msg.textContent = '❌ Erreur de communication: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Enregistrer les paramètres sur le WordPress';
      }
    }

    loadStatus();
  </script>
</body>
</html>`;
}

async function proxyToSupervisor(req, res, targetPath) {
  const url = `${SUPERVISOR_URL}${targetPath}`;
  try {
    const upstream = await fetch(url, { method: req.method });
    const body = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    res.end(body);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

const routing = loadRouting();

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if ((req.method === 'GET' || req.method === 'HEAD') && p === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'wp-manager-gateway', routing: routing.managerHostname }));
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && p === '/api/routing') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, routing }));
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && p === '/api/wp/status') {
    const wp = await getWpStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, wp }));
    return;
  }

  if (req.method === 'POST' && p === '/api/wp/configure') {
    try {
      const payload = await parseJsonBody(req);
      const updates = [];

      if (payload.title) {
        updates.push(runWpCli(['option', 'update', 'blogname', payload.title]));
      }
      if (payload.tagline !== undefined) {
        updates.push(runWpCli(['option', 'update', 'blogdescription', payload.tagline]));
      }
      if (payload.language) {
        updates.push(runWpCli(['option', 'update', 'WPLANG', payload.language]));
      }

      await Promise.all(updates);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'WordPress configured successfully' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (p.startsWith('/api/supervisor/')) {
    await proxyToSupervisor(req, res, p);
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && (p === '/' || p === '/console')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlPage(routing));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[manager-gateway] ${routing.managerUrl} (local :${PORT}) supervising via ${SUPERVISOR_URL}`);
});
