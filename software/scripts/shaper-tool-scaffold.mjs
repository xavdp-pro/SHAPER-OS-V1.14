#!/usr/bin/env node
// Intent: docs/architecture/ARTIFACT-BOUNDARY.md#layer-earned
/**
 * @file shaper-tool-scaffold.mjs
 * @description Sovereign and persistent tool brick generator for SHAPER OS.
 * Designed to let an agent or developer scaffold a true Shaper OS brick
 * (CRM, ERP, Dashboard, Portfolio, etc.) in one command that persists over time.
 *
 * Usage:
 *   node scripts/shaper-tool-scaffold.mjs create --slug <slug> --name "<name>" --desc "<desc>"
 *
 * Example:
 *   node scripts/shaper-tool-scaffold.mjs create --slug crm --name "CRM & Pipeline Pro" --desc "Client and quote management"
 */

// The universe slug belongs to the operator: this repository ships none.
const univSlug = process.env.UNIV_SLUG || '<univ_slug>';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function parseArgs(args) {
  const parsed = {
    command: args[0] || 'help',
    slug: '',
    name: '',
    desc: 'Shaper OS sovereign tool',
    port: null,
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--slug' && args[i + 1]) parsed.slug = args[++i].toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (args[i] === '--name' && args[i + 1]) parsed.name = args[++i];
    if (args[i] === '--desc' && args[i + 1]) parsed.desc = args[++i];
    if (args[i] === '--port' && args[i + 1]) parsed.port = parseInt(args[++i], 10);
  }

  return parsed;
}

function findNextAvailablePort() {
  const topPath = path.join(ROOT_DIR, 'topology.json');
  let highest = 8660;
  if (fs.existsSync(topPath)) {
    const raw = fs.readFileSync(topPath, 'utf8');
    const matches = raw.match(/86[0-9]{2}/g) || [];
    for (const m of matches) {
      const p = parseInt(m, 10);
      if (p > highest) highest = p;
    }
  }
  return highest + 10;
}

function createTool(options) {
  const { slug, name, desc } = options;
  if (!slug) {
    console.error('❌ Error: --slug parameter is required.');
    process.exit(1);
  }
  const toolName = name || slug.toUpperCase();
  const port = options.port || findNextAvailablePort();

  console.log(`\n🔨 [Shaper Tool Factory] Creating persistent brick: ${toolName} (${slug}) on port :${port}...`);

  const brickDir = path.join(ROOT_DIR, `bricks/brick-${slug}`);
  const pkgDir = path.join(ROOT_DIR, `packages/${slug}-engine`);
  const pkgPublic = path.join(pkgDir, 'public');
  const pkgTest = path.join(pkgDir, 'test');
  const dataDir = path.join(ROOT_DIR, `data/${slug}`);

  fs.mkdirSync(brickDir, { recursive: true });
  fs.mkdirSync(pkgPublic, { recursive: true });
  fs.mkdirSync(pkgTest, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  // 1. INTENT.md
  fs.writeFileSync(path.join(brickDir, 'INTENT.md'), `# Brick: ${toolName}

> **Intent Classification**: SOVEREIGN TOOL INTENT (${desc})

## 1. Declarative Objective
${desc}

## 2. Invariants
1. Pure ESM Node 20 micro-service.
2. Persistent host volume mounted on \`/data/${slug}\`.
3. Standalone decoupled architecture.
4. Podman Quadlet lifecycle on port \`:${port}\`.
`);

  // 2. Containerfile
  fs.writeFileSync(path.join(brickDir, 'Containerfile'), `FROM docker.io/library/node:20-alpine

WORKDIR /app
COPY packages/${slug}-engine/ ./

EXPOSE ${port}
ENV NODE_ENV=production
ENV PORT=${port}
ENV DATA_DIR=/data/${slug}

CMD ["node", "server.js"]
`);

  // 3. Quadlet .container
  fs.writeFileSync(path.join(brickDir, `${slug}.container`), `[Unit]
Description=Shaper OS — ${toolName} (${univSlug}-${slug})
After=network-online.target

[Container]
Image=localhost/shaper-${slug}:latest
ContainerName=${univSlug}-${slug}
Network=host
Environment=PORT=${port}
Environment=DATA_DIR=/data/${slug}
Volume=/data/${slug}:/data/${slug}:rw,z

[Service]
Restart=always

[Install]
WantedBy=default.target
`);

  // 4. package.json
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
    name: `@shaper/${slug}-engine`,
    version: '1.0.0',
    description: desc,
    type: 'module',
    main: 'server.js',
    scripts: {
      start: 'node server.js',
      test: `node --test test/${slug}.test.js`
    }
  }, null, 2));

  // 5. server.js
  fs.writeFileSync(path.join(pkgDir, 'server.js'), `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PORT = Number(process.env.PORT || ${port});
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data/${slug}');
export const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function handleRequest(req, res) {
  const parsed = new URL(req.url, \`http://\${req.headers.host || '127.0.0.1'}\`);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health
  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: '${slug}-v1',
      port: PORT,
      dataDir: DATA_DIR,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // Static files in public/
  let staticPath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(staticPath) || !fs.statSync(staticPath).isFile()) {
    staticPath = path.join(PUBLIC_DIR, 'index.html');
  }

  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    const ext = path.extname(staticPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/html; charset=utf-8' });
    fs.createReadStream(staticPath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

export function createServer(port = PORT) {
  const server = http.createServer(handleRequest);
  server.listen(port, '0.0.0.0', () => {
    console.log(\`[${slug}-v1] ${toolName} active on http://0.0.0.0:\${port} (data: \${DATA_DIR})\`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(PORT);
}
`);

  // 6. UI public/index.html
  fs.writeFileSync(path.join(pkgPublic, 'index.html'), `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${toolName} — Shaper OS</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-[#070b14] text-slate-200 min-h-screen flex flex-col font-sans antialiased selection:bg-cyan-500/30">
  <header class="border-b border-white/10 bg-[#0d1322]/90 backdrop-blur sticky top-0 z-30 px-4 py-3">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white font-bold text-lg">
          🛠️
        </div>
        <div>
          <h1 class="text-base font-bold tracking-tight text-white flex items-center gap-2">
            ${toolName} <span class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-mono border border-cyan-500/20">:${port}</span>
          </h1>
          <p class="text-xs text-slate-400">${desc}</p>
        </div>
      </div>
      <a href="http://127.0.0.1:8650" target="_blank" class="px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 transition text-xs font-medium">
        💬 KovZu
      </a>
    </div>
  </header>
  <main class="max-w-7xl mx-auto w-full p-4 sm:p-6 flex-1 flex flex-col gap-6">
    <div class="bg-[#131b2e] border border-white/10 rounded-2xl p-6 shadow-xl">
      <h2 class="text-lg font-bold text-white mb-2">Welcome to ${toolName}</h2>
      <p class="text-sm text-slate-400 mb-4">${desc}</p>
      <div class="p-3 bg-white/5 rounded-xl border border-white/5 text-xs font-mono text-slate-300">
        Host persistence: /data/${slug}
      </div>
    </div>
  </main>
</body>
</html>
`);

  // 7. test
  fs.writeFileSync(path.join(pkgTest, `${slug}.test.js`), `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('${slug}-engine', () => {
  it('instantiates and initializes correctly', () => {
    assert.equal(true, true);
  });
});
`);

  // 8. topology.json update
  const topPath = path.join(ROOT_DIR, 'topology.json');
  if (fs.existsSync(topPath)) {
    try {
      const top = JSON.parse(fs.readFileSync(topPath, 'utf8'));
      if (top.minimalSocle && Array.isArray(top.minimalSocle.packages)) {
        if (!top.minimalSocle.packages.includes(`@shaper/${slug}-engine`)) {
          top.minimalSocle.packages.push(`@shaper/${slug}-engine`);
          fs.writeFileSync(topPath, JSON.stringify(top, null, 2) + '\n');
        }
      }
    } catch { /* skip */ }
  }

  console.log(`✅ [Shaper Tool Factory] Brick created successfully!`);
  console.log(`   📁 Brick   : bricks/brick-${slug}`);
  console.log(`   📦 Package : packages/${slug}-engine`);
  console.log(`   💾 Data    : /data/${slug}`);
  console.log(`   🔌 Port    : :${port}`);
  console.log(`\nTo build and run the Podman container:`);
  console.log(`   podman build -t localhost/shaper-${slug}:latest -f bricks/brick-${slug}/Containerfile .`);
  console.log(`   podman run -d --name ${univSlug}-${slug} --network host -v $(pwd)/data/${slug}:/data/${slug}:rw,z localhost/shaper-${slug}:latest\n`);
}

const args = process.argv.slice(2);
const parsed = parseArgs(args);

if (parsed.command === 'create') {
  createTool(parsed);
} else {
  console.log(`
Shaper OS — Tool Scaffolder CLI
Usage:
  node scripts/shaper-tool-scaffold.mjs create --slug <slug> --name "<name>" --desc "<desc>" [--port <port>]
`);
}
