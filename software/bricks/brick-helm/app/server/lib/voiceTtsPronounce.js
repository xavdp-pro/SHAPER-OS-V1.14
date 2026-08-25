/**
 * Canonical TTS Pronunciation Normalizer for Shaper OS & KovZu.
 *
 * Rules:
 *  1. Acronyms & technical abbreviations must be punctuated (e.g., G.E.D., L.X.C.)
 *     so the speech synthesizer spells them out letter-by-letter rather than
 *     mumbling or mispronouncing as a pseudo-word.
 *  2. Brand names & English tech terms in French context (Shaper OS, KovZu, Podman)
 *     are phonetically adapted for natural, fluent voice output.
 *  3. Markdown noise (code fences, image tags, URLs, formatting markers) is
 *     cleaned for smooth auditory delivery.
 */

import { normalizeLocale } from './locale.js';

/**
 * Phonetic/spelling replacement rules per language.
 */
const PRONUNCIATION_RULES = {
  fr: [
    // Brand & Ecosystem names
    [/\bShaper[- ]?OS\b/gi, 'Shaper O.S.'],
    [/\bKovZu\b/gi, 'Kovzou'],
    [/\bZephir\b/gi, 'Zéphir'],
    [/\bPodman\b/gi, 'Pod-man'],
    [/\bQuadlet\b/gi, 'Kouad-lette'],
    [/\bOpenCode\b/gi, 'Open-Code'],

    // AI & Intelligence Artificielle (prevents Deepgram reading "IA" as English "eye-ay" / "A A")
    [/\bplayer IA\b/gi, 'player audio'],
    [/\bL'IA\b/g, "L'intelligence artificielle"],
    [/\bl'IA\b/g, "l'intelligence artificielle"],
    [/\bD'IA\b/g, "D'intelligence artificielle"],
    [/\bd'IA\b/g, "d'intelligence artificielle"],
    [/\bUne IA\b/g, 'Une intelligence artificielle'],
    [/\bune IA\b/g, 'une intelligence artificielle'],
    [/\bUn IA\b/g, 'Un assistant intelligent'],
    [/\bun IA\b/g, 'un assistant intelligent'],
    [/\bIA\b/g, 'intelligence artificielle'],
    [/\bAI\b/g, 'A-I'],
    [/\bLLMs?\b/gi, 'modèle de langage'],

    // Technical Acronyms (spelled out with dots for clean French TTS)
    [/\bMini-GED\b/gi, 'Mini-G.E.D.'],
    [/\bGED\b/gi, 'G.E.D.'],
    [/\bLXC\b/gi, 'L.X.C.'],
    [/\bCRM\b/gi, 'C.R.M.'],
    [/\bERP\b/gi, 'E.R.P.'],
    [/\bPDFs?\b/gi, 'P.D.F.'],
    [/\bCLI\b/gi, 'C.L.I.'],
    [/\bAPIs?\b/gi, 'A.P.I.'],
    [/\bTTS\b/gi, 'T.T.S.'],
    [/\bSTT\b/gi, 'S.T.T.'],
    [/\bCPU\b/gi, 'C.P.U.'],
    [/\bRAM\b/gi, 'R.A.M.'],
    [/\bSSH\b/gi, 'S.S.H.'],
    [/\bUI\b/gi, 'U.I.'],
    [/\bSQL\b/gi, 'S.Q.L.'],
    [/\bCSV\b/gi, 'C.S.V.'],
    [/\bXLSX\b/gi, 'Excel'],
    [/\bDOCX\b/gi, 'Word'],
    [/\bVM\b/gi, 'V.M.'],
    [/\bIP\b/gi, 'I.P.'],
    [/\bDNS\b/gi, 'D.N.S.'],
    [/\bESM\b/gi, 'E.S.M.'],
    [/\bNPM\b/gi, 'N.P.M.'],
  ],
  es: [
    [/\bShaper[- ]?OS\b/gi, 'Shaper O.S.'],
    [/\bKovZu\b/gi, 'Kovzu'],
    [/\bZephir\b/gi, 'Zéfir'],
    [/\bPodman\b/gi, 'Pod-man'],
    [/\bla IA\b/gi, 'la inteligencia artificial'],
    [/\buna IA\b/gi, 'una inteligencia artificial'],
    [/\bde IA\b/gi, 'de inteligencia artificial'],
    [/\bIA\b/g, 'inteligencia artificial'],
    [/\bMini-GED\b/gi, 'Mini-G.E.D.'],
    [/\bGED\b/gi, 'G.E.D.'],
    [/\bLXC\b/gi, 'L.X.C.'],
    [/\bCRM\b/gi, 'C.R.M.'],
    [/\bERP\b/gi, 'E.R.P.'],
    [/\bPDFs?\b/gi, 'P.D.F.'],
    [/\bCLI\b/gi, 'C.L.I.'],
    [/\bAPIs?\b/gi, 'A.P.I.'],
    [/\bTTS\b/gi, 'T.T.S.'],
    [/\bSTT\b/gi, 'S.T.T.'],
    [/\bCPU\b/gi, 'C.P.U.'],
    [/\bRAM\b/gi, 'R.A.M.'],
    [/\bSSH\b/gi, 'S.S.H.'],
  ],
  en: [
    [/\bShaper[- ]?OS\b/gi, 'Shaper O.S.'],
    [/\bKovZu\b/gi, 'Kov-zoo'],
    [/\bMini-GED\b/gi, 'Mini-G.E.D.'],
    [/\bGED\b/gi, 'G.E.D.'],
    [/\bLXC\b/gi, 'L.X.C.'],
    [/\bCRM\b/gi, 'C.R.M.'],
    [/\bERP\b/gi, 'E.R.P.'],
    [/\bPDFs?\b/gi, 'P.D.F.'],
    [/\bCLI\b/gi, 'C.L.I.'],
    [/\bAPIs?\b/gi, 'A.P.I.'],
    [/\bTTS\b/gi, 'T.T.S.'],
    [/\bSTT\b/gi, 'S.T.T.'],
    [/\bCPU\b/gi, 'C.P.U.'],
    [/\bSSH\b/gi, 'S.S.H.'],
  ],
};

/**
 * Strips raw markdown noise before passing to the speech player.
 */
function cleanMarkdownForTts(raw) {
  return String(raw || '')
    // Strip markdown images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    // Replace markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Strip code blocks ```...```
    .replace(/```[\s\S]*?```/g, '')
    // Strip inline code backticks `code` -> code
    .replace(/`([^`]+)`/g, '$1')
    // Strip bold / italic markers
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // Strip header hashes #
    .replace(/^#+\s+/gm, '')
    // Strip blockquote markers
    .replace(/^>\s+/gm, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes text so speech synthesis speaks names and acronyms properly.
 * @param {string} text
 * @param {string} [locale='fr']
 * @returns {string}
 */
export function normalizeTtsPronunciation(text, locale = 'fr') {
  if (!text) return '';
  const lang = normalizeLocale(locale);
  let cleaned = cleanMarkdownForTts(text);

  const rules = PRONUNCIATION_RULES[lang] || PRONUNCIATION_RULES.fr;
  for (const [pattern, replacement] of rules) {
    cleaned = cleaned.replace(pattern, replacement);
  }

  // Collapse consecutive periods (e.g. "O.S.." -> "O.S.")
  cleaned = cleaned.replace(/\.{2,}/g, '.');

  return cleaned;
}
