#!/usr/bin/env node
/**
 * WordPress / MariaDB vitals probe for univ-wordpress-child.
 *
 * Publishes GET /api/vitals with signals and checks only — never a root
 * `status` / `ok` / `healthy` key (Rule 23). The father supervisor grades.
 *
 * Usage:
 *   node vitals-probe.mjs --role=wordpress --port=9560
 *   node vitals-probe.mjs --role=mariadb --port=9561
 */
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import { vitals, ageSeconds, writable } from '../../software/packages/logger/vitals.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

const ROLE = args.role || 'wordpress';
const PORT = Number(args.port || (ROLE === 'mariadb' ? 9561 : 9560));
const WP_URL = args.wpUrl || process.env.WP_URL || 'http://127.0.0.1:9580';
const UPLOADS = args.uploads || process.env.WP_UPLOADS || '/var/www/html/wp-content/uploads';
const DB_HOST = args.dbHost || process.env.WORDPRESS_DB_HOST || '127.0.0.1';
const DB_PORT = Number(args.dbPort || process.env.WORDPRESS_DB_PORT || 9536);
const PLUGIN_DIR = args.pluginDir || process.env.WP_PLUGIN_DIR || '/var/www/html/wp-content/plugins';
const WP_VERSION_FILE = args.wpVersionFile || process.env.WP_VERSION_FILE || '/var/www/html/wp-includes/version.php';

const startedAt = new Date().toISOString();
const state = {
  httpLastOkAt: null,
  httpStatus: null,
  httpAttempts: 0,
  dbLastOkAt: null,
  dbLastError: null,
  dbAttempts: 0,
  dbLastQueryMs: null,
};

function countPluginDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
  } catch {
    return null;
  }
}

function readWpVersion(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const m = raw.match(/\$wp_version\s*=\s*'([^']+)'/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function diskBytes(dir) {
  try {
    const st = fs.statfsSync ? fs.statfsSync(dir) : null;
    if (st && st.bavail !== undefined) {
      return {
        freeBytes: Number(st.bavail) * Number(st.bsize),
        totalBytes: Number(st.blocks) * Number(st.bsize),
      };
    }
  } catch { /* fall through */ }
  return { freeBytes: null, totalBytes: null };
}

function probeTcp(host, port, timeoutMs = 1500) {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      const ms = Date.now() - started;
      socket.end();
      resolve({ ok: true, ms });
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: `timeout after ${timeoutMs}ms` });
    });
    socket.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

export async function collect({ now = Date.now(), fetchImpl = fetch } = {}) {
  if (ROLE === 'mariadb') {
    state.dbAttempts += 1;
    const tcp = await probeTcp(DB_HOST.replace(/:.*/, ''), DB_PORT);
    if (tcp.ok) {
      state.dbLastOkAt = new Date(now).toISOString();
      state.dbLastError = null;
      state.dbLastQueryMs = tcp.ms;
    } else {
      state.dbLastError = tcp.error;
    }
    return vitals({
      service: 'univ-wordpress-child-mariadb',
      startedAt,
      signals: {
        dbAttempts: state.dbAttempts,
        dbLastQueryMs: state.dbLastQueryMs,
        dbListenPort: DB_PORT,
      },
      checks: {
        database: {
          lastOkAgeSeconds: ageSeconds(state.dbLastOkAt, now),
          lastError: state.dbLastError,
          attempts: state.dbAttempts,
        },
      },
    }, now);
  }

  state.httpAttempts += 1;
  let httpStatus = null;
  try {
    const res = await fetchImpl(WP_URL, { signal: AbortSignal.timeout(2500), redirect: 'manual' });
    httpStatus = res.status;
    if (res.status < 500) state.httpLastOkAt = new Date(now).toISOString();
  } catch (err) {
    httpStatus = 0;
    state.httpLastError = err.message;
  }
  state.httpStatus = httpStatus;

  const disk = diskBytes(UPLOADS);
  const uploadsWritable = await writable(fs, UPLOADS).catch(() => ({
    path: UPLOADS, writable: false, reason: 'probe failed',
  }));

  return vitals({
    service: 'univ-wordpress-child-wordpress',
    startedAt,
    signals: {
      httpStatus,
      httpLastOkAgeSeconds: ageSeconds(state.httpLastOkAt, now),
      httpAttempts: state.httpAttempts,
      pluginDirCount: countPluginDirs(PLUGIN_DIR),
      wpVersion: readWpVersion(WP_VERSION_FILE),
      uploadsFreeBytes: disk.freeBytes,
      uploadsTotalBytes: disk.totalBytes,
    },
    checks: {
      uploads: {
        path: UPLOADS,
        writable: uploadsWritable.writable,
        reason: uploadsWritable.reason || null,
        freeBytes: disk.freeBytes,
      },
      database: {
        lastOkAgeSeconds: ageSeconds(state.dbLastOkAt, now),
        lastError: state.dbLastError,
        attempts: state.dbAttempts,
      },
    },
  }, now);
}

if (process.argv[1] && process.argv[1].endsWith('vitals-probe.mjs')) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && (url.pathname === '/api/vitals' || url.pathname === '/api/health')) {
      if (url.pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: `vitals-${ROLE}` }));
        return;
      }
      const body = await collect();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[vitals-probe] role=${ROLE} port=${PORT}`);
  });
}
