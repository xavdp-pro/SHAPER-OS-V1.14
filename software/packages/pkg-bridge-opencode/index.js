/**
 * @package @shaper/pkg-bridge-opencode
 * HTTP/SSE bridge for OpenCode CLI — free default model.
 */
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vitals, ageSeconds, cliCheck, writable } from '../pkg-logger/vitals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * No model is named here. The one that used to be pinned had been withdrawn from
 * the catalogue by the time a clean-sheet deployment tried to use it, while the
 * test suite still asserted its name and stayed green. A default that expires
 * without failing is worse than no default.
 *
 * The model is measured at deployment and supplied through OPENCODE_MODEL
 * (Rule 7). An empty value means "not chosen yet", and that is reported rather
 * than replaced by a guess.
 *
 * Reported — and, for a real bridge, refused. Until the Rule 7 sweep a bridge
 * with no model still started and would have spawned the CLI with `-m ''`,
 * failing later with a message about the wrong thing. Now a missing model halts
 * at start-up and names the variable to provide (Rule 0J); only the simulated
 * bridge (stub mode), which never spawns the CLI, runs without one.
 */
export const OPENCODE_MODEL_ENV = 'OPENCODE_MODEL';
export const FREE_MODEL = process.env.OPENCODE_MODEL || '';

export function resolveOpencodeModel(env = process.env) {
  return String(env[OPENCODE_MODEL_ENV] || '').trim();
}

export class ModelUnsetError extends Error {
  constructor(envVar = OPENCODE_MODEL_ENV) {
    super(`bridge-opencode: no model is set — this bridge names no default (Rule 7). `
      + `Measure the engines reachable from this host, pick one, and export ${envVar}=<model id>; `
      + 'set BRIDGE_OPENCODE_STUB=1 to run the simulated bridge instead.');
    this.name = 'ModelUnsetError';
    this.code = 'BRIDGE_MODEL_UNSET';
    this.envVar = envVar;
  }
}

export function normalizeConversationName(name) {
  if (!name || typeof name !== 'string') return 'default';
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return clean || 'default';
}

export function formatSseEvent(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function buildOpencodeSpawnEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.ANTIGRAVITY_API_KEY;
  delete env.AGY_API_KEY;
  return env;
}

export class OpencodeBridgeServer {
  constructor({
    port = 4440,
    bind = '0.0.0.0',
    opencodeBin = process.env.OPENCODE_BIN || 'opencode',
    defaultModel = resolveOpencodeModel(process.env) || FREE_MODEL,
    workspaceBase = '/tmp/opencode-workspaces',
    authToken = '',
    stubMode = process.env.BRIDGE_OPENCODE_STUB === '1',
  } = {}) {
    this.port = port;
    this.bind = bind;
    this.opencodeBin = opencodeBin;
    this.stubMode = stubMode;
    // An empty model is reported as absent, never carried as '' into a CLI
    // argument where it would fail with a message about the wrong thing. The
    // same shape as the three other bridges: the first sweep left this one
    // reporting '' while they reported null, and a health check comparing
    // bridges had to know which one it was reading.
    this.defaultModel = String(defaultModel || '').trim() || null;
    if (!this.stubMode && !this.defaultModel) throw new ModelUnsetError();
    this.workspaceBase = workspaceBase;
    this.authToken = authToken;
    this.clients = new Map();
    this.runningProcesses = new Map();
    this.metrics = { injects: 0, completions: 0, errors: 0 };
    this.startedAt = new Date().toISOString();
    fs.mkdirSync(this.workspaceBase, { recursive: true });
  }

  async vitals(now = Date.now()) {
    const wsCheck = await writable(fs, this.workspaceBase);
    const cliInfo = cliCheck(execFileSync, this.opencodeBin, ['--version']);
    return vitals({
      service: 'brick-bridge-opencode',
      startedAt: this.startedAt,
      signals: {
        injects: this.metrics.injects,
        completions: this.metrics.completions,
        errors: this.metrics.errors,
        runsInFlight: this.runningProcesses.size,
        model: this.defaultModel,
        freeTier: true,
        stubMode: this.stubMode,
        cli: cliInfo,
      },
      checks: {
        workspace: wsCheck,
      },
    }, now);
  }

  ensureWorkspace(conversationName) {
    const conv = normalizeConversationName(conversationName);
    const wsPath = path.join(this.workspaceBase, conv);
    fs.mkdirSync(wsPath, { recursive: true });
    return wsPath;
  }

  broadcast(obj, filterConv = null) {
    const line = formatSseEvent(obj);
    for (const [res, clientFilter] of this.clients.entries()) {
      if (filterConv && clientFilter && clientFilter !== filterConv) continue;
      try { res.write(line); } catch { /* closed */ }
    }
  }

  buildContextualPrompt(userPrompt, { contextFile = null, contextText = null } = {}) {
    let finalPrompt = '';
    if (contextFile && fs.existsSync(contextFile)) {
      finalPrompt += `[BUSINESS CONTEXT (${path.basename(contextFile)})]\n${fs.readFileSync(contextFile, 'utf8')}\n\n`;
    }
    if (contextText) finalPrompt += `[INSTRUCTIONS]\n${contextText}\n\n`;
    finalPrompt += `[USER REQUEST]\n${userPrompt}`;
    return finalPrompt;
  }

  runAgentStub(conv, runId) {
    setTimeout(() => {
      this.broadcast({ type: 'text_delta', conversation: conv, run_id: runId, text: 'STUB: opencode free OK' }, conv);
      this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: 0, stub: true }, conv);
      this.metrics.completions++;
    }, 10);
    return { runId, cwd: this.ensureWorkspace(conv), model: this.defaultModel, stub: true };
  }

  runAgent(conversationName, prompt, opts = {}) {
    const conv = normalizeConversationName(conversationName);
    const cwd = this.ensureWorkspace(conv);
    const runId = `run-oc-${Date.now()}`;
    const model = opts.model || this.defaultModel;
    // The constructor already refused a real bridge without a model; this keeps
    // a later mutation from reaching the CLI as `-m ''`.
    if (!this.stubMode && !model) throw new ModelUnsetError();
    const fullPrompt = this.buildContextualPrompt(prompt, {
      contextFile: opts.contextFile || null,
      contextText: opts.contextText || null,
    });

    this.broadcast({ type: 'start', conversation: conv, run_id: runId, model }, conv);

    if (this.stubMode) {
      return this.runAgentStub(conv, runId);
    }

    const args = [
      'run', fullPrompt,
      '--auto',
      '--format', 'json',
      '-m', model,
    ];

    const proc = spawn(this.opencodeBin, args, {
      cwd,
      env: buildOpencodeSpawnEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.runningProcesses.set(conv, proc);

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.broadcast({ type: 'agent_event', conversation: conv, run_id: runId, raw: JSON.parse(line) }, conv);
        } catch {
          this.broadcast({ type: 'text_delta', conversation: conv, run_id: runId, text: line }, conv);
        }
      }
    });
    proc.stderr.on('data', (chunk) => {
      this.broadcast({ type: 'log', conversation: conv, run_id: runId, text: chunk.toString('utf8') }, conv);
    });
    proc.on('close', (code) => {
      this.runningProcesses.delete(conv);
      if (code === 0) this.metrics.completions++;
      else this.metrics.errors++;
      this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: code }, conv);
    });

    return { runId, cwd, model };
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const p = url.pathname;

      if (p === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          service: 'brick-bridge-opencode',
          port: this.port,
          model: this.defaultModel,
          stubMode: this.stubMode,
          freeTier: true,
        }));
        return;
      }

      if (p === '/api/vitals' || p === '/vitals') {
        const v = await this.vitals();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(v));
        return;
      }

      if (p === '/api/metrics') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          service: 'brick-bridge-opencode',
          metrics: this.metrics,
          running: this.runningProcesses.size,
        }));
        return;
      }

      if (this.authToken) {
        const auth = req.headers.authorization || '';
        const token = auth.replace(/^Bearer\s+/i, '').trim();
        if (token !== this.authToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
          return;
        }
      }

      if (p === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(formatSseEvent({ type: 'connected' }));
        this.clients.set(res, normalizeConversationName(url.searchParams.get('conversation')) || null);
        req.on('close', () => this.clients.delete(res));
        return;
      }

      if (p === '/api/inject' && req.method === 'POST') {
        let bodyText = '';
        for await (const chunk of req) bodyText += chunk;
        try {
          const body = JSON.parse(bodyText || '{}');
          const conv = normalizeConversationName(body.conversation);
          const message = String(body.message || '').trim();
          if (!message && !body.context_file) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'message or context_file required' }));
            return;
          }
          const result = this.runAgent(conv, message, {
            contextFile: body.context_file || null,
            contextText: body.context || null,
            model: body.model || null,
          });
          this.metrics.injects++;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, conversation: conv, ...result }));
        } catch (err) {
          this.metrics.errors++;
          // A missing model is a configuration state, not a server fault: say
          // so with a typed code the caller can act on.
          const status = err.code === 'BRIDGE_MODEL_UNSET' ? 503 : 500;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message, code: err.code || undefined }));
        }
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
    });
  }
}

export function createOpencodeBridgeServer(opts = {}) {
  const bridge = new OpencodeBridgeServer(opts);
  const server = bridge.createServer();
  server.listen(opts.port || 4440, opts.bind || '0.0.0.0');
  return { bridge, server };
}
