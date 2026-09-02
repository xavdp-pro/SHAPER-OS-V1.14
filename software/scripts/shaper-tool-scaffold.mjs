#!/usr/bin/env node
// Intent: docs/architecture/ARTIFACT-BOUNDARY.md#layer-earned
// Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
/**
 * @file shaper-tool-scaffold.mjs
 * @description Scaffolds a persistent P3 tool brick — the "Shaper Way"
 * (MANIFESTO §7.2, Rule 37 `source: native`): a CRM, a dashboard, a business
 * service the agent must never grow inside its own belly.
 *
 * Usage (from the root of a universe CLASS repository, never from the base):
 *   node scripts/shaper-tool-scaffold.mjs create --slug <slug> --name "<name>" --desc "<desc>" [--port <port>]
 *
 * What it writes, in the layers the naming contract knows and nothing else:
 *   packages/pkg-<slug>/          the source package (@shaper/pkg-<slug>), with a real test
 *   bricks/brick-<slug>/          INTENT.md, brick.json, Containerfile, cfg-<slug>.container
 *
 * Until the 2 September audit this script wrote the source package under an
 * `-engine` suffix (a layer no line of NAMING.md declares, so the artefact
 * it produced was refused by the guards it was meant to satisfy), created
 * data/<slug> on the host and bind-mounted it (the shared host tree V1.13.1
 * abandoned when state moved under the universe, F9), pinned
 * `localhost/shaper-<slug>:latest` in the unit, copied the package from the
 * build context, appended itself to the base's topology.json, and shipped a
 * test that asserted true === true.
 * Every one of those is now what the base's own guards refuse, so the
 * scaffold produces what those guards accept: state lives in a volume the
 * universe owns (vol-<universe>-<slug>), the image is written by the universe
 * from its lock (@IMG@, never a tag), and the package arrives from the pinned
 * source image exactly like a base brick's (COPY --from=shaper_base).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TAG = '[shaper-tool-scaffold]';

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

/**
 * A P3 brick is scaffolded inside the universe class repository, never inside
 * the base: the base ships only what artifact-boundary.json lists, and its
 * boundary test refuses any brick- directory it does not name. Halting here
 * is cheaper than a red suite that names the same fact one command later.
 */
function refuseTheBase() {
  const boundary = path.join(ROOT_DIR, 'artifact-boundary.json');
  if (!fs.existsSync(boundary)) return;
  // The file's PRESENCE is the signal. The first version of this guard let an
  // unreadable or unshaped boundary fall through (`catch { return; }`), so a
  // truncated artifact-boundary.json in the base — the one tree the guard
  // exists to protect — would have had the scaffold write a brick into it
  // without a word. Rule 0J: a configuration that is there but cannot be read
  // is a halt naming the file, never a silent default.
  let base;
  try {
    base = JSON.parse(fs.readFileSync(boundary, 'utf8')).base;
  } catch (err) {
    console.error(`${TAG} HALT — ${boundary} is present but unreadable: ${err.message}`);
    console.error(`${TAG} A directory that carries artifact-boundary.json is the SHAPER OS base; nothing is scaffolded until that file is repaired.`);
    process.exit(1);
  }
  if (!base || !Array.isArray(base.bricks)) {
    console.error(`${TAG} HALT — ${boundary} is present but carries no base.bricks list (contract shape: { base: { packages: [], bricks: [] } }).`);
    console.error(`${TAG} A directory that carries artifact-boundary.json is the SHAPER OS base; nothing is scaffolded until that file is repaired.`);
    process.exit(1);
  }
  console.error(`${TAG} HALT — ${ROOT_DIR} is the SHAPER OS base (it carries artifact-boundary.json).`);
  console.error(`${TAG} A P3 tool brick is native to a universe class repository (Rule 37, docs/agent/UNIVERSE-REPO-BIRTH.md); run this script from that repository's root.`);
  process.exit(1);
}

function createTool(options) {
  const { slug, name, desc } = options;
  if (!slug) {
    console.error(`${TAG} HALT — --slug is required.`);
    process.exit(1);
  }
  refuseTheBase();

  const toolName = name || slug.toUpperCase();
  const port = options.port || findNextAvailablePort();
  const pkg = `pkg-${slug}`;
  const brick = `brick-${slug}`;

  const brickDir = path.join(ROOT_DIR, 'bricks', brick);
  const pkgDir = path.join(ROOT_DIR, 'packages', pkg);
  const pkgPublic = path.join(pkgDir, 'public');
  const pkgTest = path.join(pkgDir, 'test');

  for (const dir of [brickDir, pkgDir]) {
    if (fs.existsSync(dir)) {
      console.error(`${TAG} HALT — ${dir} already exists; this script never overwrites a brick.`);
      process.exit(1);
    }
  }

  console.log(`\n${TAG} creating ${brick} + ${pkg} (${toolName}) on port :${port}`);

  fs.mkdirSync(brickDir, { recursive: true });
  fs.mkdirSync(pkgPublic, { recursive: true });
  fs.mkdirSync(pkgTest, { recursive: true });

  // 1. INTENT.md — the frame the brick serves, and the manifest entry that
  //    consumes it (Rule 37: lineage lives in the manifest, never in a path).
  fs.writeFileSync(path.join(brickDir, 'INTENT.md'), `# Brick: ${toolName}

> **Intent Classification**: SOVEREIGN TOOL INTENT — P3, \`source: native\` (${desc})

## 1. Declarative Objective

${desc}

## 2. Invariants

1. Pure ESM Node 20 micro-service, zero npm dependencies (Rule 5).
2. Its state lives in a volume the universe owns — \`vol-<universe>-${slug}\`,
   mounted on \`/data/${slug}\` inside the container — never in a host path.
   The deploy script that mounts it creates it first (universes/README.md §5).
3. Built from the pinned source image (\`SHAPER_BASE_IMAGE\`) with the brick
   directory as the only build context; the package is never copied from the
   working tree (docs/architecture/ARTIFACT-BOUNDARY.md).
4. Podman Quadlet lifecycle on port \`:${port}\`, bound to 127.0.0.1; the image
   is written by the universe from its \`cfg-image-lock.json\`, never a tag.
5. Answers \`/api/health\`; a green answer proves it is up, never that work happened.

## 3. How a universe consumes it

\`\`\`json
"${brick}": {
  "source": "native", "perimeter": "P3",
  "package": "@shaper/${pkg}", "image": "img-${slug}",
  "intent": "../../bricks/${brick}/INTENT.md",
  "role": "<WHY this brick in THIS universe>",
  "port": ${port}
}
\`\`\`
`);

  // 2. brick.json — what the image is built from (the boundary test's contract).
  fs.writeFileSync(path.join(brickDir, 'brick.json'), JSON.stringify({
    brick: slug,
    contractVersion: 1,
    distribution: 'native',
    buildPackages: [pkg],
    runtimeServices: [],
    proof: [`${slug} health`],
  }, null, 2) + '\n');

  // 3. Containerfile — the base brick recipe, verbatim in shape: the package
  //    arrives from the pinned source image, the context is this directory.
  fs.writeFileSync(path.join(brickDir, 'Containerfile'), `ARG SHAPER_BASE_IMAGE
FROM \${SHAPER_BASE_IMAGE} AS shaper_base
FROM docker.io/library/node:20-alpine

ARG SHAPER_SOURCE_REVISION
LABEL org.opencontainers.image.revision="\${SHAPER_SOURCE_REVISION}"
LABEL org.shaper.brick="${slug}"
LABEL org.shaper.build-packages="${pkg}"

WORKDIR /app
COPY --from=shaper_base /shaper/packages/${pkg}/ ./

EXPOSE ${port}
ENV NODE_ENV=production
ENV PORT=${port}
ENV DATA_DIR=/data/${slug}

CMD ["node", "server.js"]
`);

  // 4. Quadlet unit — same shape as every base brick's cfg-*.container.
  fs.writeFileSync(path.join(brickDir, `cfg-${slug}.container`), `[Unit]
Description=SHAPER OS ${toolName} (Podman Quadlet)
After=network-online.target

# The image is written by the universe that installs this unit, from the digest
# recorded in its cfg-image-lock.json. A tag can be moved under a running
# system; a digest cannot, and \`latest\` is forbidden outright.
#
#   sed -e "s|@IMG@|$(digest from cfg-image-lock.json)|" -e "s|%i|<universe>|g"
#
# ContainerName and Volume follow docs/architecture/NAMING.md: ctr- is a running
# container role, vol- a persistent universe-owned volume, both prefixed by the
# universe so two universes on one host never collide.
[Container]
Image=@IMG@
ContainerName=%i-ctr-${slug}
PublishPort=127.0.0.1:${port}:${port}
Environment=PORT=${port}
Environment=DATA_DIR=/data/${slug}
Volume=vol-%i-${slug}:/data/${slug}:Z
Restart=always

[Install]
WantedBy=multi-user.target
`);

  // 5. package.json — the layer name is the package name (naming contract).
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
    name: `@shaper/${pkg}`,
    version: '1.0.0',
    description: desc,
    type: 'module',
    main: 'server.js',
    scripts: {
      start: 'node server.js',
      test: 'node --test test/*.test.js',
    },
  }, null, 2) + '\n');

  // 6. server.js — DATA_DIR is given by the unit (or the operator); a missing
  //    one is a halt that says so, never a default under the checkout.
  fs.writeFileSync(path.join(pkgDir, 'server.js'), `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.PORT || ${port});
export const PUBLIC_DIR = path.join(__dirname, 'public');
export const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) {
  console.error('[${slug}] HALT — DATA_DIR is not set. The Quadlet unit sets it to /data/${slug} (a universe-owned volume); set it explicitly when running by hand.');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

const STARTED_AT = new Date().toISOString();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function handleRequest(req, res) {
  const { pathname } = new URL(req.url, \`http://\${req.headers.host || '127.0.0.1'}\`);

  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: '${slug}', port: PORT, dataDir: DATA_DIR, startedAt: STARTED_AT, timestamp: new Date().toISOString() }));
    return;
  }

  // Static files in public/; anything unknown falls back to index.html.
  let staticPath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!staticPath.startsWith(PUBLIC_DIR) || !fs.existsSync(staticPath) || !fs.statSync(staticPath).isFile()) {
    staticPath = path.join(PUBLIC_DIR, 'index.html');
  }
  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(staticPath).toLowerCase()] || 'text/html; charset=utf-8' });
    fs.createReadStream(staticPath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

/** Creates and binds the server; the caller reads server.address() once it is listening. */
export function createServer(port = PORT, host = '0.0.0.0') {
  const server = http.createServer(handleRequest);
  server.listen(port, host, () => {
    console.log(\`[${slug}] ${toolName} listening on http://\${host}:\${server.address().port} (data: \${DATA_DIR})\`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(PORT);
}
`);

  // 7. UI — public/index.html. It names no other brick and no host path: which
  //    cockpit sits beside this tool, and where, is the universe's decision.
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
    <div class="max-w-7xl mx-auto flex items-center gap-3">
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
  </header>
  <main class="max-w-7xl mx-auto w-full p-4 sm:p-6 flex-1 flex flex-col gap-6">
    <div class="bg-[#131b2e] border border-white/10 rounded-2xl p-6 shadow-xl">
      <h2 class="text-lg font-bold text-white mb-2">Welcome to ${toolName}</h2>
      <p class="text-sm text-slate-400 mb-4">${desc}</p>
      <div class="p-3 bg-white/5 rounded-xl border border-white/5 text-xs font-mono text-slate-300">
        State: /data/${slug} — a volume the universe owns
      </div>
    </div>
  </main>
</body>
</html>
`);

  // 8. A real test: it binds a socket and reads the answer (Rule 0G). The
  //    stub this used to write — true === true — was a green light for nothing.
  fs.writeFileSync(path.join(pkgTest, `${slug}.test.js`), `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '${slug}-'));
const { createServer } = await import('../server.js');

describe('${pkg}', () => {
  it('answers /api/health with its own name, from a real socket', async () => {
    const server = createServer(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await fetch(\`http://127.0.0.1:\${server.address().port}/api/health\`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'ok');
      assert.equal(body.service, '${slug}');
      assert.equal(body.dataDir, process.env.DATA_DIR);
    } finally {
      server.close();
    }
  });
});
`);

  console.log(`${TAG} created`);
  console.log(`   brick    : bricks/${brick}/  (INTENT.md, brick.json, Containerfile, cfg-${slug}.container)`);
  console.log(`   package  : packages/${pkg}/  (@shaper/${pkg}, test/${slug}.test.js)`);
  console.log(`   port     : :${port}`);
  console.log(`\nNext:`);
  console.log(`   1. node --test packages/${pkg}/test/*.test.js`);
  console.log(`   2. publish this repository's packages as its source image (the base's registry/Containerfile.base recipe), then`);
  console.log(`      SHAPER_BASE_IMAGE=<that image> podman build --build-arg SHAPER_BASE_IMAGE -f bricks/${brick}/Containerfile -t \${SHAPER_REGISTRY}/shaper/${brick}:\${SHAPER_IMAGE_TAG} bricks/${brick}`);
  console.log(`   3. add the manifest entry printed in bricks/${brick}/INTENT.md §3 to the universe manifest, and its digest to cfg-image-lock.json\n`);
}

const args = process.argv.slice(2);
const parsed = parseArgs(args);

if (parsed.command === 'create') {
  createTool(parsed);
} else {
  console.log(`
Shaper OS — Tool Scaffolder CLI (P3, source: native — run from a universe class repository)
Usage:
  node scripts/shaper-tool-scaffold.mjs create --slug <slug> --name "<name>" --desc "<desc>" [--port <port>]
`);
}
