import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { cliNodes } from './lib/bridgeClient.js';
import authRouter, { authMiddleware } from './routes/auth.js';
import statusRouter from './routes/status.js';
import injectRouter from './routes/inject.js';
import uploadRouter from './routes/upload.js';
import conversationsRouter from './routes/conversations.js';
import eventsRouter from './routes/events.js';
import consoleSyncRouter from './routes/consoleSync.js';
import timelineRouter from './routes/timeline.js';
import sessionRouter from './routes/session.js';
import devRouter from './routes/dev.js';
import usersRouter from './routes/users.js';
import voiceRouter from './routes/voice.js';
import workspaceRouter from './routes/workspace.js';
import settingsRouter from './routes/settings.js';
import previewRouter from './routes/preview.js';
import browserRouter from './routes/browser.js';
import contextRouter from './routes/context.js';
import claudeAuthRouter from './routes/claudeAuth.js';
import maestroRouter from './routes/maestro.js';
import socleRouter from './routes/socle.js';
import ragRouter from './routes/rag.js';
import { attachPreviewWebSocket } from './lib/previewWsBridge.js';
import { ensureUsersSchema } from './lib/db.js';
import { DEMO_ADMIN } from './lib/demoAdmin.js';
import { ensureSettingsSchema, getSettings } from './lib/settingsStore.js';
import { attachVoiceTtsWebSocket } from './lib/voiceTtsWsBridge.js';
import { attachVoiceSttWebSocket } from './lib/voiceSttWsBridge.js';
import { startTimelineBuilder } from './lib/timelineBuilder.js';
import { ensureVoiceAliasSchema } from './lib/voiceAliasStore.js';
import { ensureTimelineSchema } from './lib/timelineStore.js';
import { startDemoActivityWatcher } from './lib/demoActivityWatch.js';

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'helm-v2',
    port: config.port,
    mode: config.appMode,
  });
});

/** Public bootstrap for login UI (no auth) — mode flags only. */
app.get('/api/bootstrap', (_req, res) => {
  res.json({
    ok: true,
    mode: config.appMode,
    demoLogin: config.isDemo,
    // Demo prefill values come from the server so front and back can never
    // diverge when DEMO_ADMIN_PASSWORD is overridden. Empty outside demo mode.
    demoCredentials: config.isDemo
      ? { email: DEMO_ADMIN.email, password: DEMO_ADMIN.password }
      : null,
  });
});

app.use('/api/auth', authRouter);
app.use('/api', statusRouter);
app.use('/api', injectRouter);
app.use('/api', uploadRouter);
app.use('/api', conversationsRouter);
app.use('/api', eventsRouter);
app.use('/api', consoleSyncRouter);
app.use('/api', timelineRouter);
app.use('/api', sessionRouter);
app.use('/api', devRouter);
app.use('/api', usersRouter);
app.use('/api', voiceRouter);
app.use('/api', workspaceRouter);
app.use('/api', settingsRouter);
app.use('/api', previewRouter);
app.use('/api', browserRouter);
app.use('/api', contextRouter);
app.use('/api', claudeAuthRouter);
app.use('/api/maestro', maestroRouter);
app.use('/api/socle', socleRouter);
app.use('/api', ragRouter);

app.get('/api/version', authMiddleware, (_req, res) => {
  res.json({
    version: '0.3.0',
    tunnel: process.env.SHAPER_TUNNEL_HOSTNAME || null,
    transport: 'cursor-agent-cli',
    nodes: cliNodes(),
  });
});

const GED_URL = process.env.GED_URL || 'http://127.0.0.1:8660';

function proxyToGed(req, res) {
  let targetPath = (req.originalUrl || req.url || '/');
  if (targetPath.startsWith('/api/ged')) {
    targetPath = targetPath.replace(/^\/api\/ged/, '/api');
  } else if (targetPath.startsWith('/ged')) {
    targetPath = targetPath.replace(/^\/ged/, '') || '/';
  }
  const targetUrl = new URL(targetPath, GED_URL);
  const headers = { ...req.headers, host: targetUrl.host };
  delete headers.connection;

  const proxyReq = http.request(targetUrl, {
    method: req.method,
    headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: 'Mini-GED container (univ9-ged:8660) is unreachable or booting', details: err.message });
  });

  if (req.body && Object.keys(req.body).length > 0 && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    const raw = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Length', Buffer.byteLength(raw));
    proxyReq.setHeader('Content-Type', 'application/json');
    proxyReq.write(raw);
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
}

app.use('/ged', (req, res) => proxyToGed(req, res));
app.use('/api/ged', (req, res) => proxyToGed(req, res));

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.join(__dirname, '..');
const distDir = path.join(appRoot, 'dist');
const isDev = process.env.VITE_DEV === 'true' || process.env.NODE_ENV === 'development';

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || config.port || 8650);

const httpServer = http.createServer(app);

if (isDev) {
  console.log('[helm-v2] ⚡ DEV mode enabled: Mounting Vite Dev Server with HMR...');
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
    },
    appType: 'spa',
    root: appRoot,
  });
  app.use(vite.middlewares);
} else if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/assets/') && !path.extname(req.path)) {
      return res.sendFile(path.join(distDir, 'index.html'));
    }
    next();
  });
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

httpServer.listen(port, host, async () => {
  const nodes = cliNodes().map((n) => n.name).join(', ');
  console.log(`[helm-v2] API http://${host}:${port} → CLI nodes: ${nodes}`);
  try {
    await ensureUsersSchema();
    console.log(`[helm-v2] MariaDB users table ready (mode=${config.appMode})`);
    await ensureSettingsSchema();
    await getSettings();
    console.log('[helm-v2] MariaDB settings table ready');
    await ensureVoiceAliasSchema();
    console.log('[helm-v2] MariaDB voice_aliases table ready');
    await ensureTimelineSchema();
    console.log('[helm-v2] MariaDB timelines table ready');
  } catch (err) {
    console.error('[helm-v2] MariaDB schema:', err.message);
  }
  startTimelineBuilder();
});

attachVoiceTtsWebSocket(httpServer);
attachVoiceSttWebSocket(httpServer);
attachPreviewWebSocket(httpServer);
if (config.isDemo) {
  startDemoActivityWatcher();
}
