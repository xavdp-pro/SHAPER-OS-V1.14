/**
 * TTS Text Formatter & Acronym Expander.
 * Prepares text for realistic, crystal-clear speech synthesis by TTS engines (Deepgram Aura, Cartesia, etc.)
 * by expanding technical acronyms, stripping markdown artifacts, and normalizing symbols.
 */

const COMMON_ACRONYMS = {
  API: 'A-P-I',
  SQL: 'S-Q-L',
  GED: 'G-E-D',
  URL: 'U-R-L',
  SSH: 'S-S-H',
  HTTP: 'H-T-T-P',
  HTTPS: 'H-T-T-P-S',
  CSV: 'C-S-V',
  PDF: 'P-D-F',
  TTS: 'T-T-S',
  STT: 'S-T-T',
  LLM: 'L-L-M',
  IA: 'I-A',
  UI: 'U-I',
  UX: 'U-X',
  OS: 'O-S',
  RAM: 'R-A-M',
  CPU: 'C-P-U',
  DB: 'D-B',
  IP: 'I-P',
  CLI: 'C-L-I',
  HTML: 'H-T-M-L',
  CSS: 'C-S-S',
  JS: 'J-S',
  VM: 'V-M',
  UUID: 'U-U-I-D',
  JSON: 'J-S-O-N',
  SDK: 'S-D-K',
  DNS: 'D-N-S',
  NFS: 'N-F-S',
  LXC: 'L-X-C',
  TLS: 'T-L-S',
  FTP: 'F-T-P',
  CRM: 'C-R-M',
  ERP: 'E-R-P',
  GBS: 'G-B-S',
  ID: 'I-D',
  K8S: 'K-8-S',
};

/**
 * Format raw markdown / text for natural, realistic TTS speech.
 * @param {string} text
 * @param {string} [locale='fr']
 * @returns {string}
 */
export function formatTextForTts(text, locale = 'fr') {
  if (!text || typeof text !== 'string') return '';
  const lang = String(locale || 'fr').toLowerCase().slice(0, 2);

  let out = text;

  // 1. Remove code blocks ```...``` entirely from speech so the engine does not recite code syntax
  out = out.replace(/```[\s\S]*?```/g, ' ');

  // 2. Clean inline code `foo` -> foo
  out = out.replace(/`([^`]+)`/g, '$1');

  // 3. Remove images ![alt](url) -> space
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');

  // 4. Clean markdown links [label](url) -> label
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // 5. Remove bracketed emotion tags like [calm], [excited], etc.
  out = out.replace(/\[[a-zA-Z0-9_\s-]+\]/g, ' ');

  // 6. Clean headers, bold, italics, bullets (#, *, _, >)
  out = out.replace(/^#{1,6}\s+/gm, '');
  out = out.replace(/(\*\*|__)(.*?)\1/g, '$2');
  out = out.replace(/(\*|_)(.*?)\1/g, '$2');
  out = out.replace(/^>\s+/gm, '');
  out = out.replace(/^[-*+]\s+/gm, '');

  // 7. Expand symbols
  if (lang === 'en') {
    out = out.replace(/&/g, ' and ');
    out = out.replace(/%/g, ' percent ');
    out = out.replace(/@/g, ' at ');
  } else if (lang === 'es') {
    out = out.replace(/&/g, ' y ');
    out = out.replace(/%/g, ' por ciento ');
    out = out.replace(/@/g, ' arroba ');
  } else {
    // fr (default)
    out = out.replace(/&/g, ' et ');
    out = out.replace(/%/g, ' pour cent ');
    out = out.replace(/@/g, ' arobase ');
  }

  // 8. Expand known technical acronyms
  for (const [acronym, expanded] of Object.entries(COMMON_ACRONYMS)) {
    const re = new RegExp(`\\b${acronym}\\b`, 'g');
    out = out.replace(re, expanded);
  }

  // 9. Generic all-caps 2-4 letter acronyms (e.g. JWT, RPC, SSL) -> hyphenate letters (J-W-T)
  out = out.replace(/\b([A-Z]{2,4})\b/g, (match) => {
    // Do not hyphenate common short non-acronym words
    if (/^(OK|LE|LA|DE|DU|UN|ET|EN|AU|OU|SI|NO|IF|OR|IN|IT|IS|TO|AT|MY|ON|SO|DO|GO|ME|WE|HE|BY|UP|AN|AS)$/i.test(match)) {
      return match;
    }
    return match.split('').join('-');
  });

  // 10. Clean up multiple spaces and trailing whitespace
  out = out.replace(/\s+/g, ' ').trim();

  return out;
}
