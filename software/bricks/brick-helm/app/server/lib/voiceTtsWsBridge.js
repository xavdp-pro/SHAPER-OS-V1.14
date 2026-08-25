import { WebSocketServer } from 'ws';
import { parse as parseCookie } from 'cookie';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { normalizeLocale } from './locale.js';
import { cartesiaConfigured } from './cartesiaVoices.js';
import { deepgramConfigured } from './deepgramVoices.js';
import { ttsProvider } from './ttsProvider.js';
import {
  openCartesiaTtsContext,
  resolveCartesiaVoiceId,
  CARTESIA_WS_SAMPLE_RATE,
  CARTESIA_WS_ENCODING,
} from './cartesiaTtsWs.js';
import {
  openDeepgramTtsContext,
  resolveDeepgramVoiceId,
  DEEPGRAM_WS_SAMPLE_RATE,
  DEEPGRAM_WS_ENCODING,
} from './deepgramTtsWs.js';
import { normalizeTtsPronunciation } from './voiceTtsPronounce.js';

const PATH = '/api/voice/tts-stream';

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

function streamProviderAvailable() {
  const p = ttsProvider();
  if (p === 'cartesia') return cartesiaConfigured();
  if (p === 'deepgram') return deepgramConfigured();
  return false;
}

/**
 * Attach Helm ↔ browser WebSocket that proxies Cartesia or Deepgram TTS streaming.
 * Protocol (JSON):
 *   client → { type: 'start', lang?, voiceId? }
 *   client → { type: 'push', transcript: string }
 *   client → { type: 'end', transcript?: string }
 *   client → { type: 'cancel' }
 *   server → { type: 'ready', contextId, sampleRate, encoding, voiceId, language, modelId, timestamps? }
 *   server → { type: 'audio', data: base64 pcm }
 *   server → { type: 'timestamps', words, start, end }  (Cartesia only)
 *   server → { type: 'done' }
 *   server → { type: 'error', error: string }
 */
export function attachVoiceTtsWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== PATH) return;

    const user = authFromUpgradeRequest(req);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!streamProviderAvailable()) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (clientWs) => {
    let upstream = null;
    let closing = false;
    let clientLang = 'fr';

    const cleanup = () => {
      if (closing) return;
      closing = true;
      try { upstream?.cancel(); } catch { /* ignore */ }
      upstream = null;
    };

    clientWs.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        sendJson(clientWs, { type: 'error', error: 'Message JSON invalide' });
        return;
      }

      try {
        if (msg.type === 'start') {
          if (upstream) {
            upstream.cancel();
            upstream = null;
          }
          const lang = normalizeLocale(msg.lang);
          clientLang = lang;
          const provider = ttsProvider();

          const onAudio = (data) => sendJson(clientWs, { type: 'audio', data });
          const onTimestamps = (wt) => sendJson(clientWs, {
            type: 'timestamps',
            words: wt.words,
            start: wt.start,
            end: wt.end,
          });
          const onDone = () => {
            sendJson(clientWs, { type: 'done' });
            upstream = null;
          };
          const onError = (err) => {
            const message = err?.message || 'TTS stream error';
            console.error('[tts-ws] stream failed', {
              provider: ttsProvider(),
              message,
              status: err?.status || null,
            });
            sendJson(clientWs, {
              type: 'error',
              error: message,
            });
            upstream = null;
          };

          if (provider === 'deepgram') {
            const voiceId = await resolveDeepgramVoiceId(lang, msg.voiceId);
            upstream = openDeepgramTtsContext({
              locale: lang,
              voiceId,
              onAudio,
              onTimestamps,
              onDone,
              onError,
            });
            await upstream.waitOpen();
            sendJson(clientWs, {
              type: 'ready',
              provider: 'deepgram',
              contextId: upstream.contextId,
              sampleRate: DEEPGRAM_WS_SAMPLE_RATE,
              encoding: DEEPGRAM_WS_ENCODING,
              voiceId: upstream.voiceId,
              language: upstream.language,
              modelId: upstream.modelId,
              timestamps: false,
            });
            return;
          }

          const voiceId = await resolveCartesiaVoiceId(lang, msg.voiceId);
          upstream = openCartesiaTtsContext({
            locale: lang,
            voiceId,
            onAudio,
            onTimestamps,
            onDone,
            onError,
          });
          await upstream.waitOpen();
          sendJson(clientWs, {
            type: 'ready',
            provider: 'cartesia',
            contextId: upstream.contextId,
            sampleRate: CARTESIA_WS_SAMPLE_RATE,
            encoding: CARTESIA_WS_ENCODING,
            voiceId: upstream.voiceId,
            language: upstream.language,
            modelId: upstream.modelId,
            timestamps: true,
          });
          return;
        }

        if (msg.type === 'push') {
          if (!upstream) throw new Error('Session TTS non démarrée (start requis)');
          const text = normalizeTtsPronunciation(msg.transcript || '', clientLang);
          upstream.push(text);
          return;
        }

        if (msg.type === 'end') {
          if (!upstream) {
            sendJson(clientWs, { type: 'done' });
            return;
          }
          const text = normalizeTtsPronunciation(msg.transcript || '', clientLang);
          upstream.end(text);
          return;
        }

        if (msg.type === 'cancel') {
          cleanup();
          sendJson(clientWs, { type: 'done' });
          return;
        }

        sendJson(clientWs, { type: 'error', error: `Unknown type: ${msg.type}` });
      } catch (err) {
        const message = err?.message || 'TTS stream error';
        console.error('[tts-ws] handler error', {
          provider: ttsProvider(),
          message,
          type: msg?.type || null,
        });
        sendJson(clientWs, { type: 'error', error: message });
      }
    });

    clientWs.on('close', cleanup);
    clientWs.on('error', cleanup);
  });

  console.log(`[helm-v2] TTS WebSocket ${PATH} (Cartesia / Deepgram proxy)`);
  return wss;
}
