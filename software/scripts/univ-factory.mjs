#!/usr/bin/env node
/**
 * @file univ-factory.mjs
 * @description Universal CLI Factory for SHAPER OS.
 * Scaffolds, configures, and tests any generic business universe (univX) in seconds.
 * 
 * Usage:
 *   node scripts/univ-factory.mjs create --slug <slug> --name <name> --port <port> --plugins <list>
 * 
 * Example:
 *   node scripts/univ-factory.mjs create --slug immo --name "Real Estate ERP" --port 3103 --plugins crm,ged,webmail,chat
 */

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
    port: 3100,
    plugins: 'crm,ged,webmail,chat',
    sector: 'General Business Vertical'
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--slug' && args[i + 1]) parsed.slug = args[++i].toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (args[i] === '--name' && args[i + 1]) parsed.name = args[++i];
    if (args[i] === '--port' && args[i + 1]) parsed.port = parseInt(args[++i], 10);
    if (args[i] === '--plugins' && args[i + 1]) parsed.plugins = args[++i];
    if (args[i] === '--sector' && args[i + 1]) parsed.sector = args[++i];
  }

  return parsed;
}

function generatePluginCode(slug, pluginId, pluginTitle, icon) {
  return `/**
 * Plugin: ${pluginTitle} (${pluginId})
 * Scoped to Universe: univ-${slug}
 */

export const plugin = {
  id: '${pluginId}',
  title: '${pluginTitle}',
  icon: '${icon}',
  menuItems: [
    { id: '${pluginId}-overview', label: 'Overview', icon: '📊' },
    { id: '${pluginId}-new', label: 'Create New', icon: '➕' },
    { id: '${pluginId}-archive', label: 'Archive', icon: '📁' }
  ],

  render(container, state = {}) {
    container.innerHTML = \`
      <div class="content-card">
        <div class="section-header">
          <span class="section-tag tag-blue">${slug.toUpperCase()}</span>
          <h2>${pluginTitle}</h2>
        </div>
        <p class="lead-text">Active workspace for <strong>\${state.client || 'Current Dossier'}</strong>.</p>
        <div class="tech-box">
          <p>• Ready for AI-assisted operations and automated workflow processing.</p>
          <p>• Native integration with @shaper/variables-engine and @shaper/job-queue.</p>
        </div>
      </div>
    \`;
  },

  destroy(container) {
    if (container) container.innerHTML = '';
  }
};

export default plugin;
`;
}

function createUniverse(options) {
  const { slug, name, port, plugins: pluginsStr, sector } = options;

  if (!slug) {
    console.error('❌ Error: --slug is required (e.g. --slug immo)');
    process.exit(1);
  }

  const univDirName = `univ-${slug}`;
  const targetDir = path.join(ROOT_DIR, 'apps', univDirName);
  const pluginList = pluginsStr.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);

  console.log(`\n🏗️  [SHAPER-OS FACTORY] Scaffolding new universe: ${univDirName}`);
  console.log(`   • Name    : ${name || univDirName}`);
  console.log(`   • Port    : ${port}`);
  console.log(`   • Plugins : ${pluginList.join(', ')}`);
  console.log(`   • Target  : ${targetDir}\n`);

  if (fs.existsSync(targetDir)) {
    console.error(`❌ Error: Directory ${targetDir} already exists.`);
    process.exit(1);
  }

  // 1. Create directories
  fs.mkdirSync(path.join(targetDir, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'test'), { recursive: true });

  // 2. Write package.json
  const packageJson = {
    name: `@shaper/${univDirName}`,
    version: '1.0.0',
    type: 'module',
    description: name || `SHAPER OS Universe for ${slug}`,
    scripts: {
      start: 'node server.js',
      test: 'node --test test/*.test.js'
    }
  };
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');

  // 3. Write AGENT-CONTEXT.md
  const agentContext = `# AGENT LIVING CONTEXT — ${univDirName.toUpperCase()}

## 1. Identity & Mission
- **System**: SHAPER OS
- **Universe**: ${univDirName} (${name || slug})
- **Sector**: ${sector}
- **Primary Objective**: Automate 80% of repetitive operational tasks, parse incoming files, and assist human operators without hallucination.

## 2. Business Rules & Guardrails
1. Never fabricate missing variables or placeholders; halt execution and flag missing data.
2. Ingest all legal/operational documents via \`@shaper/ocr-engine\`.
3. Log all decisions into structured append-only JSONL via \`@shaper/event-logger\`.
4. Keep token usage strictly bounded by deterministic idempotence checkpoints.
`;
  fs.writeFileSync(path.join(targetDir, 'AGENT-CONTEXT.md'), agentContext);

  // 4. Write Plugins
  const iconMap = {
    crm: '👤',
    ged: '📁',
    webmail: '📬',
    chat: '💬',
    devis: '🧾',
    planning: '📅',
    analytics: '📈'
  };

  for (const p of pluginList) {
    const pluginDir = path.join(targetDir, 'plugins', `${p}-${slug}`);
    fs.mkdirSync(pluginDir, { recursive: true });
    const title = `${p.toUpperCase()} (${slug})`;
    const icon = iconMap[p] || '🧩';
    fs.writeFileSync(path.join(pluginDir, 'index.js'), generatePluginCode(slug, `${p}-${slug}`, title, icon));
  }

  // 5. Write server.js
  const serverJs = `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || ${port};

export function createServer() {
  return http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, app: '${univDirName}', port: PORT }));
    }

    if (req.url === '/api/plugins') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        plugins: ${JSON.stringify(pluginList.map(p => `${p}-${slug}`))}
      }));
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(\`<!DOCTYPE html>
<html>
<head><title>${name || univDirName} — SHAPER OS</title></head>
<body style="background:#0b0f19;color:#f8fafc;font-family:sans-serif;padding:2rem;">
  <h1>🌌 ${name || univDirName}</h1>
  <p>SHAPER OS Sovereign Universe is running on port ${port}.</p>
</body>
</html>\`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(\`🚀 [${univDirName}] Operational on http://127.0.0.1:\${PORT}\`);
  });
}
`;
  fs.writeFileSync(path.join(targetDir, 'server.js'), serverJs);

  // 6. Write Unit Test
  const testJs = `import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

test('${univDirName} - Health and Plugin Contract', async (t) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  await t.test('GET /api/health returns ok', async () => {
    const res = await fetch(\`http://127.0.0.1:\${port}/api/health\`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.app, '${univDirName}');
  });

  await t.test('GET /api/plugins returns registered plugins', async () => {
    const res = await fetch(\`http://127.0.0.1:\${port}/api/plugins\`);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.plugins.length, ${pluginList.length});
  });

  server.close();
});
`;
  fs.writeFileSync(path.join(targetDir, 'test', `${univDirName}.test.js`), testJs);

  // 7. Write Podman Quadlet definition in quadlet/
  const quadletDir = path.join(ROOT_DIR, 'quadlet');
  if (!fs.existsSync(quadletDir)) fs.mkdirSync(quadletDir, { recursive: true });

  const quadletContent = `[Unit]
Description=SHAPER OS Universe: ${univDirName}
After=network-online.target

[Container]
ContainerName=${univDirName}
Image=docker.io/library/node:20-alpine
Exec=node /apps/${univDirName}/server.js
PublishPort=${port}:${port}
Volume=${ROOT_DIR}/apps/${univDirName}:/apps/${univDirName}:ro
Volume=/data/${slug}:/data/${slug}:rw
Environment=NODE_ENV=production
Environment=PORT=${port}

[Service]
Restart=always
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target default.target
`;
  fs.writeFileSync(path.join(quadletDir, `${univDirName}.container`), quadletContent);

  console.log(`✅ [SUCCESS] ${univDirName} created and ready!`);
  console.log(`   • Run Tests : npm test --prefix apps/${univDirName}`);
  console.log(`   • Start App : node apps/${univDirName}/server.js\n`);
}

const args = process.argv.slice(2);
const options = parseArgs(args);

if (options.command === 'create') {
  createUniverse(options);
} else {
  console.log(`
🌌 SHAPER OS — Universe Factory CLI

Commands:
  create    Scaffold a new vertical universe

Options:
  --slug     Unique slug identifier (e.g. immo, avocat, logistique) [Required]
  --name     Human readable title
  --port     Target HTTP listening port (e.g. 3103)
  --plugins  Comma-separated list of plugins (crm,ged,webmail,chat,devis)
  --sector   Business sector description

Example:
  node scripts/univ-factory.mjs create --slug immo --name "Real Estate ERP" --port 3103 --plugins crm,ged,webmail,chat
`);
}
