import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { SupervisorEngine } from './index.js';

const execAsync = promisify(exec);

const PORT = parseInt(process.env.SUPERVISOR_PORT || '9160', 10);
const LOGGER_URL = process.env.LOGGER_URL || 'http://127.0.0.1:9120';
const CHILDREN_CONFIG_FILE = process.env.CHILDREN_CONFIG || path.join(process.cwd(), 'children.json');

let children = [];
if (fs.existsSync(CHILDREN_CONFIG_FILE)) {
  try {
    children = JSON.parse(fs.readFileSync(CHILDREN_CONFIG_FILE, 'utf8'));
  } catch (err) {
    console.error(`[supervisor] Failed to load ${CHILDREN_CONFIG_FILE}:`, err.message);
  }
}

const engine = new SupervisorEngine({
  name: 'supervisor-v1',
  loggerUrl: LOGGER_URL,
  children,
  execImpl: async (cmd) => {
    const { stdout, stderr } = await execAsync(cmd);
    return stdout || stderr;
  },
});

export function createSupervisorServer({ engine }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    if (req.method === 'GET' && p === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: engine.name }));
      return;
    }

    if (req.method === 'GET' && p === '/api/vitals') {
      const v = await engine.vitals();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(v));
      return;
    }

    if (req.method === 'GET' && p === '/api/supervisor/children') {
      const list = [];
      for (const [name, cfg] of engine.children.entries()) {
        const assessment = await engine.assessChild(cfg);
        list.push(assessment);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, children: list }));
      return;
    }

    if (req.method === 'POST' && p === '/api/supervisor/reconcile') {
      const results = [];
      for (const [name, cfg] of engine.children.entries()) {
        const rec = await engine.reconcileChild(cfg);
        results.push(rec);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, reconciled: results }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const server = createSupervisorServer({ engine });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[supervisor] Ready on port ${PORT} (supervising ${children.length} child universes)`);
  });
}
