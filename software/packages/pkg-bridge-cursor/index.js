/**
 * @package @shaper/pkg-bridge-cursor
 * HTTP/SSE bridge for the Cursor agent CLI — Rule 8 agent container contract.
 * Default mode: standard/normal (fast mode disabled by default, activatable on-demand).
 * The model is never named here: it is measured at deployment (Rule 7).
 */
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { vitals, ageSeconds, cliCheck, writable } from '../pkg-logger/vitals.js';

export const COMPOSER_DEFAULT_MODE = 'normal'; // Fast is DISABLED by default

/**
 * No model is named here. This bridge used to export a pinned Composer version
 * and pass it to the CLI whatever the environment said — the CURSOR_MODEL the
 * deploy script handed to the container was never read. The pin aged with its
 * vendor while the suite kept asserting it, green (Rule 7: a default that must
 * be edited when a vendor ships a version is a cache, not a rule).
 *
 * The model comes from CURSOR_MODEL, chosen by measurement from the target host.
 * When it is missing, the bridge halts and says which variable to provide,
 * rather than starting on a guess (Rule 0J). The simulated bridge (stub mode)
 * never spawns the CLI, so it is the one place a model is not required.
 */
export const CURSOR_MODEL_ENV = 'CURSOR_MODEL';

export function resolveCursorModel(env = process.env) {
  return String(env[CURSOR_MODEL_ENV] || '').trim();
}

export class ModelUnsetError extends Error {
  constructor(envVar = CURSOR_MODEL_ENV) {
    super(`bridge-cursor: no model is set — this bridge names no default (Rule 7). `
      + `Measure the engines reachable from this host, pick one, and export ${envVar}=<model id>; `
      + 'set BRIDGE_CURSOR_STUB=1 to run the simulated bridge instead.');
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

export function buildCursorSpawnEnv(baseEnv = process.env, customEnv = {}) {
  const env = { ...baseEnv, ...customEnv };
  if (baseEnv.CURSOR_API_KEY) env.CURSOR_API_KEY = baseEnv.CURSOR_API_KEY;
  if (baseEnv.CURSOR_TOKEN) env.CURSOR_TOKEN = baseEnv.CURSOR_TOKEN;
  return env;
}

export class CursorBridgeServer {
  constructor({
    port = 4310,
    bind = '0.0.0.0',
    cursorBin = process.env.CURSOR_BIN || 'cursor',
    model = resolveCursorModel(process.env),
    mode = process.env.CURSOR_MODE || COMPOSER_DEFAULT_MODE, // normal by default
    workspaceBase = '/tmp/cursor-workspaces',
    authToken = '',
    stubMode = process.env.BRIDGE_CURSOR_STUB === '1',
  } = {}) {
    this.port = port;
    this.bind = bind;
    this.cursorBin = cursorBin;
    this.stubMode = stubMode;
    // An empty model is reported as absent, never carried as '' into a CLI
    // argument where it would fail with a message about the wrong thing.
    this.model = String(model || '').trim() || null;
    if (!this.stubMode && !this.model) throw new ModelUnsetError();
    this.mode = mode; // 'normal' by default, 'fast' only when explicitly enabled
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
    const cliInfo = cliCheck(execFileSync, this.cursorBin, ['--version']);
    return vitals({
      service: 'brick-bridge-cursor',
      startedAt: this.startedAt,
      signals: {
        injects: this.metrics.injects,
        completions: this.metrics.completions,
        errors: this.metrics.errors,
        runsInFlight: this.runningProcesses.size,
        model: this.model,
        mode: this.mode,
        hasApiKey: Boolean(process.env.CURSOR_API_KEY),
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

  runAgentStub(conv, runId, prompt, targetMode) {
    setTimeout(() => {
      this.broadcast({
        type: 'text_delta',
        conversation: conv,
        run_id: runId,
        text: `[Cursor ${this.model || 'stub'} (${targetMode})] Processed request in workspace: ${conv}`
      }, conv);
      this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: 0, stub: true }, conv);
      this.metrics.completions++;
    }, 10);
    return { runId, cwd: this.ensureWorkspace(conv), model: this.model, mode: targetMode, stub: true };
  }

  runAgent(conversationName, prompt, opts = {}) {
    const conv = normalizeConversationName(conversationName);
    const cwd = this.ensureWorkspace(conv);
    const runId = `run-cursor-${Date.now()}`;
    const targetMode = opts.mode || this.mode; // uses 'normal' unless 'fast' passed in opts
    // The constructor already refused a real bridge without a model; this keeps
    // a later mutation from reaching the CLI as `--model ''`.
    if (!this.stubMode && !this.model) throw new ModelUnsetError();
    const fullPrompt = this.buildContextualPrompt(prompt, {
      contextFile: opts.contextFile || null,
      contextText: opts.contextText || null,
    });

    this.broadcast({
      type: 'start',
      conversation: conv,
      run_id: runId,
      model: this.model,
      mode: targetMode
    }, conv);

    if (this.stubMode) {
      return this.runAgentStub(conv, runId, fullPrompt, targetMode);
    }

    // The real cursor-agent contract (cursor.com/docs/cli/reference/output-format):
    // `-p <prompt>` runs headless, `--output-format stream-json` emits one typed
    // event per line — system/init, assistant, tool_call started|completed, and
    // a terminal `result` carrying `is_error`.
    //
    // Note what the earlier flags assumed and the CLI does not have: there is no
    // `--composer`, no `--prompt`, no `--format`, and no `--mode`. Speed is a
    // model choice, not a switch — which is how "never fast by default" is
    // honoured: by the measured model id, nowhere else.
    //
    // One asymmetry worth knowing: on failure cursor-agent emits no well-formed
    // JSON at all and only the exit code speaks. That is why this bridge keeps
    // announcing its own `done { exit_code }` on close rather than relying on a
    // terminal event that may never come.
    // `--force` is not optional in headless use. Without it the CLI stops on a
    // "Workspace Trust Required" prompt — and, verified on this host, **exits 0
    // while refusing to work**. So cursor-agent's exit code is no more
    // trustworthy than agy's; the witness is `is_error` inside the JSON, and the
    // absence of any JSON is itself the failure signal.
    const args = [
      '-p', fullPrompt,
      '--output-format', 'stream-json',
      '--model', this.model,
      '--force',
    ];

    // cursor-agent has no perimeter flag: it works where it is started. So the
    // perimeter is applied as the working directory — weaker than agy's
    // --add-dir, and worth knowing when choosing which agent gets which task.
    // A perimeter is only enforceable where the agent actually runs. This bridge
    // runs in a container, so a path that exists on the host means nothing here
    // — and `spawn` fails with a bare ENOENT that names the binary rather than
    // the directory, which sends the reader hunting the wrong thing. Say it
    // plainly instead, and fall back to the conversation's own workspace.
    let workDir = cwd;
    if (opts.perimeter) {
      if (fs.existsSync(opts.perimeter)) {
        workDir = opts.perimeter;
      } else {
        this.broadcast({
          type: 'log', conversation: conv, run_id: runId,
          text: `perimeter ${opts.perimeter} does not exist in this bridge — it must be mounted into the container to be enforceable`,
        }, conv);
        this.metrics.errors++;
        this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: 126 }, conv);
        return { runId, cwd, model: this.model, mode: targetMode, refused: 'perimeter_unreachable' };
      }
    }

    const proc = spawn(this.cursorBin, args, {
      cwd: workDir,
      env: buildCursorSpawnEnv(process.env, opts.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.runningProcesses.set(conv, proc);

    // A missing or unrunnable CLI is a **state**, not a crash (Rule 34).
    //
    // Without this, Node raises an unhandled 'error' event and the whole bridge
    // dies — taking every other conversation with it, and leaving the queue
    // watching a stream that will never speak again. Observed on gbs-test: one
    // wrong mount path, and the bridge process was gone.
    //
    // The run ends, the reason travels on the same channel as any other
    // outcome, and the bridge stays up to serve the next request.
    // Node emits 'error' and then 'close' on a failed spawn, so without a mark
    // the run would be counted twice and every health reading built on these
    // counters would drift.
    let concluded = false;

    proc.on('error', (err) => {
      concluded = true;
      this.runningProcesses.delete(conv);
      this.metrics.errors++;
      this.broadcast({
        type: 'log', conversation: conv, run_id: runId,
        text: `cannot start ${this.cursorBin}: ${err.code || err.message}`,
      }, conv);
      this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: 127 }, conv);
    });


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
      if (concluded) return;
      concluded = true;
      this.runningProcesses.delete(conv);
      if (code === 0) this.metrics.completions++;
      else this.metrics.errors++;
      this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: code }, conv);
    });

    return { runId, cwd: workDir, model: this.model, mode: targetMode };
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const p = url.pathname;

      if (p === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          service: 'brick-bridge-cursor',
          port: this.port,
          model: this.model,
          defaultMode: this.mode,
          fastEnabled: this.mode === 'fast',
          stubMode: this.stubMode,
          hasApiKey: Boolean(process.env.CURSOR_API_KEY || process.env.CURSOR_TOKEN),
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
          service: 'brick-bridge-cursor',
          metrics: this.metrics,
          running: this.runningProcesses.size
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
            perimeter: body.perimeter || null,
            contextText: body.context || null,
            mode: body.mode || undefined, // explicit 'fast' or defaults to normal
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

export function createCursorBridgeServer(opts = {}) {
  const bridge = new CursorBridgeServer(opts);
  const server = bridge.createServer();
  server.listen(opts.port || 4310, opts.bind || '0.0.0.0');
  return { bridge, server };
}
