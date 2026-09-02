#!/usr/bin/env node
/**
 * opencode-bridge — HTTP + SSE control of the OpenCode CLI in headless mode.
 *
 * Twin of cursor-agent-bridge, antigravity-bridge and claude-bridge, backend = `opencode`.
 * Unlike agy/cursor (one child process per run), OpenCode ships a headless server:
 * we spawn `opencode serve` once and translate its event stream into the shared contract.
 * That is what gives real token-level streaming (message.part.delta) instead of a
 * single blob at the end of the run.
 *
 * One conversation = one OpenCode session id (ses_*), kept in sessions.json.
 *
 *   GET  /api/health
 *   GET  /api/status
 *   GET  /api/conversations            -> { registered: [...] }
 *   POST /api/inject { conversation, message, model, attachments }
 *   GET  /api/events                   -> SSE (inject, thinking, tool, tool_complete,
 *                                              response, response_complete, run_complete)
 *   POST /api/conversations/delete { conversation }
 *   POST /api/conversations/stop { conversation?, all? }
 *   POST /api/conversations/reset { conversation }
 *   GET  /api/fs/list?path=/abs/path   -> directory listing for workspace picker
 *
 * API auth: Bearer token (~/.config/opencode-bridge/token, auto-created).
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  createRunState,
  splitModel,
  closeOpenTools as closeOpenToolsEvents,
  sessionIdOf,
  translateEvent,
} from './translate.mjs';
import { unwrapGlobalEvent, withDirectory } from './api-path.mjs';
import { opencodeBridgeVitals } from './vitals.mjs';

const PORT = Number(process.env.OPENCODE_BRIDGE_PORT || 4440);
const BIND = process.env.OPENCODE_BRIDGE_BIND || '127.0.0.1';
const CFG_DIR = path.join(os.homedir(), '.config/opencode-bridge');
const TOKEN_FILE = process.env.TOKEN_FILE || path.join(CFG_DIR, 'token');
const SESSIONS_FILE = process.env.SESSIONS_FILE || path.join(CFG_DIR, 'sessions.json');
const WS_BASE = process.env.OPENCODE_WS_BASE || path.join(os.homedir(), 'ws/opencode');
const OPT_BRIDGE_ROOT = process.env.OPT_BRIDGE_ROOT || '/opt/bridge';
const AGENT_BIN = process.env.OPENCODE_BIN || `${OPT_BRIDGE_ROOT}/opencode/bin/opencode`;
// Measured at deployment, never named here: the model pinned in this line had
// been withdrawn from the catalogue before a clean-sheet deployment reached it
// (Rule 7). Empty means not chosen — and, for the real bridge, a halt below.
const MODEL_ENV = 'OPENCODE_MODEL';
const MODEL = process.env[MODEL_ENV] || '';
/** Internal port of the headless `opencode serve` child (never exposed). */
const SERVE_PORT = Number(process.env.OPENCODE_SERVE_PORT || 4441);
const SERVE_URL = `http://127.0.0.1:${SERVE_PORT}`;
const STARTED_AT = Date.now();

const NONINTERACTIVE_ENV = {
  DEBIAN_FRONTEND: 'noninteractive',
  DEBIAN_PRIORITY: 'critical',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'true',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  SYSTEMD_PAGER: 'cat',
  LESS: '-FRX',
  PIP_NO_INPUT: '1',
  PIP_EXISTS_ACTION: 'w',
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
  NPM_CONFIG_YES: 'true',
  NPM_CONFIG_FUND: 'false',
  NPM_CONFIG_AUDIT: 'false',
  COMPOSER_NO_INTERACTION: '1',
  PYTHONUNBUFFERED: '1',
  CI: '1',
  NONINTERACTIVE: '1',
};

const AGENT_ENV = { ...process.env, ...NONINTERACTIVE_ENV };

const IS_STUB = process.env.BRIDGE_OPENCODE_STUB === '1';

// Rule 0J: a missing configuration halts and says what to provide. The brick
// image runs this file, and it used to start with an empty model — logging
// `model=` and handing every run to `opencode serve` with nothing to run it
// on — which is a warning where the law asks for a halt. The twin package
// pkg-bridge-opencode already refuses this way; the review of the Rule 7
// sweep found this server still starting. The halt fires before the token
// file is touched, so a refused start leaves nothing behind. Only the
// simulated bridge, which never spawns the CLI, runs without a model.
if (!IS_STUB && !MODEL) {
  console.error(`[opencode-bridge] HALT: ${MODEL_ENV} is not set and this bridge names no default model (Rule 7).`);
  console.error(`[opencode-bridge] Measure the engines reachable from this host, pick one, and export ${MODEL_ENV}=<model id> — or set BRIDGE_OPENCODE_STUB=1 for the simulated bridge.`);
  process.exit(2);
}

// The token and the session registry live under CFG_DIR, which nothing
// created: on a HOME the bridge had never seen, the first token write threw
// ENOENT out of its own catch block and the process died before listening
// (two reviewers read it; every test named TOKEN_FILE in a directory it had
// made). The directory is made before either file is written, whichever of
// the two the operator relocated. A directory that cannot be made (a HOME
// that is read-only, a parent the process may not enter) is the same halt as
// a missing model: exit 2 naming the path and the variable to relocate it —
// not an uncaught EACCES before the first log line (Rule 0J).
function ensureStateDirs() {
  for (const [file, variable] of [[TOKEN_FILE, 'TOKEN_FILE'], [SESSIONS_FILE, 'SESSIONS_FILE']]) {
    const dir = path.dirname(file);
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      console.error(`[opencode-bridge] HALT: cannot create ${dir} for ${variable}=${file} (${err.code || err.message}).`);
      console.error(`[opencode-bridge] Point ${variable} at a writable path, or mount a writable volume on ${dir}.`);
      process.exit(2);
    }
  }
}

function token() {
  ensureStateDirs();
  if (process.env.OPENCODE_BRIDGE_TOKEN || process.env.BRIDGE_AUTH_TOKEN) {
    const t = String(process.env.OPENCODE_BRIDGE_TOKEN || process.env.BRIDGE_AUTH_TOKEN).trim();
    try { fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 }); } catch {}
    return t;
  }
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); }
  catch {
    const t = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
    return t;
  }
}
const TOKEN = token();

function loadSessions() {
  try { const d = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); if (d && d.conversations) return d; }
  catch { /* absent */ }
  return { conversations: {} };
}
function saveSessions(d) {
  const tmp = `${SESSIONS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SESSIONS_FILE);
}
const normalizeName = (n) => String(n || '').trim();
const safeDir = (n) => normalizeName(n).replace(/[^a-zA-Z0-9._-]/g, '_') || 'default';

/**
 * Where the agent will work.
 *
 * A perimeter given with the request wins over the conversation's usual
 * workspace: it is the caller bounding this run, and the frame in the prompt
 * says the same thing. Stating a perimeter and then working elsewhere would
 * make the instruction a decoration.
 *
 * opencode has no flag equivalent to agy's `--add-dir`, so the working
 * directory is the containment available here — weaker, since an absolute path
 * still reaches out, and worth knowing when choosing which agent gets a task.
 */
function resolveWorkspace(name, entry, perimeter = null) {
  if (perimeter && fs.existsSync(perimeter)) return path.resolve(perimeter);
  const custom = entry && entry.workspace;
  if (custom && fs.existsSync(custom)) return path.resolve(custom);
  const cwd = path.join(WS_BASE, safeDir(name));
  fs.mkdirSync(cwd, { recursive: true });
  return cwd;
}

function getChatId(name) {
  const reg = loadSessions();
  const e = reg.conversations[normalizeName(name)];
  return (e && e.chat_id) || null;
}
function setChatId(name, id) {
  const conv = normalizeName(name);
  const reg = loadSessions();
  if (!reg.conversations[conv]) reg.conversations[conv] = {};
  reg.conversations[conv].chat_id = id;
  reg.conversations[conv].last_used_at = new Date().toISOString();
  saveSessions(reg);
}

const clients = new Map();
/** conversation -> { runId, seq } while a run is live. */
const liveRuns = new Map();
/** sessionID -> conversation name, for routing the shared event stream. */
const sessionToConv = new Map();
/** sessionID -> run state (text accumulation, part typing, tool bookkeeping). */
const runStates = new Map();

function beginRunContract(conv) {
  const entry = { runId: crypto.randomUUID(), seq: 0 };
  liveRuns.set(conv, entry);
  return entry.runId;
}
function endRunContract(conv, runId) {
  const entry = liveRuns.get(conv);
  if (entry && entry.runId === runId) liveRuns.delete(conv);
}

function broadcast(event) {
  const conv = event.conversation || '';
  let out = event;
  const live = conv ? liveRuns.get(conv) : null;
  if (live && !out.run_id) out = { ...out, run_id: live.runId, seq: live.seq++ };
  const line = `data: ${JSON.stringify(out)}\n\n`;
  for (const [res, filter] of clients) {
    if (filter && conv && filter !== conv) continue;
    try { res.write(line); } catch { /* */ }
  }
}

function attachmentsDir(name) {
  return path.join(WS_BASE, safeDir(name), '_attachments');
}
function saveAttachment(name, filename, data) {
  const dir = attachmentsDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(filename || `file-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const b64 = String(data || '').replace(/^data:[^;]+;base64,/, '');
  const abs = path.join(dir, safe);
  fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
  return { abs, rel: path.join('_attachments', safe) };
}
function withAttachments(message, attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return message;
  const list = attachments.map((a) => `- ${a}`).join('\n');
  return `Pièces jointes à analyser (dans le dossier courant) :\n${list}\n\n${message}`;
}

/* ------------------------------------------------------------------ *
 * Headless `opencode serve` child — spawned once, restarted if it dies.
 * ------------------------------------------------------------------ */

let serveChild = null;
let serveReady = false;

async function serveFetch(pathname, init = {}) {
  // `opencode serve` binds its port before finishing init: it accepts the
  // connection but may not answer for several seconds. Without a deadline the
  // request hangs forever and readiness never resolves.
  const { timeout = 15000, ...rest } = init;
  const res = await fetch(`${SERVE_URL}${pathname}`, {
    ...rest,
    signal: AbortSignal.timeout(timeout),
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`opencode serve ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

async function waitForServe(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await serveFetch('/global/health', { timeout: 3000 });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return false;
}

function ensureOpencodeConfig() {
  try {
    const configDir = path.join(os.homedir(), '.config/opencode');
    fs.mkdirSync(configDir, { recursive: true });
    const configFile = path.join(configDir, 'opencode.json');
    let cfg = {};
    if (fs.existsSync(configFile)) {
      try { cfg = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch {}
    }
    cfg.permission = {
      bash: 'allow',
      edit: 'allow',
      write: 'allow',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      ...(cfg.permission || {}),
    };
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('[opencode-bridge] Failed to ensure opencode config:', err.message);
  }
}

function startServe() {
  if (IS_STUB) {
    serveReady = true;
    console.log('[opencode-bridge] STUB mode enabled — simulated agent active');
    return;
  }
  if (serveChild) return;
  ensureOpencodeConfig();
  serveChild = spawn(
    AGENT_BIN,
    ['serve', '--port', String(SERVE_PORT), '--hostname', '127.0.0.1'],
    { cwd: WS_BASE, env: AGENT_ENV, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Rule 0J: a CLI that cannot be started is a halt that names what to
  // supply. Without this listener an absent OPENCODE_BIN was an uncaught
  // 'error' event — a stack trace after /api/health had already answered —
  // and the 'close' that follows it would have retried the same absent
  // binary every three seconds. Nothing a retry can fix: the process exits
  // with the same code as the missing-model halt, before 'close' runs.
  serveChild.on('error', (err) => {
    console.error(`[opencode-bridge] HALT: cannot start the OpenCode CLI at ${AGENT_BIN} (${err.code || err.message}).`);
    console.error('[opencode-bridge] Set OPENCODE_BIN to the CLI the image carries (or OPT_BRIDGE_ROOT to its root) — or set BRIDGE_OPENCODE_STUB=1 for the simulated bridge.');
    process.exit(2);
  });
  serveChild.stdout.on('data', (d) => {
    const s = d.toString().trim();
    if (s) console.log(`[opencode serve] ${s.slice(0, 300)}`);
  });
  serveChild.stderr.on('data', (d) => {
    const s = d.toString().trim();
    if (s) console.error(`[opencode serve] ${s.slice(0, 300)}`);
  });
  serveChild.on('close', (code) => {
    console.error(`[opencode-bridge] serve exited (code=${code}) — restarting in 3s`);
    serveChild = null;
    serveReady = false;
    setTimeout(startServe, 3000);
  });

  waitForServe().then((ok) => {
    serveReady = ok;
    if (!ok) {
      console.error('[opencode-bridge] serve did not become ready in time');
      return;
    }
    console.log(`[opencode-bridge] serve ready on ${SERVE_URL}`);
    subscribeEvents();
  });
}

/* ------------------------------------------------------------------ *
 * Event translation: OpenCode stream -> shared bridge contract.
 * The mapping itself lives in translate.mjs (pure, unit-tested); here we only
 * resolve which conversation an event belongs to and broadcast the result.
 * ------------------------------------------------------------------ */

function stateFor(sessionID) {
  let st = runStates.get(sessionID);
  if (!st) {
    st = createRunState();
    runStates.set(sessionID, st);
  }
  return st;
}

function closeOpenTools(conv, st, sessionID) {
  for (const event of closeOpenToolsEvents(conv, st, sessionID)) broadcast(event);
}

function handleServeEvent(evt) {
  const sessionID = sessionIdOf(evt);
  if (!sessionID) return;
  const conv = sessionToConv.get(sessionID);
  if (!conv) return; // not one of ours
  const st = stateFor(sessionID);
  const wasRunning = st.running;

  for (const event of translateEvent(evt, { state: st, conversation: conv })) {
    broadcast(event);
  }

  // The run just ended: release the run contract and the per-session state.
  if (wasRunning && !st.running) {
    const live = liveRuns.get(conv);
    if (live) endRunContract(conv, live.runId);
    runStates.delete(sessionID);
  }
}

let eventAbort = null;

async function subscribeEvents() {
  if (eventAbort) eventAbort.abort();
  const ctrl = new AbortController();
  eventAbort = ctrl;
  try {
    // Sessions may run in different perimeter directories. `/event` is scoped
    // to one directory; `/global/event` carries all of them under `payload`.
    const res = await fetch(`${SERVE_URL}/global/event`, { signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`event stream ${res.status}`);
    let buf = '';
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        let evt;
        try { evt = unwrapGlobalEvent(JSON.parse(line.slice(5))); } catch { continue; }
        try { handleServeEvent(evt); } catch (err) {
          console.error('[opencode-bridge] event handler:', err.message);
        }
      }
    }
  } catch (err) {
    if (ctrl.signal.aborted) return;
    console.error('[opencode-bridge] event stream lost:', err.message);
  }
  if (!ctrl.signal.aborted) setTimeout(subscribeEvents, 2000);
}

/* ------------------------------------------------------------------ *
 * Run lifecycle.
 * ------------------------------------------------------------------ */

async function ensureSession(name, cwd, model) {
  const existing = getChatId(name);
  if (existing) {
    // Confirm it still exists server-side; a restarted serve may have dropped it.
    try {
      await serveFetch(withDirectory(`/session/${existing}`, cwd));
      return existing;
    } catch {
      setChatId(name, null);
    }
  }
  const created = await serveFetch(withDirectory('/session', cwd), {
    method: 'POST',
    body: JSON.stringify({ title: name }),
  });
  const id = created?.id;
  if (!id) throw new Error('session creation returned no id');
  setChatId(name, id);
  return id;
}

async function runAgent(name, message, opts = {}) {
  const conv = normalizeName(name);

  if (IS_STUB) {
    const runId = beginRunContract(conv);
    const sessionID = `ses_stub_${Date.now()}`;
    sessionToConv.set(sessionID, conv);
    const st = stateFor(sessionID);
    st.fullText = '';
    st.running = true;

    setTimeout(() => {
      broadcast({ type: 'thinking', conversation: conv, composer_id: sessionID, delta: 'Analyse du contexte et initialisation...' });
      setTimeout(() => {
        const reply = message.includes('bonjour') || message.includes('Bonjour') || message.includes('Zephir') || message.includes('Salue')
          ? 'Bonjour ! Je suis Zephir sur KovZu, votre copilote opérationnel prêt à piloter vos dossiers et exécuter vos tâches en toute souveraineté.'
          : `Requête prise en compte avec succès : ${message.slice(0, 100)}`;
        st.fullText = reply;
        broadcast({ type: 'response', conversation: conv, composer_id: sessionID, delta: reply, text: reply });
        broadcast({ type: 'response_complete', conversation: conv, composer_id: sessionID, chat_id: sessionID, text: reply, exit: 0 });
        broadcast({ type: 'run_complete', conversation: conv, composer_id: sessionID });
        st.running = false;
        endRunContract(conv, runId);
      }, 250);
    }, 100);

    return { chatId: sessionID, runId };
  }

  if (!serveReady) throw new Error('opencode serve not ready');

  const reg = loadSessions();
  const entry = reg.conversations[conv];
  const cwd = resolveWorkspace(conv, entry, opts.perimeter || null);
  const model = splitModel(opts.model, MODEL);
  const sessionID = await ensureSession(conv, cwd, model);

  // Replace any run still in flight on this conversation.
  if (runStates.get(sessionID)?.running) {
    await stopAgent(conv, { reason: 'replaced' });
  }

  const runId = beginRunContract(conv);
  sessionToConv.set(sessionID, conv);
  const st = stateFor(sessionID);
  st.fullText = '';
  st.running = true;

  reg.conversations[conv] = {
    ...(entry || {}),
    chat_id: sessionID,
    cwd,
    title: (entry && entry.title) || conv,
    started: true,
    created_at: (entry && entry.created_at) || new Date().toISOString(),
    last_used_at: new Date().toISOString(),
  };
  saveSessions(reg);

  // prompt_async returns immediately; the reply arrives on the event stream.
  try {
    await serveFetch(withDirectory(`/session/${sessionID}/prompt_async`, cwd), {
      method: 'POST',
      body: JSON.stringify({
        model,
        parts: [{ type: 'text', text: message }],
      }),
    });
  } catch (err) {
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('compact') || msg.includes('too large') || msg.includes('limit') || msg.includes('context') || msg.includes('400')) {
      console.warn(`[opencode-bridge] Session ${sessionID} saturated (${err.message}) — creating fresh session for ${conv}`);
      sessionToConv.delete(sessionID);
      runStates.delete(sessionID);
      setChatId(conv, null);
      const freshSessionID = await ensureSession(conv, cwd, model);
      sessionToConv.set(freshSessionID, conv);
      const freshSt = stateFor(freshSessionID);
      freshSt.fullText = '';
      freshSt.running = true;

      await serveFetch(withDirectory(`/session/${freshSessionID}/prompt_async`, cwd), {
        method: 'POST',
        body: JSON.stringify({
          model,
          parts: [{ type: 'text', text: message }],
        }),
      });
      return { chatId: freshSessionID, runId };
    }
    throw err;
  }

  return { chatId: sessionID, runId };
}

async function stopAgent(name, { reason = 'stopped' } = {}) {
  const targets = name
    ? [normalizeName(name)]
    : [...sessionToConv.values()];
  let stopped = 0;
  for (const conv of new Set(targets)) {
    const sessionID = getChatId(conv);
    if (!sessionID) continue;
    const st = runStates.get(sessionID);
    if (!st?.running) continue;
    const entry = loadSessions().conversations[conv];
    const cwd = resolveWorkspace(conv, entry);
    try {
      await serveFetch(withDirectory(`/session/${sessionID}/abort`, cwd), { method: 'POST' });
      stopped += 1;
    } catch (err) {
      console.error(`[opencode-bridge] abort ${conv}:`, err.message);
    }
    st.running = false;
    closeOpenTools(conv, st, sessionID);
    broadcast({ type: 'run_aborted', conversation: conv, composer_id: sessionID, reason });
    const live = liveRuns.get(conv);
    if (live) endRunContract(conv, live.runId);
    runStates.delete(sessionID);
  }
  return stopped;
}

/* ------------------------------------------------------------------ *
 * HTTP surface.
 * ------------------------------------------------------------------ */

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}
const authed = (req) => (req.headers.authorization || '') === `Bearer ${TOKEN}`;
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (p === '/api/health') return send(res, 200, { ok: true, service: 'brick-bridge-opencode', port: PORT });
  if (!authed(req)) return send(res, 401, { ok: false, error: 'Unauthorized' });

  if (p === '/api/status') {
    return send(res, 200, {
      ok: true,
      ready: serveReady,
      service: 'brick-bridge-opencode',
      registry: SESSIONS_FILE,
      ws_base: WS_BASE,
      port: PORT,
      serve_url: SERVE_URL,
      model: MODEL,
    });
  }
  if (p === '/api/vitals') {
    const conversations = Object.keys(loadSessions().conversations).length;
    return send(res, 200, opencodeBridgeVitals({
      startedAt: STARTED_AT,
      ready: serveReady,
      model: MODEL,
      stub: IS_STUB,
      conversations,
      activeRuns: liveRuns.size,
      eventClients: clients.size,
      servePid: serveChild?.pid || null,
    }));
  }
  if (p === '/api/conversations') {
    const reg = loadSessions();
    const registered = Object.entries(reg.conversations).map(([name, e]) => ({
      name,
      title: e.title || name,
      chat_id: e.chat_id || null,
      resumed: Boolean(e.chat_id),
      cwd: e.cwd || resolveWorkspace(name, e),
      workspace: e.workspace || null,
      created_at: e.created_at,
      last_used_at: e.last_used_at,
    }));
    return send(res, 200, { ok: true, registered });
  }
  if (p === '/api/events') {
    const filter = normalizeName(url.searchParams.get('conversation'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'connected', filter: filter || null })}\n\n`);
    clients.set(res, filter);
    const ping = setInterval(() => {
      try { res.write(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`); } catch { /* */ }
    }, 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (p === '/api/upload' && req.method === 'POST') {
    const body = await readBody(req);
    const name = normalizeName(body.conversation);
    if (!name) return send(res, 400, { ok: false, error: 'conversation requise' });
    if (!body.data) return send(res, 400, { ok: false, error: 'data (base64) requis' });
    try {
      const saved = saveAttachment(name, body.filename, body.data);
      return send(res, 200, { ok: true, ...saved });
    } catch (err) {
      return send(res, 500, { ok: false, error: String(err) });
    }
  }

  if ((p === '/api/inject' || p === '/api/conversations/inject') && req.method === 'POST') {
    const body = await readBody(req);
    const name = normalizeName(body.conversation);
    const message = withAttachments(String(body.message || '').trim(), body.attachments);
    const model = String(body.model || '').trim() || undefined;
    if (!name) return send(res, 400, { ok: false, error: 'conversation requise' });
    if (!message) return send(res, 400, { ok: false, error: 'message vide' });
    const id = `inject-${Date.now()}`;
    try {
      const { chatId, runId } = await runAgent(name, message, { model, perimeter: body.perimeter || null });
      broadcast({
        type: 'inject', ok: true, id, conversation: name, chat_id: chatId,
        run_id: runId, model: model || MODEL,
      });
      return send(res, 200, {
        ok: true, id, conversation: name, chat_id: chatId, composer_id: chatId,
        run_id: runId, model: model || MODEL,
      });
    } catch (err) {
      return send(res, 502, { ok: false, error: String(err.message || err), id });
    }
  }
  if (p === '/api/conversations/delete' && req.method === 'POST') {
    const body = await readBody(req);
    const name = normalizeName(body.conversation);
    const reg = loadSessions();
    if (reg.conversations[name]) { delete reg.conversations[name]; saveSessions(reg); }
    return send(res, 200, { ok: true, conversation: name });
  }
  if (p === '/api/conversations/stop' && req.method === 'POST') {
    const body = await readBody(req);
    const all = Boolean(body.all);
    const name = normalizeName(body.conversation);
    if (!all && !name) {
      return send(res, 400, { ok: false, error: 'conversation ou all:true requis' });
    }
    const stopped = await stopAgent(all ? null : name, { reason: 'stopped' });
    return send(res, 200, { ok: true, stopped, conversation: all ? null : name, all });
  }
  if (p === '/api/conversations/reset' && req.method === 'POST') {
    const body = await readBody(req);
    const name = normalizeName(body.conversation);
    if (!name) return send(res, 400, { ok: false, error: 'conversation requise' });
    const reg = loadSessions();
    const entry = reg.conversations[name] || {};
    const old = entry.chat_id;
    if (old) sessionToConv.delete(old);
    const cwd = resolveWorkspace(name, entry);
    reg.conversations[name] = {
      ...entry,
      chat_id: null,
      cwd,
      workspace: entry.workspace || null,
      title: entry.title || name,
      created_at: entry.created_at || new Date().toISOString(),
      reset_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
    };
    saveSessions(reg);
    return send(res, 200, { ok: true, conversation: name, resumed: false });
  }
  if (p === '/api/fs/list' && req.method === 'GET') {
    const rawPath = String(url.searchParams.get('path') || '/').trim() || '/';
    if (!rawPath.startsWith('/')) {
      return send(res, 400, { ok: false, error: 'chemin absolu requis' });
    }
    const absPath = path.posix.normalize(rawPath.replace(/\\/g, '/'));
    if (absPath.includes('..')) {
      return send(res, 400, { ok: false, error: 'chemin invalide' });
    }
    if (!fs.existsSync(absPath)) {
      return send(res, 404, { ok: false, error: `Dossier introuvable: ${absPath}` });
    }
    if (!fs.statSync(absPath).isDirectory()) {
      return send(res, 400, { ok: false, error: 'Pas un dossier' });
    }
    const entries = fs.readdirSync(absPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.posix.join(absPath, e.name), dir: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return send(res, 200, {
      ok: true,
      path: absPath,
      parent: absPath === '/' ? null : path.posix.dirname(absPath),
      entries,
    });
  }
  return send(res, 404, { ok: false, error: `route inconnue: ${p}` });
});

process.on('SIGTERM', () => { try { serveChild?.kill('SIGTERM'); } catch { /* */ } process.exit(0); });
process.on('SIGINT', () => { try { serveChild?.kill('SIGTERM'); } catch { /* */ } process.exit(0); });

server.listen(PORT, BIND, () => {
  console.log(`[opencode-bridge] http://${BIND}:${PORT}  sessions=${SESSIONS_FILE}  model=${MODEL}`);
  startServe();
});
