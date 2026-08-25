/**
 * Remove a leading oral-ack sentence from Composer replies on voice turns.
 * Groq already showed/spoke the ack — Composer must keep only the useful answer.
 */

export function isVoiceAckSentence(sentence) {
  const s = String(sentence || '').trim();
  if (!s) return false;
  return (
    /^(d['']?accord|ok|okay|oui|bien reçu|c['']est noté|entendu|parfait|très bien|je m['']en (occupe|charge)|je (m['']y )?mets)\b/i.test(s)
    || /^je me charge\b/i.test(s)
    || /^je (vais )?(vérifier|regarder|contrôler|controler|check|lance|m['']occupe)\b/i.test(s)
    || /^je vérifie ça\b/i.test(s)
    || /^(sure|got it|on it|i('ll| will) (check|look|take care))\b/i.test(s)
    || /^(de acuerdo|vale|me ocupo|voy a (comprobar|revisar|mirar))\b/i.test(s)
  );
}

function normalizeAck(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/["""«»]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/g, '')
    .trim();
}

/**
 * Display path: strip leading ack sentences, but keep a short ack-only reply
 * so the bubble is not empty.
 */
export function stripLeadingVoiceAck(text) {
  let t = String(text || '').trim();
  if (!t) return t;

  // Repeat up to 2x in case Composer stacks "D'accord. Je vérifie."
  for (let i = 0; i < 2; i += 1) {
    const m = t.match(/^([\s\S]*?[.!?…]+)(\s+)([\s\S]+)$/);
    if (!m) break;
    const first = m[1].trim();
    const rest = m[3].trim();
    if (!rest) break;
    if (!isVoiceAckSentence(first)) break;
    t = rest;
  }

  // Whole reply is only a short ack — keep it (better than empty bubble)
  if (isVoiceAckSentence(t) && t.length < 60) return t;
  return t;
}

/**
 * TTS path: never re-speak what Groq already said.
 * Returns '' when nothing useful remains after the oral ack.
 */
export function stripLeadingVoiceAckForTts(text, spokenAck = '') {
  let t = String(text || '').trim();
  if (!t) return '';

  for (let i = 0; i < 3; i += 1) {
    const m = t.match(/^([\s\S]*?[.!?…]+)(\s+)([\s\S]+)$/);
    if (!m) break;
    const first = m[1].trim();
    const rest = m[3].trim();
    if (!rest) break;
    if (!isVoiceAckSentence(first)) break;
    t = rest;
  }

  const ack = String(spokenAck || '').trim();
  if (ack) {
    const nT = normalizeAck(t);
    const nA = normalizeAck(ack);
    if (nT && nA && (nT === nA || nA.startsWith(nT) || nT.startsWith(nA))) {
      // Exact / near match with Groq ack — already spoken
      if (nT === nA || nA.startsWith(nT)) return '';
      // Composer = ack + answer glued without a clean sentence break
      const raw = t.trim();
      const ackRe = new RegExp(
        `^${ack.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.!?…,\\s-]*`,
        'i',
      );
      const stripped = raw.replace(ackRe, '').trim();
      if (stripped) t = stripped;
      else return '';
    }
  }

  // Pure ack left — Groq already covered it; skip TTS
  if (isVoiceAckSentence(t) && t.length < 80) return '';
  return t;
}
