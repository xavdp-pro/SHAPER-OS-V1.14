/** Soft cap of speakable prose kept for one Cursor reply (chunked for TTS). */
export const VOICE_TTS_MAX_CHARS = 12000;

/** Soft target before forcing a mid-sentence TTS break while streaming. */
export const VOICE_STREAM_SOFT_MIN = 120;
/** Hard max pending chars before a forced break at a word boundary. */
export const VOICE_STREAM_HARD_MAX = 360;
/** First spoken piece — low enough to start quickly, high enough to avoid "OK." alone. */
export const VOICE_STREAM_FIRST_MIN = 40;
/**
 * Pack several short sentences into one TTS utterance so periods don't chop audio.
 * Greetings like "Bonjour X. Je suis Y. Dis-moi…" must stay one Speak/context.
 */
export const VOICE_TTS_PACK_MIN = 220;
/** Short complete replies speak as a single payload (no per-period split). */
export const VOICE_TTS_PREFER_SINGLE_MAX = 480;
/** Must stay under server /voice/tts MAX_TTS_CHARS (2000). */
export const VOICE_TTS_CHUNK_MAX = 1500;

/** If the text is exactly the same message pasted twice, keep one copy. */
export function undoubleSpeechText(text, previous = '') {
  let t = String(text || '');
  if (!t) return previous || '';
  const prev = String(previous || '');
  if (prev && t === prev + prev) return prev;

  const half = Math.floor(t.length / 2);
  if (half >= 12 && t.length === half * 2 && t.slice(0, half) === t.slice(half)) {
    return t.slice(0, half);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let len = Math.floor(t.length / 2); len >= 12; len -= 1) {
      if (t.slice(0, len) === t.slice(len, len * 2)) {
        t = t.slice(0, len) + t.slice(len * 2);
        changed = true;
        break;
      }
    }
    if (changed) continue;
    for (let len = Math.floor(t.length / 2); len >= 12; len -= 1) {
      if (t.length >= len * 2 && t.slice(-len) === t.slice(-len * 2, -len)) {
        t = t.slice(0, -len);
        changed = true;
        break;
      }
    }
  }
  return t;
}

/**
 * Make Unix paths TTS-friendly: /apps/helm-v2/app → "apps helm-v2 app"
 * (avoid engines reading "/" as "slash").
 */
export function speakableUnixPaths(text) {
  let raw = String(text || '');
  raw = raw.replace(
    /(^|[\s(,])(\/[\w.@+-]+(?:\/[\w.@+-]+)*)/g,
    (_, prefix, unixPath) => `${prefix}${unixPath.slice(1).replace(/\//g, ' ')}`,
  );
  raw = raw.replace(
    /(^|[\s(])((?:[\w.@+-]+\/)+[\w.@+-]+)/g,
    (_, prefix, unixPath) => `${prefix}${unixPath.replace(/\//g, ' ')}`,
  );
  raw = raw.replace(/\b(slash|barre oblique)\b/gi, ' ');
  return raw.replace(/\s{2,}/g, ' ').trim();
}

function localeLang(locale) {
  const s = String(locale || 'fr').toLowerCase();
  if (s.startsWith('es')) return 'es';
  if (s.startsWith('en')) return 'en';
  return 'fr';
}

function unitWord(unit, lang) {
  const u = String(unit || '').toLowerCase();
  const table = {
    fr: { tib: 'téraoctets', tb: 'téraoctets', gib: 'gigaoctets', gb: 'gigaoctets', mib: 'mégaoctets', mb: 'mégaoctets', kib: 'kilooctets', kb: 'kilooctets', ghz: 'gigahertz', mhz: 'mégahertz' },
    en: { tib: 'terabytes', tb: 'terabytes', gib: 'gigabytes', gb: 'gigabytes', mib: 'megabytes', mb: 'megabytes', kib: 'kilobytes', kb: 'kilobytes', ghz: 'gigahertz', mhz: 'megahertz' },
    es: { tib: 'terabytes', tb: 'terabytes', gib: 'gigabytes', gb: 'gigabytes', mib: 'megabytes', mb: 'megabytes', kib: 'kilobytes', kb: 'kilobytes', ghz: 'gigahertz', mhz: 'megahertz' },
  };
  return (table[lang] || table.fr)[u] || unit;
}

function speakNumber(raw, lang) {
  let n = String(raw || '').trim();
  if (!n) return '';
  if (/^\d+\.0+$/.test(n) || /^\d+,0+$/.test(n)) n = n.split(/[.,]/)[0];
  else if (lang !== 'en') n = n.replace(/(\d)\.(\d)/g, '$1,$2');
  return n;
}

function speakableTechUnits(text, locale) {
  const lang = localeLang(locale);
  const percent = lang === 'en' ? 'percent' : lang === 'es' ? 'por ciento' : 'pour cent';
  let raw = String(text || '');
  raw = raw.replace(
    /\b(\d+(?:[.,]\d+)?)\s*(TiB|Tib|TB|GiB|Gib|GB|MiB|Mib|MB|KiB|Kib|KB|GHz|MHz)\b/gi,
    (_, num, unit) => `${speakNumber(num, lang)} ${unitWord(unit, lang)}`,
  );
  raw = raw.replace(/\b(\d+(?:[.,]\d+)?)\s*%/g, (_, num) => `${speakNumber(num, lang)} ${percent}`);
  return raw;
}

function splitTableCells(line) {
  let s = String(line || '').trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim().replace(/\s+/g, ' '));
}

function isGfmSep(line) {
  const cells = splitTableCells(line);
  return cells.length >= 2 && cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, '')));
}

function isGfmRow(line) {
  const s = String(line || '').trim();
  if (!s.includes('|')) return false;
  if (isGfmSep(s)) return false;
  return splitTableCells(s).length >= 2;
}

function cleanCell(s) {
  return String(s || '')
    .replace(/^\*+|\*+$/g, '')
    .replace(/[()]/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function speakTableRow(headers, cells, lang) {
  const subject = cleanCell(cells[0] || '');
  const parts = [];
  for (let i = 1; i < headers.length; i += 1) {
    const label = cleanCell(headers[i] || '');
    const value = cleanCell(cells[i] || '');
    if (!label || !value || /^-+$/.test(value)) continue;
    parts.push(`${label} ${value}`);
  }
  if (!subject && !parts.length) return '';
  if (!parts.length) return subject;
  const join = lang === 'en' ? ', ' : ', ';
  return subject ? `${subject} : ${parts.join(join)}.` : `${parts.join(join)}.`;
}

/**
 * Markdown GFM tables → labeled sentences for TTS (driving / technical data).
 * | Type | Total | Used |  →  "RAM physique : Total 8 gigaoctets, Utilisé 2,2 gigaoctets."
 */
export function speakableMarkdownTables(text, locale) {
  const lang = localeLang(locale);
  const lines = String(text || '').split(/\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (isGfmRow(lines[i]) && i + 1 < lines.length && isGfmSep(lines[i + 1])) {
      const headers = splitTableCells(lines[i]).map(cleanCell);
      i += 2;
      const spoken = [];
      while (i < lines.length && isGfmRow(lines[i])) {
        const row = speakTableRow(headers, splitTableCells(lines[i]), lang);
        if (row) spoken.push(row);
        i += 1;
      }
      out.push(spoken.join(' '));
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join('\n');
}

/**
 * Cumulative assistant text from live SSE (or final).
 * @param {object} event
 * @returns {{ text: string, final: boolean, runKey: string }}
 */
export function extractCursorStreamSpeech(event) {
  if (!event || typeof event !== 'object') {
    return { text: '', final: false, runKey: '' };
  }
  const runKey = String(event.composer_id || event.chat_id || event.conversation || '');
  if (event.type === 'response') {
    return { text: String(event.text || ''), final: false, runKey };
  }
  // Only response_complete carries the full text. run_complete is a lifecycle ping.
  if (event.type === 'response_complete') {
    return { text: String(event.text || ''), final: true, runKey };
  }
  if (event.type === 'run_complete') {
    return { text: '', final: true, runKey, lifecycleOnly: true };
  }
  return { text: '', final: false, runKey };
}

/** @deprecated prefer extractCursorStreamSpeech */
export function extractCursorResponseText(event) {
  const { text, final } = extractCursorStreamSpeech(event);
  return final ? text.trim() : '';
}

/**
 * Strip code / markdown — keep speakable prose + ElevenLabs v3 audio tags [excited]…
 * @param {string} text
 * @param {number | { max?: number, streaming?: boolean }} [maxOrOpts]
 */
export function speechTextFromAssistant(text, maxOrOpts = VOICE_TTS_MAX_CHARS) {
  const opts = typeof maxOrOpts === 'number'
    ? { max: maxOrOpts, streaming: false }
    : { max: VOICE_TTS_MAX_CHARS, streaming: false, ...maxOrOpts };
  const max = opts.max ?? VOICE_TTS_MAX_CHARS;

  let raw = String(text || '');
  raw = undoubleSpeechText(raw);
  if (!raw.trim()) return '';
  const locale = opts.locale || 'fr';
  raw = speakableMarkdownTables(raw, locale);

  // Closed fences first; while streaming, also drop an unfinished fence tail
  raw = raw.replace(/```[\s\S]*?```/g, ' ');
  if (opts.streaming) {
    raw = raw.replace(/```[\s\S]*$/g, ' ');
  }
  raw = raw.replace(/`[^`\n]+`/g, ' ');
  raw = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  raw = raw.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  raw = raw.replace(/<[^>]+>/g, ' ');
  raw = raw.replace(/^#{1,6}\s+/gm, '');
  // Markdown links/images — leave bare [audio tags] intact
  raw = raw.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  raw = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  raw = raw.replace(/https?:\/\/\S+/g, ' ');
  raw = raw.replace(/^\s*[-*+]\s+/gm, '');
  raw = raw.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1');
  raw = speakableTechUnits(raw, locale);
  raw = raw.replace(/\s+/g, ' ').trim();

  // Hold back an incomplete audio tag at the end while streaming: "[exci"
  if (opts.streaming) {
    raw = raw.replace(/\[[^\]]*$/g, '').trim();
  }

  if (!raw) return '';
  raw = speakableUnixPaths(raw);
  if (raw.length <= max) return raw;
  return raw.slice(0, max);
}

function splitOversizedChunk(text, max = VOICE_TTS_CHUNK_MAX) {
  const s = String(text || '').trim();
  if (!s) return [];
  if (s.length <= max) return [s];
  const out = [];
  let rest = s;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let breakAt = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf(', '),
      window.lastIndexOf(' '),
    );
    if (breakAt < max * 0.4) breakAt = max;
    else breakAt += 1;
    out.push(rest.slice(0, breakAt).trim());
    rest = rest.slice(breakAt).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/**
 * Pull speakable chunks from text not yet queued for TTS.
 * Packs several sentences into one utterance so TTS is not chopped at every period.
 * @param {string} pending — speechText.slice(alreadyQueuedLen)
 * @param {{ final?: boolean, softMin?: number, hardMax?: number, firstChunk?: boolean, packMin?: number, preferSingleMax?: number }} [opts]
 * @returns {{ chunks: string[], consumed: number }}
 */
export function takeSpeakableChunks(pending, opts = {}) {
  const softMin = opts.softMin ?? VOICE_STREAM_SOFT_MIN;
  const hardMax = opts.hardMax ?? VOICE_STREAM_HARD_MAX;
  const packMin = opts.packMin ?? VOICE_TTS_PACK_MIN;
  const preferSingleMax = opts.preferSingleMax ?? VOICE_TTS_PREFER_SINGLE_MAX;
  const final = Boolean(opts.final);
  const firstChunk = Boolean(opts.firstChunk);
  // First spoken piece: avoid stubs, but don't wait for a full softMin paragraph.
  const minSentence = firstChunk ? VOICE_STREAM_FIRST_MIN : softMin;

  let rest = String(pending || '');
  const chunks = [];
  let consumed = 0;

  const pushSlice = (end) => {
    const slice = rest.slice(0, end);
    const spoken = slice.trim();
    if (spoken) {
      for (const piece of splitOversizedChunk(spoken)) chunks.push(piece);
    }
    consumed += end;
    rest = rest.slice(end);
  };

  // Short complete replies (session greeting, brief answers): one TTS payload.
  if (final && rest.trim() && rest.trim().length <= preferSingleMax) {
    pushSlice(rest.length);
    return { chunks, consumed };
  }

  while (rest) {
    // Prefer sentence end. While streaming, do NOT treat "…" as an end —
    // models often emit ellipsis mid-thought and that chops the first phrase.
    const sentenceRe = final
      ? /^([\s\S]*?[.!?…]+)(\s+|$)/
      : /^([\s\S]*?[.!?]+)(\s+|$)/;
    const sentence = rest.match(sentenceRe);
    if (sentence && sentence[1].trim().length >= 2) {
      const spokenLen = sentence[1].trim().length;
      // Hold tiny openers ("OK.", "Sur ce.") until more text arrives — unless final.
      if (!final && spokenLen < minSentence) break;

      // Pack following short sentences into the same utterance (avoids period chops).
      let end = sentence[0].length;
      while (end < rest.length) {
        const packed = rest.slice(0, end).trim();
        if (packed.length >= packMin) break;
        const more = rest.slice(end).match(sentenceRe);
        if (!more || more[1].trim().length < 2) break;
        end += more[0].length;
      }

      // While streaming, only emit once the packed utterance is meaty enough.
      if (!final && rest.slice(0, end).trim().length < minSentence) break;

      pushSlice(end);
      continue;
    }

    // Newline as phrase break
    const nl = rest.match(/^([\s\S]*?\n)([\s\S]*)$/);
    if (nl && nl[1].trim().length >= softMin) {
      pushSlice(nl[1].length);
      continue;
    }

    // Soft break when the buffer is getting long
    if (rest.length >= hardMax) {
      const window = rest.slice(0, hardMax);
      const breaks = [
        window.lastIndexOf('. '),
        window.lastIndexOf('! '),
        window.lastIndexOf('? '),
        window.lastIndexOf(', '),
        window.lastIndexOf('; '),
        window.lastIndexOf(': '),
        window.lastIndexOf(' — '),
        window.lastIndexOf(' - '),
        window.lastIndexOf(' '),
      ];
      const breakAt = Math.max(...breaks);
      if (breakAt >= softMin) {
        pushSlice(breakAt + 1);
        continue;
      }
      pushSlice(hardMax);
      continue;
    }

    break;
  }

  if (final && rest.trim()) {
    pushSlice(rest.length);
  }

  return { chunks, consumed };
}

/** @deprecated use speechTextFromAssistant */
export function textForVoicePlayback(text, max = VOICE_TTS_MAX_CHARS) {
  return speechTextFromAssistant(text, max);
}
