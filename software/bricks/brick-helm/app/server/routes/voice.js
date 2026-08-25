import { Router } from 'express';
import { authMiddleware } from './auth.js';
import { config } from '../config.js';
import { normalizeLocale, LOCALES } from '../lib/locale.js';
import {
  elevenLabsConfigured,
  elevenLabsVoiceId,
} from '../lib/elevenlabsClient.js';
import {
  ttsConfigured,
  ttsProvider,
  sttProvider,
  voiceSelectionState,
  synthesizeSpeech,
  transcribeSpeech,
  listTtsVoices,
  testScriptForLocale,
  quickTestForLocale,
  resolveTtsProvider,
  availableTtsProviders,
  ttsBillingStatus,
} from '../lib/ttsProvider.js';
import { cartesiaTtsModel } from '../lib/cartesiaClient.js';
import { deepgramTtsModelFamily } from '../lib/deepgramClient.js';
import { groqConfigured, generateVoiceAck, generateVoiceConverse } from '../lib/groqClient.js';
import { buildEntityAck } from '../lib/groqAck.js';
import { normalizeTranscript } from '../lib/voiceNormalize.js';
import { getVoiceLexicon, invalidateVoiceLexicon } from '../lib/voiceLexicon.js';
import {
  listVoiceAliases, createVoiceAlias, deleteVoiceAlias,
} from '../lib/voiceAliasStore.js';

function activeTtsModel(provider) {
  if (provider === 'cartesia') return cartesiaTtsModel();
  if (provider === 'deepgram') return deepgramTtsModelFamily();
  if (provider === 'elevenlabs') return elevenLabsTtsModel();
  return null;
}

function catalogNotesFor(provider) {
  if (provider === 'cartesia') {
    return {
      tip: 'Cartesia Sonic WebSocket — streaming TTS (PCM) via /api/voice/tts-stream. STT: Deepgram if DEEPGRAM_API_KEY.',
    };
  }
  if (provider === 'deepgram') {
    return {
      tip: 'Deepgram Nova (live STT) + Aura-2 (TTS) — WebSockets /api/voice/stt-stream and /api/voice/tts-stream. Karaoke: current sentence (not word by word).',
    };
  }
  return {
    freeTierLibrary: 'Voice Library voices are not available via the API to free tier users.',
    tip: 'For native FR/ES ElevenLabs voices: paid plan / My Voices.',
  };
}

const router = Router();
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_TTS_CHARS = 2000;

function audioBufferFromBody(body) {
  const b64 = body?.audio;
  if (!b64 || typeof b64 !== 'string') return null;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > MAX_AUDIO_BYTES) return null;
  return buf;
}

router.get('/voice/status', authMiddleware, async (_req, res) => {
  try {
    const selection = await voiceSelectionState();
    const { stack } = selection;
    res.json({
      provider: stack.ttsProvider || stack.sttProvider || null,
      sttProvider: stack.sttProvider,
      sttModel: stack.sttModel,
      sttStream: Boolean(stack.sttStream),
      ttsProvider: stack.ttsProvider,
      configured: stack.configured,
      ttsStream: Boolean(stack.ttsStream),
      voiceId: elevenLabsConfigured() ? elevenLabsVoiceId() : null,
      voices: stack.ttsProvider ? selection.active : null,
      savedVoices: selection.saved,
      voiceMismatch: selection.mismatch,
      ttsModel: stack.ttsModel,
      karaoke: selection.karaoke,
      karaokeGrain: selection.karaokeGrain || (selection.karaoke ? 'word' : null),
      ttsProviderEnv: selection.ttsProviderEnv,
      groqAck: groqConfigured(),
      defaultConversation: config.cli.defaultConversation,
      devConversation: config.cli.devConversation,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Catalog of voices for the active TTS provider, or ?provider=cartesia|deepgram. */
router.get('/voice/catalog', authMiddleware, async (req, res) => {
  if (!ttsConfigured()) {
    return res.status(503).json({
      error: 'TTS not configured (CARTESIA_API_KEY, DEEPGRAM_API_KEY or ELEVENLABS_API_KEY)',
    });
  }
  try {
    const browse = req.query.provider ? resolveTtsProvider(req.query.provider) : ttsProvider();
    const lang = req.query.lang ? normalizeLocale(req.query.lang) : undefined;
    const [catalog, selection, billing] = await Promise.all([
      listTtsVoices(lang, browse),
      voiceSelectionState(browse),
      ttsBillingStatus(),
    ]);
    const scripts = Object.fromEntries(LOCALES.map((l) => [l, testScriptForLocale(l, browse)]));
    const localeStats = Object.fromEntries(LOCALES.map((l) => {
      const native = catalog.filter((v) => String(v.language || '').toLowerCase().startsWith(l));
      const verified = catalog.filter((v) => (
        Array.isArray(v.verifiedLangCodes) && v.verifiedLangCodes.includes(l)
      ));
      return [l, { native: native.length, verified: verified.length, total: catalog.length }];
    }));
    res.json({
      ok: true,
      provider: browse,
      activeProvider: ttsProvider(),
      availableProviders: availableTtsProviders(),
      billing,
      model: activeTtsModel(browse),
      voices: catalog,
      selected: selection.active,
      saved: selection.saved,
      mismatch: selection.mismatch,
      savedMeta: selection.savedMeta,
      stack: selection.stack,
      karaoke: browse === 'cartesia' || browse === 'deepgram',
      karaokeGrain: browse === 'cartesia' ? 'word' : browse === 'deepgram' ? 'sentence' : null,
      ttsProviderEnv: selection.ttsProviderEnv,
      ttsProviderSetting: selection.ttsProviderSetting,
      testScripts: scripts,
      localeStats,
      notes: catalogNotesFor(browse),
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Voice catalog failed' });
  }
});

router.get('/voice/stt-token', authMiddleware, async (_req, res) => {
  const stt = sttProvider();
  if (stt === 'deepgram') {
    return res.json({ ok: true, provider: 'deepgram', sttStream: true });
  }
  if (stt === 'elevenlabs') {
    const { createRealtimeSttToken } = await import('../lib/elevenlabsClient.js');
    try {
      const token = await createRealtimeSttToken();
      return res.json({ ok: true, provider: 'elevenlabs', token });
    } catch (err) {
      return res.status(502).json({ error: err.message || 'STT token failed' });
    }
  }
  return res.status(503).json({ error: 'STT not configured (DEEPGRAM_API_KEY)' });
});

router.post('/voice/stt', authMiddleware, async (req, res) => {
  if (!sttProvider()) {
    return res.status(503).json({ error: 'STT not configured (DEEPGRAM_API_KEY)' });
  }

  const buffer = audioBufferFromBody(req.body);
  if (!buffer) {
    return res.status(400).json({ error: 'Audio required (base64, max 8 MB)' });
  }

  const mimeType = String(req.body?.mimeType || 'audio/webm');
  const lang = normalizeLocale(req.body?.lang);

  try {
    const result = await transcribeSpeech(buffer, mimeType, lang);
    if (!result.text) {
      return res.status(422).json({ error: 'No speech detected' });
    }
    res.json({ ok: true, ...result, sttProvider: sttProvider() });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Transcription failed' });
  }
});

router.post('/voice/ack', authMiddleware, async (req, res) => {
  if (!groqConfigured()) {
    return res.status(503).json({ error: 'Groq not configured (GROQ_API_KEY)' });
  }

  const message = String(req.body?.message || req.body?.text || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'Message too long (max 4000)' });
  }

  const lang = normalizeLocale(req.body?.lang);

  const entities = Array.isArray(req.body?.entities) ? req.body.entities : [];
  // Resolved infra names → deterministic echo before execution.
  const entityAck = buildEntityAck(entities, lang);
  if (entityAck) {
    return res.json({ ok: true, text: entityAck, locale: lang, entities: true });
  }

  try {
    const result = await generateVoiceAck(message, lang);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[voice/ack]', err.message || err);
    const status = Number(err.status) === 429 ? 429 : 502;
    res.status(status).json({ ok: false, error: err.message || 'Groq ack failed' });
  }
});

/** Direct natural voice conversation with Zephir (quick turn-by-turn reply). */
router.post('/voice/chat', authMiddleware, async (req, res) => {
  if (!groqConfigured()) {
    return res.status(503).json({ error: 'Groq not configured (GROQ_API_KEY)' });
  }

  const message = String(req.body?.message || req.body?.text || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'Message too long (max 4000)' });
  }

  const lang = normalizeLocale(req.body?.lang);
  const history = Array.isArray(req.body?.history) ? req.body.history : [];

  try {
    const result = await generateVoiceConverse(message, lang, history);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[voice/chat]', err.message || err);
    res.status(500).json({ ok: false, error: err.message || 'Voice conversation error' });
  }
});

/** Groq phrase + one-shot TTS — fast spoken ack, separate from Composer stream. */
router.post('/voice/ack-speak', authMiddleware, async (req, res) => {
  if (!groqConfigured()) {
    return res.status(503).json({ error: 'Groq not configured (GROQ_API_KEY)' });
  }
  if (!ttsConfigured()) {
    return res.status(503).json({
      error: 'TTS not configured (CARTESIA_API_KEY, DEEPGRAM_API_KEY or ELEVENLABS_API_KEY)',
    });
  }

  const message = String(req.body?.message || req.body?.text || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'Message too long (max 4000)' });
  }

  const lang = normalizeLocale(req.body?.lang);

  try {
    const ack = await generateVoiceAck(message, lang);
    const spoken = await synthesizeSpeech(ack.text, lang, { skipAccent: true });
    res.json({
      ok: true,
      text: ack.text,
      model: ack.model,
      locale: ack.locale,
      ...spoken,
      ttsProvider: ttsProvider(),
    });
  } catch (err) {
    console.error('[voice/ack-speak]', err.message || err);
    const status = Number(err.status) === 429 ? 429 : 502;
    res.status(status).json({ ok: false, error: err.message || 'Groq vocal ack failed' });
  }
});

router.post('/voice/tts', authMiddleware, async (req, res) => {
  if (!ttsConfigured()) {
    return res.status(503).json({
      error: 'TTS not configured (CARTESIA_API_KEY, DEEPGRAM_API_KEY or ELEVENLABS_API_KEY)',
    });
  }

  const useScript = Boolean(req.body?.useTestScript);
  const useQuick = Boolean(req.body?.useQuickTest);
  const lang = normalizeLocale(req.body?.lang);
  const providerOverride = String(req.body?.provider || '').trim() || undefined;
  let text = String(req.body?.text || '').trim();
  if (useQuick) text = quickTestForLocale(lang, providerOverride);
  else if (useScript || !text) text = testScriptForLocale(lang, providerOverride);
  if (!text) return res.status(400).json({ error: 'Text required' });
  if (text.length > MAX_TTS_CHARS) {
    return res.status(400).json({ error: `Text too long (max ${MAX_TTS_CHARS})` });
  }

  const voiceId = String(req.body?.voiceId || '').trim() || undefined;
  const skipAccent = Boolean(req.body?.skipAccent);

  try {
    const result = await synthesizeSpeech(text, lang, { voiceId, skipAccent, provider: providerOverride });
    res.json({ ok: true, text, ...result, ttsProvider: result.provider || ttsProvider() });
  } catch (err) {
    console.error('[voice/tts]', err.message || err);
    const upstream = Number(err.status) || 502;
    const status = upstream === 401 ? 502 : ([400, 402, 403, 404, 422].includes(upstream) ? upstream : 502);
    const errorMsg = upstream === 401
      ? 'Voice provider API key (Cartesia/Deepgram/ElevenLabs) is invalid or expired'
      : (err.message || 'Speech synthesis failed');
    res.status(status).json({
      ok: false,
      error: errorMsg,
      code: err.data?.detail?.code || err.data?.code || undefined,
      detail: err.data?.detail || undefined,
    });
  }
});

/** Post-STT repair for infrastructure names (dynamic lexicon). */
router.post('/voice/normalize', authMiddleware, async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 8000) return res.status(400).json({ error: 'text too long' });
  try {
    const lexicon = await getVoiceLexicon();
    const result = normalizeTranscript(text, lexicon);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[voice/normalize]', err.message || err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* —— Voice aliases (spoken forms → canonical names) —— */

router.get('/voice/aliases', authMiddleware, async (_req, res) => {
  try {
    const aliases = await listVoiceAliases();
    const lexicon = await getVoiceLexicon();
    res.json({ ok: true, aliases, canonicals: lexicon.canonicals });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/voice/aliases', authMiddleware, async (req, res) => {
  try {
    const created = await createVoiceAlias(req.body?.alias, req.body?.canonical);
    invalidateVoiceLexicon();
    res.json({ ok: true, alias: created });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/voice/aliases/:id', authMiddleware, async (req, res) => {
  try {
    await deleteVoiceAlias(req.params.id);
    invalidateVoiceLexicon();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
