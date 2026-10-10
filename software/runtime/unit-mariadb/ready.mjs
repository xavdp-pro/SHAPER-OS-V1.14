#!/usr/bin/env node
// Intent: software/runtime/unit-mariadb/INTENT.md
/**
 * The unit's readiness, gated on its MariaDB (Rule 26): run as root inside the
 * container (`podman healthcheck`, `podman exec <ctr> unit-ready`).
 *
 * Ready means all of: the supervisor finished birth and started the
 * application; the MariaDB process it started is alive, is mariadbd, runs as
 * the engine account, and answers the root path on the private socket with
 * networking disabled; the application process is alive as the unit account;
 * and, when UNIT_HEALTH_URL is set, the application answers it with 2xx.
 *
 * Prints one line; exit 0 when ready, 1 otherwise.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { STATE_DIR, readConfig, rootClientArgs, run } from './lib.mjs';

function processOf(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
    const uid = Number(/^Uid:\s+(\d+)/m.exec(status)[1]);
    return { comm, uid };
  } catch {
    return null;
  }
}

function get(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
  });
}

export async function readiness(env = process.env) {
  const config = readConfig(env);
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'state.json'), 'utf8'));
  } catch {
    return { ready: false, reason: 'the supervisor has not finished birth' };
  }
  const wanted = config.mode === 'database' ? 'database-only' : 'running';
  if (state.phase !== wanted) return { ready: false, reason: `supervisor phase is ${state.phase}, not ${wanted}` };

  const engine = processOf(state.enginePid);
  if (!engine || engine.comm !== 'mariadbd' || engine.uid !== config.engineUid) {
    return { ready: false, reason: `MariaDB pid ${state.enginePid} is not a running mariadbd as uid ${config.engineUid}` };
  }
  const probe = await run('mariadb', [...rootClientArgs(config.paths.socket), '-e', 'SELECT @@skip_networking'], {
    env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root' }, timeoutMs: 5000,
  });
  if (probe.code !== 0) return { ready: false, reason: 'MariaDB does not answer the root path on its socket' };
  if (probe.stdout.trim() !== '1') return { ready: false, reason: 'MariaDB has networking enabled' };

  if (wanted === 'running') {
    const app = processOf(state.appPid);
    if (!app || app.uid !== config.uid) return { ready: false, reason: `application pid ${state.appPid} is not running as uid ${config.uid}` };
    if (env.UNIT_HEALTH_URL) {
      const status = await get(env.UNIT_HEALTH_URL, 3000);
      if (status < 200 || status > 299) return { ready: false, reason: `${env.UNIT_HEALTH_URL} answered ${status || 'nothing'}` };
    }
  }
  return { ready: true, reason: `${config.slug}: MariaDB pid ${state.enginePid} (uid ${engine.uid}) and ${wanted === 'running' ? `application pid ${state.appPid}` : 'no application'} ready` };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  readiness().then(
    ({ ready, reason }) => { process.stdout.write(`${ready ? 'ready' : 'not ready'}: ${reason}\n`); process.exit(ready ? 0 : 1); },
    (err) => { process.stdout.write(`not ready: ${err.code || 'ERROR'} — ${err.message}\n`); process.exit(1); },
  );
}
