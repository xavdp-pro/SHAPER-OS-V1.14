/**
 * Cartesia Sonic emotion ids (display strip + TTS keep).
 * @see https://docs.cartesia.ai/build-with-cartesia/sonic-3/volume-speed-emotion
 */
export const SONIC_EMOTIONS = [
  'neutral', 'happy', 'excited', 'enthusiastic', 'elated', 'euphoric', 'triumphant',
  'amazed', 'surprised', 'flirtatious', 'curious', 'content', 'peaceful', 'serene',
  'calm', 'grateful', 'affectionate', 'trust', 'sympathetic', 'anticipation', 'mysterious',
  'angry', 'mad', 'outraged', 'frustrated', 'agitated', 'threatened', 'disgusted',
  'contempt', 'envious', 'sarcastic', 'ironic', 'sad', 'dejected', 'melancholic',
  'disappointed', 'hurt', 'guilty', 'bored', 'tired', 'rejected', 'nostalgic', 'wistful',
  'apologetic', 'hesitant', 'insecure', 'confused', 'resigned', 'anxious', 'panicked',
  'alarmed', 'scared', 'proud', 'confident', 'distant', 'skeptical', 'contemplative',
  'determined',
];

/** Legacy ElevenLabs-style tags still accepted by TTS mapping. */
const EMOTION_ALIASES = [
  'emphatic', 'whisper', 'whispers', 'laugh', 'laughs', 'laughing',
  'sigh', 'sighs', 'joy', 'joyful', 'fear', 'fearful', 'love', 'warm',
  'serious', 'thinking',
];

const TAG_SET = new Set([
  ...SONIC_EMOTIONS,
  ...EMOTION_ALIASES,
].map((s) => s.toLowerCase()));

function normalizeTag(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/_/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Remove emotion tags from text for UI display.
 * Keeps markdown links `[label](url)` and other non-emotion brackets.
 * Raw text (with tags) must still be passed to TTS unchanged.
 */
export function stripEmotionTagsForDisplay(text, { streaming = false } = {}) {
  let out = String(text || '');
  if (!out) return '';

  out = out.replace(/\[([^\]]+)\](?!\()/g, (full, inner) => {
    const key = normalizeTag(inner);
    if (TAG_SET.has(key)) return '';
    return full;
  });

  // Hide incomplete trailing tag while streaming: "[exc"
  if (streaming) {
    out = out.replace(/\[[^\]]*$/g, '');
  }

  return out.replace(/[ \t]{2,}/g, ' ').replace(/ ?\n ?/g, '\n').trimStart();
}

/**
 * Split script text into one TTS segment per emotion tag.
 * Cartesia HTTP applies only the first emotion to a whole payload —
 * admin "script complet" must call TTS once per segment.
 * @param {string} text
 * @returns {string[]}
 */
export function splitEmotionSegments(text) {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  const re = /\[([^\]]+)\](?!\()/g;
  /** @type {{ index: number }[]} */
  const hits = [];
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (TAG_SET.has(normalizeTag(m[1]))) {
      hits.push({ index: m.index });
    }
  }
  if (!hits.length) return [raw.trim()];

  const out = [];
  if (hits[0].index > 0) {
    const pre = raw.slice(0, hits[0].index).trim();
    if (pre) out.push(pre);
  }
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : raw.length;
    const seg = raw.slice(start, end).trim();
    if (seg) out.push(seg);
  }
  return out;
}
