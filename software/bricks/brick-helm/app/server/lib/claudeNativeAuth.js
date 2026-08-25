import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '../..');

const CLAUDE_BIN = process.env.CLAUDE_NATIVE_BIN || '/opt/bridge/claude/bin/claude';
const CLAUDE_HOME = process.env.CLAUDE_NATIVE_HOME || '/apps/helm-v2';
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

const OAUTH_URL_RE = /https:\/\/claude\.com\/cai\/oauth\/authorize[^\s]+/;

/** @type {import('node:child_process').ChildProcess | null} */
let loginChild = null;
let loginStartedAt = 0;

function claudeEnv() {
  const env = {
    ...process.env,
    HOME: CLAUDE_HOME,
    PATH: `/opt/bridge/claude/bin:${process.env.PATH || ''}`,
  };
  for (const key of [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY',
  ]) {
    delete env[key];
  }
  return env;
}

function runClaude(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd: APP_ROOT,
      env: claudeEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    if (input) child.stdin.write(`${input}\n`);
    child.stdin.end();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `claude exit ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function getClaudeAuthStatus() {
  try {
    const { stdout } = await runClaude(['auth', 'status']);
    const data = JSON.parse(stdout.trim());
    return {
      loggedIn: Boolean(data.loggedIn),
      authMethod: data.authMethod || 'none',
      apiProvider: data.apiProvider || null,
      email: data.email || null,
      orgName: data.orgName || null,
      subscriptionType: data.subscriptionType || null,
    };
  } catch (err) {
    return { loggedIn: false, authMethod: 'none', error: err.message };
  }
}

function clearLoginChild() {
  if (loginChild) {
    try { loginChild.kill('SIGTERM'); } catch { /* ignore */ }
  }
  loginChild = null;
  loginStartedAt = 0;
}

export function cancelClaudeLogin() {
  clearLoginChild();
  return { ok: true };
}

/**
 * Start OAuth — returns URL for the browser tab. Keeps claude process alive
 * until completeClaudeLogin() sends the authorization code on stdin.
 */
export function startClaudeLogin() {
  if (loginChild) {
    if (Date.now() - loginStartedAt > LOGIN_TIMEOUT_MS) {
      clearLoginChild();
    } else {
      return Promise.reject(new Error('login_already_pending'));
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, ['auth', 'login', '--claudeai'], {
      cwd: APP_ROOT,
      env: claudeEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    loginChild = child;
    loginStartedAt = Date.now();

    let buffer = '';
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      if (err) {
        clearLoginChild();
        reject(err);
      } else {
        resolve(result);
      }
    };

    const onData = (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(OAUTH_URL_RE);
      if (match) finish(null, { url: match[0] });
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => finish(err));

    child.on('close', (code) => {
      if (!settled) {
        finish(new Error(buffer.trim() || `claude auth login exited (${code})`));
      }
    });

    setTimeout(() => {
      if (!settled) finish(new Error('login_url_timeout'));
    }, 45_000);
  });
}

/**
 * Submit OAuth code from the browser callback page.
 */
export function completeClaudeLogin(code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return Promise.reject(new Error('code_required'));
  if (!loginChild) return Promise.reject(new Error('no_pending_login'));

  const child = loginChild;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      clearLoginChild();
      reject(new Error('login_complete_timeout'));
    }, 60_000);

    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });

    child.on('close', async (exitCode) => {
      clearTimeout(timeout);
      loginChild = null;
      loginStartedAt = 0;
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || 'invalid_code'));
        return;
      }
      try {
        const status = await getClaudeAuthStatus();
        resolve({ ok: true, ...status });
      } catch (err) {
        reject(err);
      }
    });

    try {
      child.stdin.write(`${trimmed}\n`);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}
