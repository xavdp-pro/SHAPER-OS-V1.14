import fs from 'node:fs';
import path from 'node:path';
import { kovzuDir, contextFilePath, hashContextFile } from './contextDigest.js';

const SESSION_FILE = 'session.json';

/** In-memory flag — restored from disk when API restarts. */
const bootstrapped = new Map();

function convKey(conversationId) {
  return String(conversationId || '').trim();
}

function sessionStatePath(workspaceCwd) {
  return path.join(kovzuDir(workspaceCwd), SESSION_FILE);
}

function readContextHash(workspaceCwd) {
  return hashContextFile(workspaceCwd);
}

function readSessionState(workspaceCwd) {
  try {
    const p = sessionStatePath(workspaceCwd);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeSessionState(workspaceCwd, state) {
  const dir = kovzuDir(workspaceCwd);
  fs.mkdirSync(dir, { recursive: true });
  const p = sessionStatePath(workspaceCwd);
  fs.writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

/**
 * @param {string} conversationId
 * @param {string} [workspaceCwd]
 */
export function isContextBootstrapped(conversationId, workspaceCwd = '') {
  const k = convKey(conversationId);
  if (!k) return false;
  if (bootstrapped.get(k)) return true;

  const cwd = String(workspaceCwd || '').trim();
  if (!cwd) return false;

  const state = readSessionState(cwd);
  if (!state?.bootstrapped) return false;
  if (state.conversation && state.conversation !== k) return false;
  if (state.contextHash && state.contextHash !== readContextHash(cwd)) return false;

  bootstrapped.set(k, true);
  return true;
}

export function markContextBootstrapped(conversationId, workspaceCwd = '', contextHash = '', locale = '') {
  const k = convKey(conversationId);
  if (!k) return;
  bootstrapped.set(k, true);

  const cwd = String(workspaceCwd || '').trim();
  if (!cwd) return;

  writeSessionState(cwd, {
    bootstrapped: true,
    conversation: k,
    contextHash: contextHash || readContextHash(cwd),
    contextLocale: String(locale || '').trim(),
    bootstrappedAt: new Date().toISOString(),
  });
}

/**
 * Language of the CONTEXT.md the session was bootstrapped with. Lean injects
 * carry no language rule, so a locale switch must be detected here or the model
 * keeps answering in the old one.
 * @returns {string} '' when unknown (pre-existing session)
 */
export function getContextLocale(conversationId, workspaceCwd = '') {
  const cwd = String(workspaceCwd || '').trim();
  if (!cwd) return '';
  const state = readSessionState(cwd);
  if (!state?.bootstrapped) return '';
  if (state.conversation && state.conversation !== convKey(conversationId)) return '';
  return String(state.contextLocale || '').trim();
}

/** Record the language actually injected, so the next turn can go lean again. */
export function noteContextLocale(conversationId, workspaceCwd = '', locale = '') {
  const cwd = String(workspaceCwd || '').trim();
  if (!cwd) return;
  const state = readSessionState(cwd);
  if (!state?.bootstrapped) return;
  writeSessionState(cwd, { ...state, contextLocale: String(locale || '').trim() });
}

export function clearContextBootstrap(conversationId, workspaceCwd = '') {
  const k = convKey(conversationId);
  if (k) bootstrapped.delete(k);

  const cwd = String(workspaceCwd || '').trim();
  if (!cwd) return;
  try {
    const p = sessionStatePath(cwd);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

export function getContextBootstrapState(conversationId, workspaceCwd = '') {
  const cwd = String(workspaceCwd || '').trim();
  const memory = bootstrapped.get(convKey(conversationId)) === true;
  const disk = cwd ? readSessionState(cwd) : null;
  const contextPath = cwd ? contextFilePath(cwd) : '';
  const contextExists = contextPath ? fs.existsSync(contextPath) : false;
  return {
    bootstrapped: isContextBootstrapped(conversationId, cwd),
    memory,
    disk,
    contextPath: contextExists ? contextPath : '',
    contextHash: disk?.contextHash || (cwd ? readContextHash(cwd) : ''),
  };
}
