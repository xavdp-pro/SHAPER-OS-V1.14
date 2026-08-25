/**
 * Karaoke timings.
 * Cartesia streams real word timestamps.
 * Deepgram / ElevenLabs do not — highlight the current sentence from the PCM clock.
 */

/** Spoken chars per second (Aura / typical FR TTS). */
export const KARAOKE_CHARS_PER_SEC = 13;

/** Punctuation adds a pause the synthesizer actually renders. */
function weightForWord(word) {
  const bare = word.replace(/[^\p{L}\p{N}']/gu, '');
  let weight = Math.max(1, bare.length);
  if (/[,;:]$/.test(word)) weight += 1.5;
  if (/[.!?…]$/.test(word)) weight += 3;
  return weight;
}

function weightForSentence(sentence) {
  const s = String(sentence || '').replace(/\s+/g, ' ').trim();
  let weight = Math.max(8, s.length);
  if (/[.!?…]$/.test(s)) weight += 10;
  return weight;
}

function countWordsIn(text) {
  return (String(text || '').match(/\S+/g) || []).length;
}

/**
 * Split spoken text into sentences (punctuation stays with the phrase).
 * @param {string} text
 * @returns {string[]}
 */
export function splitKaraokeSentences(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const parts = [];
  const re = /[^.!?…]+(?:[.!?…]+)?(?:\s+|$)/g;
  let m;
  while ((m = re.exec(raw))) {
    const s = m[0].trim();
    if (s) parts.push(s);
  }
  if (!parts.length) parts.push(raw);
  return parts;
}

/**
 * Estimated audio duration from spoken text length.
 * @param {string} text
 * @returns {number}
 */
export function estimatedSpeechDuration(text) {
  const chars = String(text || '').replace(/\s+/g, ' ').trim().length;
  return Math.max(0.8, chars / KARAOKE_CHARS_PER_SEC);
}

/**
 * Split `text` into words spread over `durationSec`, offset by `baseSec`.
 * @param {string} text
 * @param {number} durationSec total audio duration for this text
 * @param {number} [baseSec] offset when several chunks play back to back
 * @returns {Array<{ word: string, start: number, end: number, weight: number }>}
 */
export function estimateKaraokeWords(text, durationSec, baseSec = 0) {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const weights = words.map(weightForWord);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return [];

  const out = [];
  let cursor = baseSec;
  for (let i = 0; i < words.length; i++) {
    const span = (weights[i] / total) * duration;
    const start = cursor;
    const end = i === words.length - 1 ? baseSec + duration : start + span;
    out.push({ word: words[i], start, end, weight: weights[i] });
    cursor = end;
  }
  return out;
}

/**
 * Sentence windows clocked on playback seconds — one highlight per phrase.
 * `wordStart` / `wordEnd` map onto the spoken-text word index (markdown karaoke).
 *
 * @param {string} text
 * @param {number} durationSec
 * @param {number} [baseSec]
 * @returns {Array<{
 *   word: string,
 *   text: string,
 *   start: number,
 *   end: number,
 *   wordStart: number,
 *   wordEnd: number,
 *   weight: number,
 * }>}
 */
export function estimateKaraokeSentences(text, durationSec, baseSec = 0) {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const sentences = splitKaraokeSentences(text);
  if (!sentences.length) return [];

  const weights = sentences.map(weightForSentence);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return [];

  const out = [];
  let cursor = baseSec;
  let wordCursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const span = (weights[i] / total) * duration;
    const start = cursor;
    const end = i === sentences.length - 1 ? baseSec + duration : start + span;
    const nWords = Math.max(1, countWordsIn(sentences[i]));
    out.push({
      word: sentences[i],
      text: sentences[i],
      start,
      end,
      wordStart: wordCursor,
      wordEnd: wordCursor + nWords,
      weight: weights[i],
    });
    wordCursor += nWords;
    cursor = end;
  }
  return out;
}

/**
 * Stretch existing sentence units onto a measured PCM duration.
 * @param {Array<{ word?: string, text?: string, weight?: number, wordStart?: number, wordEnd?: number }>} units
 * @param {number} durationSec
 * @param {number} [baseSec]
 */
export function rescaleKaraokeUnits(units, durationSec, baseSec = 0) {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0 || !Array.isArray(units) || !units.length) {
    return [];
  }
  const weights = units.map((u) => (
    Number.isFinite(u.weight) && u.weight > 0
      ? u.weight
      : weightForSentence(u.word || u.text || '')
  ));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return units.slice();

  const out = [];
  let cursor = baseSec;
  for (let i = 0; i < units.length; i++) {
    const span = (weights[i] / total) * duration;
    const start = cursor;
    const end = i === units.length - 1 ? baseSec + duration : start + span;
    out.push({
      ...units[i],
      start,
      end,
      weight: weights[i],
    });
    cursor = end;
  }
  return out;
}

/**
 * Active unit index for a playback clock.
 * @param {Array<{ start: number, end: number }>} units
 * @param {number} playbackSec
 * @returns {number}
 */
export function karaokeIndexAt(units, playbackSec) {
  const list = Array.isArray(units) ? units : [];
  const t = Number(playbackSec);
  if (!list.length || !Number.isFinite(t)) return -1;
  let idx = -1;
  for (let i = 0; i < list.length; i++) {
    if (t >= list[i].start) idx = i;
    if (t < list[i].end) {
      idx = i;
      break;
    }
  }
  return idx;
}
