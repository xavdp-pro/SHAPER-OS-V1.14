import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '../..');
const CLAUDE_HOME = process.env.CLAUDE_NATIVE_HOME || '/apps/helm-v2';
const CLAUDE_BIN = process.env.CLAUDE_NATIVE_BIN || '/opt/bridge/claude/bin/claude';
const LOG_DIR = path.join(CLAUDE_HOME, 'log');
const LOG_FILE = path.join(LOG_DIR, 'claude-remote-control.log');
const STATE_FILE = path.join(LOG_DIR, 'claude-remote-control.json');
const PID_FILE = path.join(LOG_DIR, 'claude-remote-control.pid');

export const SESSION_NAME = process.env.CLAUDE_RC_NAME || 'KovZu — helm-v2';

function claudeEnv() {
  const env = {
    ...process.env,
    HOME: CLAUDE_HOME,
    PATH: `/opt/bridge/claude/bin:${process.env.PATH || ''}`,
    CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX: process.env.CLAUDE_RC_PREFIX || 'kovzu',
  };
  for (const key of [
    'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL',
    'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY',
  ]) {
    delete env[key];
  }
  return env;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(data) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(data, null, 2)}\n`);
}

function parseSessionUrl(text) {
  const m = String(text || '').match(/https:\/\/claude\.ai\/code[^\s)\]"']*/);
  return m ? m[0] : '';
}

function readLogTail() {
  try {
    return fs.readFileSync(LOG_FILE, 'utf8');
  } catch {
    return '';
  }
}

function parseStartupError(text) {
  const t = String(text || '');
  if (/error:\s*unknown option/i.test(t)) return 'unknown CLI option';
  if (/Error:\s*Unknown argument/i.test(t)) return 'invalid CLI arguments';
  if (/not logged in|login required/i.test(t)) return 'Claude not logged in';
  if (/subscription/i.test(t) && /required|need/i.test(t)) return 'subscription required';
  return '';
}

const MODEL_ALIASES = {
  sonnet: 'sonnet',
  opus: 'opus',
  haiku: 'haiku',
};

function syncProjectModel(model) {
  const alias = MODEL_ALIASES[String(model || 'sonnet').toLowerCase()] || 'sonnet';
  const settingsPath = path.join(APP_ROOT, '.claude', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    settings = {};
  }
  if (settings.model === alias) return;
  settings.model = alias;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function waitForStartup(pid, timeoutMs = 45_000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const text = readLogTail();
      const url = parseSessionUrl(text);
      const err = parseStartupError(text);
      if (err) {
        resolve({ ok: false, error: err, url: '', log: text });
        return;
      }
      if (url || /Ready ·/i.test(text)) {
        resolve({ ok: true, url: url || 'https://claude.ai/code', log: text });
        return;
      }
      if (!isRunning(pid)) {
        resolve({ ok: false, error: 'process exited', url: '', log: text });
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve({ ok: false, error: 'timeout waiting for session', url: '', log: text });
        return;
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

export function ensureWorkspaceTrust() {
  const cfgPath = path.join(CLAUDE_HOME, '.claude.json');
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    cfg = {};
  }
  cfg.projects = cfg.projects || {};
  const proj = cfg.projects[APP_ROOT] || {};
  if (proj.hasTrustDialogAccepted === true) return;
  cfg.projects[APP_ROOT] = { ...proj, hasTrustDialogAccepted: true };
  fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getRemoteControlStatus() {
  const state = readState() || {};
  let pid = state.pid;
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    if (raw) pid = Number(raw);
  } catch { /* ignore */ }

  const running = isRunning(pid);
  return {
    running,
    sessionName: state.sessionName || SESSION_NAME,
    url: state.url || 'https://claude.ai/code',
    model: state.model || 'sonnet',
    startedAt: state.startedAt || null,
    pid: running ? pid : null,
  };
}

function waitForUrl(timeoutMs = 45_000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const url = parseSessionUrl(readLogTail());
      if (url) {
        resolve(url);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve('');
        return;
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

function normalizeSessionName(raw) {
  const name = String(raw || '').trim().slice(0, 80);
  return name || SESSION_NAME;
}

export async function startRemoteControl({ model = 'sonnet', sessionName: rawName } = {}) {
  ensureWorkspaceTrust();
  const sessionName = normalizeSessionName(rawName);
  const modelKey = String(model || 'sonnet').toLowerCase();

  const existing = getRemoteControlStatus();
  if (existing.running) {
    if (existing.sessionName === sessionName) {
      return { ok: true, ...existing, alreadyRunning: true };
    }
    stopRemoteControl();
  }

  syncProjectModel(modelKey);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, '');

  const args = [
    'remote-control',
    '--name', sessionName,
    '--create-session-in-dir',
  ];

  const child = spawn(CLAUDE_BIN, args, {
    cwd: APP_ROOT,
    env: claudeEnv(),
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  try {
    child.stdin.write('y\n');
    child.stdin.end();
  } catch { /* ignore */ }
  child.unref();

  fs.writeFileSync(PID_FILE, String(child.pid));

  const startup = await waitForStartup(child.pid);
  if (!startup.ok) {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* ignore */ }
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    writeState({
      running: false,
      sessionName,
      model: modelKey,
      error: startup.error,
      logTail: startup.log.slice(-500),
      failedAt: new Date().toISOString(),
    });
    return {
      ok: false,
      error: `Remote Control failed: ${startup.error}`,
      sessionName,
      model: modelKey,
    };
  }

  const url = startup.url || await waitForUrl(10_000);
  const state = {
    pid: child.pid,
    sessionName,
    model: modelKey,
    url: url || 'https://claude.ai/code',
    startedAt: new Date().toISOString(),
  };
  writeState(state);

  return {
    ok: true,
    running: isRunning(child.pid),
    ...state,
    alreadyRunning: false,
    hint: 'Look for this session in the Claude app → Code tab (computer icon + green dot).',
  };
}

export function stopRemoteControl() {
  const status = getRemoteControlStatus();
  if (status.pid) {
    try { process.kill(status.pid, 'SIGTERM'); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  writeState({ ...status, running: false, pid: null, stoppedAt: new Date().toISOString() });
  return { ok: true, stopped: true };
}
