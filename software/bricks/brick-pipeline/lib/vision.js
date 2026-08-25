/**
 * @file vision.js
 * @description Stage 4: document-vision witness.
 * The pipeline owns no model. It spawns a declared CLI that already has a
 * vision mode. Mapping of class → CLI/model is configuration (Rule 21), never
 * a dedicated engine embedded in this brick. An unavailable witness is a
 * state, not a crash.
 *
 * Today the declared CLI is OpenCode (`opencode run --file`), with a free
 * Zen model that advertises image input. ollama remains supported if the
 * universe maps the class back to it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const VISION_PROMPT = [
  'Transcribe every readable character on this straightened document page.',
  'Return plain text only: no markdown, no commentary, no translation.',
  'Do not invent missing words. If the page is illegible, return an empty string.',
].join(' ');

function cliKind(cli) {
  const base = path.basename(String(cli || '')).toLowerCase();
  if (base === 'opencode' || base === 'opencode.exe') return 'opencode';
  if (base === 'qwen-vision') return 'qwen-vision';
  return 'ollama';
}

function withOpenCodePath(env) {
  const home = os.homedir();
  const extra = path.join(home, '.opencode', 'bin');
  const current = env.PATH || process.env.PATH || '';
  if (current.split(path.delimiter).includes(extra)) {
    return { ...env, PATH: current };
  }
  return { ...env, PATH: `${extra}${path.delimiter}${current}` };
}

/**
 * Reads the declared vision CLI mapping from options, then environment.
 * This brick does not pick a model of its own.
 * OpenCode needs cli + model (no host). ollama still needs a host.
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [env]
 */
export function visionConfig(options = {}, env = process.env) {
  const source = options.env || env;
  const cli = String(options.cli || source.DOCUMENT_VISION_CLI || 'opencode').trim();
  const kind = cliKind(cli);
  const host = String(
    options.host
    || source.DOCUMENT_VISION_HOST
    || source.OLLAMA_HOST
    || '',
  ).trim().replace(/\/+$/, '');
  const model = String(options.model || source.DOCUMENT_VISION_MODEL || '').trim();
  const timeoutMs = Number(
    options.timeoutMs
    || source.DOCUMENT_VISION_TIMEOUT_MS
    || 180000,
  );
  const needsHost = kind === 'ollama';
  return {
    cli,
    kind,
    host,
    model,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180000,
    configured: Boolean(cli && model && (!needsHost || host)),
  };
}

/**
 * Builds the argv for the declared vision CLI.
 * OpenCode: `opencode run --model ID --file IMAGE --format json --pure PROMPT`
 * ollama:   `ollama run MODEL --hidethinking PROMPT\\nIMAGE` with OLLAMA_HOST
 * qwen-vision: `qwen-vision IMAGE PROMPT`
 */
export function buildVisionCommand(cfg, imagePath, prompt = VISION_PROMPT) {
  const kind = cfg.kind || cliKind(cfg.cli);
  const env = withOpenCodePath({
    ...process.env,
    ...(cfg.host ? { OLLAMA_HOST: cfg.host } : {}),
  });

  if (kind === 'opencode') {
    return {
      command: cfg.cli,
      args: [
        'run',
        '--model', cfg.model,
        '--file', imagePath,
        '--format', 'json',
        '--pure',
        prompt,
      ],
      env,
    };
  }

  if (kind === 'qwen-vision') {
    return {
      command: cfg.cli,
      args: [imagePath, prompt],
      env,
    };
  }

  return {
    command: cfg.cli,
    args: [
      'run',
      cfg.model,
      '--hidethinking',
      '--think=false',
      '--nowordwrap',
      `${prompt}\n${imagePath}`,
    ],
    env,
  };
}

function missingResult(reason, cfg = {}) {
  return {
    text: '',
    engine: 'document-vision',
    cli: cfg.cli || '',
    host: cfg.host || '',
    model: cfg.model || '',
    available: false,
    missingReason: reason,
    rawLength: 0,
  };
}

function stripThinking(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|?think\|>[\s\S]*?<\|?\/think\|>/gi, '')
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
    .trim();
}

/**
 * Pulls assistant text out of OpenCode `--format json` event lines.
 * Unknown shapes fall through to the raw stdout.
 */
export function extractVisionStdout(stdout) {
  const raw = String(stdout || '');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const chunks = [];

  for (const line of lines) {
    if (!(line.startsWith('{') && line.endsWith('}'))) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const type = String(event.type || event.kind || '');
    if (type === 'error' || type === 'session.error') continue;
    const part = event.part || event.delta || {};
    const text =
      (typeof event.text === 'string' && event.text)
      || (typeof part.text === 'string' && part.text)
      || (typeof event.message?.content === 'string' && event.message.content)
      || '';
    if (text && (type.includes('text') || type.includes('message') || part.type === 'text' || !type)) {
      chunks.push(text);
    }
  }

  const fromJson = chunks.join('');
  return stripThinking(fromJson || raw)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function defaultSpawn(command, args, { env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const err = new Error('timeout');
      err.name = 'AbortError';
      reject(err);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

/**
 * Reads a straightened page by spawning the declared vision CLI.
 * Never throws for a missing binary, a down host, or a mute model —
 * reports the witness as missing.
 *
 * @param {string} imagePath
 * @param {object} [options]
 * @param {Function} [options.spawnImpl]
 */
export async function runVision(imagePath, options = {}) {
  const cfg = visionConfig(options);
  if (!cfg.configured) {
    return missingResult('not_configured', cfg);
  }
  if (!imagePath || !fs.existsSync(imagePath)) {
    return missingResult('no_image', cfg);
  }

  const { command, args, env } = buildVisionCommand(
    cfg,
    imagePath,
    options.prompt || VISION_PROMPT,
  );
  const spawnImpl = options.spawnImpl || defaultSpawn;

  try {
    const { stdout, exitCode } = await spawnImpl(command, args, {
      env,
      timeoutMs: cfg.timeoutMs,
    });
    const cleaned = extractVisionStdout(stdout);

    if (!cleaned) {
      return missingResult(exitCode === 0 ? 'empty_output' : `exit_${exitCode}`, cfg);
    }

    return {
      text: cleaned,
      engine: 'document-vision',
      cli: cfg.cli,
      host: cfg.host,
      model: cfg.model,
      available: true,
      missingReason: null,
      rawLength: cleaned.length,
    };
  } catch (err) {
    if (err?.code === 'ENOENT') return missingResult('cli_missing', cfg);
    const reason = err?.name === 'AbortError' ? 'timeout' : `spawn:${err.message}`;
    return missingResult(reason, cfg);
  }
}
