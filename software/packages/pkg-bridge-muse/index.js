/**
 * @package @shaper/pkg-bridge-muse
 * HTTP/SSE bridge for Meta Muse CLI — Rule 8 agent container contract.
 * The model is never named here: it is measured at deployment (Rule 7).
 */
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { vitals, cliCheck, writable } from '../pkg-logger/vitals.js';
import {
  buildMuseExecArgs,
  buildMuseSpawnEnv,
  hasMuseApiKey,
} from './muse-env.js';

export {
  buildMuseExecArgs,
  buildMuseSpawnEnv,
  hasMuseApiKey,
  museHeadlessSafetyFlags,
  NONINTERACTIVE_ENV,
} from './muse-env.js';

export function normalizeConversationName(name) {
  if (!name || typeof name !== 'string') return 'default';
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return clean || 'default';
}

export function formatSseEvent(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const MUSE_MODEL_ENV = 'MUSE_MODEL';
export const MUSE_MODEL_ENV_ALT = 'META_MUSE_MODEL';

export function resolveMuseModel(env = process.env) {
  return String(env[MUSE_MODEL_ENV] || env[MUSE_MODEL_ENV_ALT] || '').trim();
}

export class ModelUnsetError extends Error {
  constructor(envVar = MUSE_MODEL_ENV) {
    super(`bridge-muse: no model is set — this bridge names no default (Rule 7). `
      + `Measure the engines reachable from this host, pick one, and export ${envVar}=<model id> `
      + `(or ${MUSE_MODEL_ENV_ALT}); set BRIDGE_MUSE_STUB=1 to run the simulated bridge instead.`);
    this.name = 'ModelUnsetError';
    this.code = 'BRIDGE_MODEL_UNSET';
    this.envVar = envVar;
  }
}

export class MuseBridgeServer {
  constructor({
    port = 4320,
    bind = '0.0.0.0',
    museBin = process.env.MUSE_BIN || 'muse',
    defaultModel = resolveMuseModel(process.env),
    defaultProvider = process.env.MUSE_PROVIDER || 'meta',
    defaultReasoningEffort = process.env.MUSE_REASONING_EFFORT || 'high',
    workspaceBase = '/tmp/muse-workspaces',
    authToken = '',
    stubMode = process.env.BRIDGE_MUSE_STUB === '1',
  } = {}) {
    this.port = port;
    this.bind = bind;
    this.museBin = museBin;
    this.stubMode = stubMode;
    this.defaultModel = String(defaultModel || '').trim() || null;
    if (!this.stubMode && !this.defaultModel) throw new ModelUnsetError();
    this.defaultProvider = defaultProvider;
    this.defaultReasoningEffort = defaultReasoningEffort;
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
    const cliInfo = cliCheck(execFileSync, this.museBin, ['--version']);
    return vitals({
      service: 'brick-bridge-muse',
      startedAt: this.startedAt,
      signals: {
        injects: this.metrics.injects,
        completions: this.metrics.completions,
        errors: this.metrics.errors,
        runsInFlight: this.runningProcesses.size,
        model: this.defaultModel,
        provider: this.defaultProvider,
        reasoningEffort: this.defaultReasoningEffort,
        hasApiKey: hasMuseApiKey(process.env),
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

  buildContextualPrompt(userPrompt, {
    contextFile = null,
    contextText = null,
    perimeter = null,
  } = {}) {
    let finalPrompt = '';
    if (contextFile && fs.existsSync(contextFile)) {
      finalPrompt += `[BUSINESS CONTEXT (${path.basename(contextFile)})]\n${fs.readFileSync(contextFile, 'utf8')}\n\n`;
    }
    if (contextText) finalPrompt += `[INSTRUCTIONS]\n${contextText}\n\n`;
    if (perimeter && fs.existsSync(perimeter)) {
      finalPrompt += `[PERIMETER]\nModify files only under ${perimeter}.\n\n`;
    }
    finalPrompt += `[USER REQUEST]\n${userPrompt}`;
    return finalPrompt;
  }

  runAgentStub(conv, runId) {
    setTimeout(() => {
      this.broadcast({
        type: 'text_delta',
        conversation: conv,
        run_id: runId,
        text: `[Muse stub ${this.defaultModel || 'none'}] headless OK`,
      }, conv);
      this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: 0, stub: true }, conv);
      this.metrics.completions++;
    }, 10);
    return {
      runId,
      cwd: this.ensureWorkspace(conv),
      model: this.defaultModel,
      provider: this.defaultProvider,
      stub: true,
    };
  }

  runAgent(conversationName, prompt, opts = {}) {
    const conv = normalizeConversationName(conversationName);
    const cwd = this.ensureWorkspace(conv);
    const runId = `run-muse-${Date.now()}`;
    const model = opts.model || this.defaultModel;
    if (!this.stubMode && !model) throw new ModelUnsetError();

    const fullPrompt = this.buildContextualPrompt(prompt, {
      contextFile: opts.contextFile || null,
      contextText: opts.contextText || null,
      perimeter: opts.perimeter || null,
    });

    const provider = opts.provider || this.defaultProvider;
    const reasoningEffort = opts.reasoningEffort || opts.reasoning_effort || this.defaultReasoningEffort;

    this.broadcast({
      type: 'start',
      conversation: conv,
      run_id: runId,
      model,
      provider,
      reasoningEffort,
    }, conv);

    if (this.stubMode) {
      return this.runAgentStub(conv, runId);
    }

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
        return { runId, cwd, model, provider, refused: 'perimeter_unreachable' };
      }
    }

    const args = buildMuseExecArgs({
      prompt: fullPrompt,
      model,
      provider,
      workspace: workDir,
      reasoningEffort,
    });

    const proc = spawn(this.museBin, args, {
      cwd: workDir,
      env: buildMuseSpawnEnv(process.env, opts.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.runningProcesses.set(conv, proc);

    let concluded = false;

    proc.on('error', (err) => {
      concluded = true;
      this.runningProcesses.delete(conv);
      this.metrics.errors++;
      this.broadcast({
        type: 'log', conversation: conv, run_id: runId,
        text: `cannot start ${this.museBin}: ${err.code || err.message}`,
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

    return { runId, cwd: workDir, model, provider, reasoningEffort };
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const p = url.pathname;

      if (p === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          service: 'brick-bridge-muse',
          port: this.port,
          model: this.defaultModel,
          provider: this.defaultProvider,
          stubMode: this.stubMode,
          hasApiKey: hasMuseApiKey(process.env),
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
          service: 'brick-bridge-muse',
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
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
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
            provider: body.provider || null,
            reasoningEffort: body.reasoning_effort || body.reasoningEffort || null,
            perimeter: body.perimeter || null,
          });
          this.metrics.injects++;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, conversation: conv, ...result }));
        } catch (err) {
          this.metrics.errors++;
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

export function createMuseBridgeServer(opts = {}) {
  const bridge = new MuseBridgeServer(opts);
  const server = bridge.createServer();
  server.listen(opts.port || 4320, opts.bind || '0.0.0.0');
  return { bridge, server };
}
