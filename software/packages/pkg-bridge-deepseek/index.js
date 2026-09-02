/**
 * @package @shaper/pkg-bridge-deepseek
 * HTTP/SSE bridge for DeepSeek & Ollama Cloud Agent Harness — Rule 8 agent contract.
 * The model is never named here: it is measured at deployment (Rule 7).
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { vitals, ageSeconds, dependency, writable } from '../pkg-logger/vitals.js';

/**
 * No model is named here. This package used to export a default and the header
 * above named a second, different one — two "defaults" for the same bridge,
 * neither measured, both ageing with their vendor while the suite asserted the
 * first and stayed green (Rule 7: a default that must be edited when a vendor
 * ships a version is a cache, not a rule).
 *
 * The model comes from OLLAMA_MODEL (or DEEPSEEK_MODEL for the DeepSeek API
 * path), chosen by measurement from the target host. When it is missing, the
 * bridge halts and says which variable to provide rather than starting on a
 * guess (Rule 0J). The simulated bridge (stub mode) calls no engine, so it is
 * the one place a model is not required.
 */
export const DEEPSEEK_MODEL_ENV = 'OLLAMA_MODEL';
export const DEEPSEEK_MODEL_ENV_ALT = 'DEEPSEEK_MODEL';

export function resolveDeepseekModel(env = process.env) {
  return String(env[DEEPSEEK_MODEL_ENV] || env[DEEPSEEK_MODEL_ENV_ALT] || '').trim();
}

export class ModelUnsetError extends Error {
  constructor(envVar = DEEPSEEK_MODEL_ENV) {
    super(`bridge-deepseek: no model is set — this bridge names no default (Rule 7). `
      + `Measure the engines reachable from this host, pick one, and export ${envVar}=<model id> `
      + `(or ${DEEPSEEK_MODEL_ENV_ALT}); set BRIDGE_DEEPSEEK_STUB=1 to run the simulated bridge instead.`);
    this.name = 'ModelUnsetError';
    this.code = 'BRIDGE_MODEL_UNSET';
    this.envVar = envVar;
  }
}

export const OLLAMA_CLOUD_ENDPOINT = 'https://ollama.com/v1';
export const DEEPSEEK_API_ENDPOINT = 'https://api.deepseek.com/v1';

export function normalizeConversationName(name) {
  if (!name || typeof name !== 'string') return 'default';
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return clean || 'default';
}

export function formatSseEvent(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function resolveDeepseekApiKey(env = process.env) {
  return env.OLLAMA_API_KEY || env.OLLAMA_CLOUD_API_KEY || env.DEEPSEEK_API_KEY || '';
}

export function resolveDeepseekEndpoint(env = process.env) {
  if (env.OLLAMA_API_KEY || env.OLLAMA_CLOUD_API_KEY) return OLLAMA_CLOUD_ENDPOINT;
  if (env.DEEPSEEK_API_KEY) return DEEPSEEK_API_ENDPOINT;
  return env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1';
}

export class DeepseekBridgeServer {
  constructor({
    port = 4350,
    bind = '0.0.0.0',
    model = resolveDeepseekModel(process.env),
    workspaceBase = '/tmp/deepseek-workspaces',
    authToken = '',
    stubMode = process.env.BRIDGE_DEEPSEEK_STUB === '1',
    endpoint = null,
    apiKey = null,
  } = {}) {
    this.port = port;
    this.bind = bind;
    this.stubMode = stubMode;
    // An empty model is reported as absent, never sent as '' to an API that
    // would answer with an error about the wrong thing.
    this.model = String(model || '').trim() || null;
    if (!this.stubMode && !this.model) throw new ModelUnsetError();
    this.workspaceBase = workspaceBase;
    this.authToken = authToken;
    this.apiKey = apiKey || resolveDeepseekApiKey(process.env);
    this.endpoint = endpoint || (this.apiKey ? OLLAMA_CLOUD_ENDPOINT : resolveDeepseekEndpoint(process.env));
    this.clients = new Map();
    this.runningProcesses = new Map();
    this.metrics = { injects: 0, completions: 0, errors: 0 };
    this.startedAt = new Date().toISOString();

    fs.mkdirSync(this.workspaceBase, { recursive: true });
  }

  async vitals(now = Date.now()) {
    const wsCheck = await writable(fs, this.workspaceBase);
    return vitals({
      service: 'brick-bridge-deepseek',
      startedAt: this.startedAt,
      signals: {
        injects: this.metrics.injects,
        completions: this.metrics.completions,
        errors: this.metrics.errors,
        runsInFlight: this.runningProcesses.size,
        model: this.model,
        endpoint: this.endpoint,
        hasApiKey: !!this.apiKey,
        stubMode: this.stubMode,
      },
      checks: {
        workspace: wsCheck,
      },
    }, now);
  }

  ensureWorkspace(conversationName, perimeter = null) {
    if (perimeter && fs.existsSync(perimeter)) {
      return perimeter;
    }
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

  buildContextualPrompt(userPrompt, { contextFile = null, contextText = null, perimeter = null } = {}) {
    let finalPrompt = '';
    if (perimeter) {
      finalPrompt += `[WORKING PERIMETER]\n${perimeter}\n\n`;
    }
    if (contextFile && fs.existsSync(contextFile)) {
      finalPrompt += `[BUSINESS CONTEXT (${path.basename(contextFile)})]\n${fs.readFileSync(contextFile, 'utf8')}\n\n`;
    }
    if (contextText) finalPrompt += `[INSTRUCTIONS]\n${contextText}\n\n`;
    finalPrompt += `[USER REQUEST]\n${userPrompt}`;
    return finalPrompt;
  }

  runAgentStub(conv, runId, prompt, targetModel, cwd) {
    setTimeout(() => {
      this.broadcast({
        type: 'text_delta',
        conversation: conv,
        run_id: runId,
        text: `[Ollama DeepSeek Harness (${targetModel})] Processed request in workspace: ${conv}`
      }, conv);
      this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: 0, stub: true }, conv);
      this.metrics.completions++;
    }, 10);
    return { runId, cwd, model: targetModel, endpoint: this.endpoint, stub: true };
  }

  async runAgent(conversationName, prompt, opts = {}) {
    const conv = normalizeConversationName(conversationName);
    const cwd = this.ensureWorkspace(conv, opts.perimeter || null);
    const runId = `run-deepseek-${Date.now()}`;
    const targetModel = opts.model || this.model;
    // The constructor already refused a real bridge without a model; this keeps
    // a later mutation from reaching the API as `model: ''`.
    if (!this.stubMode && !targetModel) throw new ModelUnsetError();
    const fullPrompt = this.buildContextualPrompt(prompt, {
      contextFile: opts.contextFile || null,
      contextText: opts.contextText || null,
      perimeter: opts.perimeter || cwd,
    });

    this.broadcast({
      type: 'start',
      conversation: conv,
      run_id: runId,
      model: targetModel,
      endpoint: this.endpoint,
      perimeter: cwd
    }, conv);

    if (this.stubMode || !this.apiKey) {
      return this.runAgentStub(conv, runId, fullPrompt, targetModel, cwd);
    }

    try {
      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: 'You are an autonomous engineering agent inside SHAPER-OS. You write clean, robust, executable code.' },
            { role: 'user', content: fullPrompt }
          ],
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama/DeepSeek API error HTTP ${response.status}: ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;
              if (trimmed === 'data: [DONE]') break;
              try {
                const parsed = JSON.parse(trimmed.slice(5).trim());
                const delta = parsed.choices?.[0]?.delta;
                const content = delta?.content || '';
                const reasoning = delta?.reasoning || '';
                if (reasoning) {
                  this.broadcast({ type: 'reasoning_delta', conversation: conv, run_id: runId, text: reasoning }, conv);
                }
                if (content) {
                  this.broadcast({ type: 'text_delta', conversation: conv, run_id: runId, text: content }, conv);
                }
              } catch {
                /* skip */
              }
            }
          }
          this.metrics.completions++;
          this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: 0 }, conv);
        } catch (streamErr) {
          this.metrics.errors++;
          this.broadcast({ type: 'log', conversation: conv, run_id: runId, text: streamErr.message }, conv);
          this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: 1 }, conv);
        }
      })();

      return { runId, cwd, model: targetModel, endpoint: this.endpoint };
    } catch (err) {
      this.metrics.errors++;
      this.broadcast({ type: 'log', conversation: conv, run_id: runId, text: err.message }, conv);
      this.broadcast({ type: 'done', conversation: conv, run_id: runId, exit_code: 1 }, conv);
      return { runId, cwd, model: targetModel, error: err.message };
    }
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const p = url.pathname;

      if (p === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          service: 'brick-bridge-deepseek',
          port: this.port,
          model: this.model,
          endpoint: this.endpoint,
          stubMode: this.stubMode,
          hasApiKey: Boolean(this.apiKey),
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
          service: 'brick-bridge-deepseek',
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
          const perimeter = body.perimeter || null;
          const result = await this.runAgent(conv, message, {
            contextFile: body.context_file || null,
            contextText: body.context || null,
            model: body.model || undefined,
            perimeter: perimeter,
          });
          this.metrics.injects++;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, conversation: conv, perimeter, ...result }));
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

export function createDeepseekBridgeServer(opts = {}) {
  const bridge = new DeepseekBridgeServer(opts);
  const server = bridge.createServer();
  server.listen(opts.port || 4350, opts.bind || '0.0.0.0');
  return { bridge, server };
}
