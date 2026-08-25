import { WebSocketServer } from 'ws';
import { parse as parseCookie } from 'cookie';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { normalizeLocale } from './locale.js';
import { deepgramConfigured } from './deepgramVoices.js';
import {
  openDeepgramSttContext,
  DEEPGRAM_STT_SAMPLE_RATE,
  DEEPGRAM_STT_ENCODING,
  DEEPGRAM_STT_CONTAINER,
} from './deepgramSttWs.js';
import { getInfraKeyterms } from './voiceLexicon.js';

const PATH = '/api/voice/stt-stream';

function sttDebug(...args) {
  console.log('[stt-ws]', ...args);
}



function authFromUpgradeRequest(req) {
  const cookies = parseCookie(req.headers.cookie || '');
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let queryToken = '';
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    queryToken = url.searchParams.get('token') || url.searchParams.get('auth') || '';
  } catch { /* ignore */ }
  const token = cookies.ca_token || bearer || queryToken || '';
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

function sendJson(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

/**
 * Browser ↔ Helm ↔ Deepgram live STT proxy.
 * Preferred: raw PCM linear16 @ 16 kHz (Deepgram docs).
 * Optional: webm/opus containerized (omit encoding/sample_rate).
 */
export function attachVoiceSttWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== PATH) return;

    const user = authFromUpgradeRequest(req);
    if (!user) {
      console.warn('[stt-ws] upgrade 401 (no/invalid cookie)');
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!deepgramConfigured()) {
      console.warn('[stt-ws] upgrade 503 (DEEPGRAM_API_KEY missing)');
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    console.log(`[stt-ws] upgrade ok user=${user.email || user.id || '?'}`);
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (clientWs) => {
    let upstream = null;
    let closing = false;
    let audioChunks = 0;
    let sessionLang = 'fr';
    let containerized = false;
    let clientWantsLive = false;
    let reopening = false;
    let clientKeyterms = [];

    console.log('[stt-ws] client connected');

    const cleanup = () => {
      if (closing) return;
      closing = true;
      clientWantsLive = false;
      console.log(`[stt-ws] client cleanup audioChunks=${audioChunks}`);
      try { upstream?.cancel(); } catch { /* ignore */ }
      upstream = null;
    };

    const attachUpstreamHandlers = (ctx) => {
      // Handlers are wired at openDeepgramSttContext call site.
      return ctx;
    };

    const openUpstream = async () => {
      let extraKeyterms = [];
      try {
        extraKeyterms = await getInfraKeyterms();
      } catch { /* lexicon optional */ }
      const ctx = openDeepgramSttContext({
        extraKeyterms: [...extraKeyterms, ...clientKeyterms],
        locale: sessionLang,
        containerized,
        onPartial: (text) => {
          if (text) sttDebug(`partial: ${String(text).slice(0, 80)}`);
          sendJson(clientWs, { type: 'partial', text: text || '' });
        },
        onCommitted: (text, meta) => {
          sttDebug(
            `committed${meta?.speechFinal ? ' (speech_final)' : ''}: ${String(text).slice(0, 80)}`,
          );
          sendJson(clientWs, {
            type: 'committed',
            text,
            speechFinal: Boolean(meta?.speechFinal),
          });
        },
        onDone: () => {
          sttDebug('upstream done');
          if (upstream === ctx) upstream = null;
          // Auto-reopen if browser mic still live (Deepgram idle/error close).
          if (!closing && clientWantsLive && !reopening) {
            reopening = true;
            sttDebug('reopening Deepgram upstream');
            void openUpstream()
              .then((next) => {
                upstream = next;
              })
              .catch((err) => {
                console.warn('[stt-ws] reopen failed', err.message || err);
                sendJson(clientWs, { type: 'error', error: err.message || 'STT reconnect failed' });
              })
              .finally(() => {
                reopening = false;
              });
            return;
          }
          if (!clientWantsLive) sendJson(clientWs, { type: 'done' });
        },
        onError: (err) => {
          console.warn('[stt-ws] upstream error', err.message || err);
          if (upstream === ctx) upstream = null;
          sendJson(clientWs, { type: 'error', error: err.message || 'STT stream error' });
        },
      });
      await ctx.waitOpen();
      return attachUpstreamHandlers(ctx);
    };

    const parseClientJson = (raw) => {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      const trimmed = text.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    };

    clientWs.on('message', async (raw, isBinary) => {
      if (closing) return;

      const jsonMsg = parseClientJson(raw);
      if (!jsonMsg) {
        if (isBinary || Buffer.isBuffer(raw)) {
          const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          audioChunks += 1;
          if (audioChunks === 1 || audioChunks % 50 === 0) {
            console.log(`[stt-ws] audio chunk #${audioChunks} bytes=${buf.length} upstream=${Boolean(upstream)}`);
          }
          // Drop only if reopen in flight; otherwise try soft reopen on first miss.
          if (!upstream && clientWantsLive && !reopening) {
            reopening = true;
            sttDebug('audio with no upstream — reopening');
            try {
              upstream = await openUpstream();
            } catch (err) {
              console.warn('[stt-ws] reopen on audio failed', err.message || err);
            } finally {
              reopening = false;
            }
          }
          upstream?.pushAudio(buf);
        }
        return;
      }

      const msg = jsonMsg;

      try {
        if (msg.type === 'start') {
          if (upstream) {
            upstream.cancel();
            upstream = null;
          }
          audioChunks = 0;
          sessionLang = normalizeLocale(msg.lang);
          clientKeyterms = Array.isArray(msg.keyterms)
            ? msg.keyterms.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
          // Default PCM (reliable). webm only if client asks explicitly.
          containerized = String(msg.container || 'pcm').toLowerCase() === 'webm';
          clientWantsLive = true;
          sttDebug(
            `start lang=${sessionLang} container=${containerized ? 'webm' : 'pcm'}`,
          );
          upstream = await openUpstream();
          sttDebug(
            `ready model=${upstream.modelId} lang=${upstream.language} encoding=${upstream.encoding}`,
          );
          sendJson(clientWs, {
            type: 'ready',
            provider: 'deepgram',
            contextId: upstream.contextId,
            containerized: upstream.containerized,
            sampleRate: upstream.sampleRate ?? DEEPGRAM_STT_SAMPLE_RATE,
            encoding: upstream.encoding || (containerized ? DEEPGRAM_STT_CONTAINER : DEEPGRAM_STT_ENCODING),
            modelId: upstream.modelId,
            language: upstream.language,
          });
          return;
        }

        if (msg.type === 'audio' && msg.data) {
          if (!upstream) throw new Error('Session STT non démarrée (start requis)');
          upstream.pushAudio(Buffer.from(String(msg.data), 'base64'));
          return;
        }

        if (msg.type === 'stop') {
          clientWantsLive = false;
          if (!upstream) {
            sendJson(clientWs, { type: 'done' });
            return;
          }
          upstream.end();
          return;
        }

        if (msg.type === 'cancel') {
          clientWantsLive = false;
          cleanup();
          sendJson(clientWs, { type: 'done' });
          return;
        }

        sendJson(clientWs, { type: 'error', error: `Unknown type: ${msg.type}` });
      } catch (err) {
        sendJson(clientWs, { type: 'error', error: err.message || 'STT stream error' });
      }
    });

    clientWs.on('close', cleanup);
    clientWs.on('error', cleanup);
  });

  console.log(`[helm-v2] STT WebSocket ${PATH} (Deepgram proxy)`);
  return wss;
}
