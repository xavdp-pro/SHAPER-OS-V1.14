/**
 * Voice end-of-utterance commands.
 * Last-token match after accent-strip — FR STT often writes « gros » / « claire ».
 */

/** Send command is « go ». FR STT often writes vasy / vas y / gros instead. */
const SEND_LAST = new Set([
  'go', 'gau', 'gaux', 'goa', 'gow', 'goh',
  'gros', 'gout', 'goal',
  'vasy', 'vazi', 'vassy',
]);

const SEND_LAST_PHRASE = new Set([
  'vas y', 'va sy', 'vas yi',
]);

const SEND_SOLO = new Set();

const CLEAR_LAST = new Set([
  'clear', 'klear', 'cleare', 'cleer',
  'claire', 'clair', 'clere', 'cler', 'clerc',
  'efface', 'effacer', 'borrar',
]);

const CLEAR_SOLO = new Set();

/** Interrupt the running agent. Said alone, mid-run — never mixed with a message. */
const STOP_LAST = new Set([
  'stop', 'stoppe', 'stopp', 'stope', 'stoppez',
  'arrete', 'arretes', 'arretez', 'annule', 'annuler',
]);

const STOP_SOLO = new Set();

/** Reborn command: resets session, reloads context, re-runs presentation. */
const REBORN_LAST = new Set([
  'reborn', 'reborne', 'rebourne', 'reborns', 'rebornes',
  'rayborn', 'riborn', 'rebot', 'reboot', 'reboote', 'rebooter', 'rebootez',
  'reinitialise', 'reinitialiser', 'reinitialisez',
  'recommence', 'recommencer', 'recommencez',
  'reset', 'resette', 'resetter',
]);

const REBORN_PHRASE = new Set([
  're born', 'fais un reborn', 'lance un reborn',
  'remets a zero', 'remise a zero', 'recommence tout',
  'nouveau depart', 'nouvelle session',
]);

const REBORN_SOLO = new Set();

export const VOICE_SEND_WORD = 'go';
export const VOICE_CLEAR_WORD = 'clear';
export const VOICE_STOP_WORD = 'stop';
export const VOICE_REBORN_WORD = 'reborn';

export const VOICE_SEND_KEYTERMS = [
  'go', 'vasy', 'vas-y', 'vas y',
  'clear', 'claire', 'clair', 'efface', 'effacer',
  'stop', 'stoppe', 'arrête', 'arrêter',
  'reborn', 'reboot', 'recommence', 'remets à zéro',
];

export function normalizeVoiceCommand(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  return normalizeVoiceCommand(text).split(' ').filter(Boolean);
}

function splitLast(text, lastSet, soloSet, phraseSet = new Set()) {
  const parts = tokens(text);
  if (!parts.length) return { triggered: false, message: '' };
  const last = parts[parts.length - 1];
  const lastTwo = parts.length >= 2 ? `${parts[parts.length - 2]} ${last}` : '';
  const phraseHit = Boolean(lastTwo && phraseSet.has(lastTwo));
  const solo = parts.length === 1;
  const hit = phraseHit || lastSet.has(last) || (solo && soloSet.has(last));
  if (!hit) return { triggered: false, message: String(text || '').trim() };
  const rest = phraseHit ? parts.slice(0, -2).join(' ') : parts.slice(0, -1).join(' ');
  if (!rest) return { triggered: true, message: '', keywordOnly: true };
  return { triggered: true, message: rest };
}

export function splitVoiceSendCommand(text) {
  return splitLast(text, SEND_LAST, SEND_SOLO, SEND_LAST_PHRASE);
}

export function splitVoiceClearCommand(text) {
  return splitLast(text, CLEAR_LAST, CLEAR_SOLO);
}

export function splitVoiceStopCommand(text) {
  return splitLast(text, STOP_LAST, STOP_SOLO);
}

export function splitVoiceRebornCommand(text) {
  return splitLast(text, REBORN_LAST, REBORN_SOLO, REBORN_PHRASE);
}

/**
 * Stop is accepted anywhere in the frame — it must survive a noisy transcript —
 * but only in a short utterance, so the agent's own spoken words cannot abort
 * its run when the mic hears the TTS.
 */
const STOP_MAX_TOKENS = 3;

export function hasVoiceStopKeyword(text) {
  const parts = tokens(text);
  if (!parts.length || parts.length > STOP_MAX_TOKENS) return false;
  return parts.some((tk) => STOP_LAST.has(tk));
}

const REBORN_MAX_TOKENS = 6;

export function hasVoiceRebornKeyword(text) {
  const norm = normalizeVoiceCommand(text);
  if (!norm) return false;
  for (const phrase of REBORN_PHRASE) {
    if (norm === phrase || norm.endsWith(` ${phrase}`) || norm.startsWith(`${phrase} `)) return true;
  }
  const parts = tokens(text);
  if (!parts.length || parts.length > REBORN_MAX_TOKENS) return false;
  return parts.some((tk) => REBORN_LAST.has(tk));
}
