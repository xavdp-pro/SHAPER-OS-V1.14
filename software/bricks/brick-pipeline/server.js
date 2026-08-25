/**
 * @file server.js
 * @description HTTP Service for brick-pipeline.
 * Provides health checks and document processing endpoints.
 * Cold start: answers health checks immediately (INTENT §3.5).
 */

import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { processDocument, PIPELINE_VERSION } from './index.js';

const PORT = parseInt(process.env.PIPELINE_PORT || process.env.PORT || '8670', 10);
const STARTED_AT = new Date().toISOString();
let documentsProcessed = 0;
let lastProcessingDurationMs = null;

function checkBinary(cmd, args = ['--version']) {
  const homeBin = `${process.env.HOME || ''}/.opencode/bin`;
  const env = {
    ...process.env,
    PATH: `${homeBin}:${process.env.PATH || ''}`,
  };
  try {
    const raw = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env,
      timeout: 3000,
    });
    return { name: cmd, resolved: true, version: String(raw || '').trim().split('\n')[0] };
  } catch (err) {
    return { name: cmd, resolved: false, version: null, error: err.code || err.message };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 1. Health check (instant cold start response)
  if (req.method === 'GET' && (url.pathname === '/api/health' || url.pathname === '/health')) {
    const tools = {
      tesseract: checkBinary('tesseract', ['--version']).resolved,
      pdftoppm: checkBinary('pdftoppm', ['-v']).resolved,
      convert: checkBinary('convert', ['-version']).resolved,
      opencode: checkBinary('opencode', ['--version']).resolved,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'brick-pipeline',
      version: PIPELINE_VERSION,
      tools,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // 2. Vitals check (Rule 23: evidence, no self-verdict)
  if (req.method === 'GET' && (url.pathname === '/api/vitals' || url.pathname === '/vitals')) {
    const uptimeSec = Math.round((Date.now() - Date.parse(STARTED_AT)) / 100) / 10;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'brick-pipeline',
      at: new Date().toISOString(),
      uptimeSeconds: uptimeSec,
      signals: {
        documentsProcessed,
        lastProcessingDurationMs,
        tools: {
          tesseract: checkBinary('tesseract', ['--version']),
          pdftoppm: checkBinary('pdftoppm', ['-v']),
          convert: checkBinary('convert', ['-version']),
          opencode: checkBinary('opencode', ['--version']),
        },
      },
      checks: {},
    }));
    return;
  }

  // 2. Document processing endpoint
  if (req.method === 'POST' && (url.pathname === '/api/pipeline/process' || url.pathname === '/api/pipeline/extract' || url.pathname === '/api/process')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const filePath = payload.filePath;

        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing filePath in request payload' }));
          return;
        }

        const t0 = Date.now();
        const result = await processDocument(filePath, payload.options || {});
        documentsProcessed++;
        lastProcessingDurationMs = Date.now() - t0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 404 for unknown endpoints
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[brick-pipeline] Service running on http://0.0.0.0:${PORT} (v${PIPELINE_VERSION})`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[brick-pipeline] Received SIGTERM, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[brick-pipeline] Received SIGINT, shutting down...');
  server.close(() => process.exit(0));
});
