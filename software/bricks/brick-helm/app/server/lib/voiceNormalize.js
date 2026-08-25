/**
 * Post-STT normalizer — repairs infra names the STT phoneticized.
 *   "cas zéro"            → gbs-k0   (via alias table)
 *   "gbs h 1" / "GBS-H 1" → gbs-h1   (fuzzy vs lexicon)
 *   "épelle golf bravo sierra tiret hôtel un" → gbs-h1 (spelling)
 * Deterministic only — no LLM, no network. Pure functions (unit-tested).
 */

/** Spelling markers (multilingual) — start a letter-by-letter sequence. */
const SPELL_MARKERS = new Set(['épelle', 'epelle', 'épèle', 'spell', 'deletrea', 'deletreo']);

/** NATO alphabet + common FR/ES variants heard by STT. */
const NATO = {
  alpha: 'a',
  alfa: 'a',
  bravo: 'b',
  charlie: 'c',
  charly: 'c',
  delta: 'd',
  echo: 'e',
  écho: 'e',
  foxtrot: 'f',
  golf: 'g',
  hotel: 'h',
  hôtel: 'h',
  india: 'i',
  juliett: 'j',
  juliette: 'j',
  kilo: 'k',
  lima: 'l',
  mike: 'm',
  maik: 'm',
  november: 'n',
  novembre: 'n',
  oscar: 'o',
  papa: 'p',
  quebec: 'q',
  québec: 'q',
  romeo: 'r',
  roméo: 'r',
  sierra: 's',
  tango: 't',
  uniform: 'u',
  uniforme: 'u',
  victor: 'v',
  whiskey: 'w',
  whisky: 'w',
  xray: 'x',
  yankee: 'y',
  zulu: 'z',
  zoulou: 'z',
};

/** Spoken letter names (after a spell marker only — too ambiguous otherwise). */
const LETTER_NAMES = {
  a: 'a',
  bé: 'b',
  be: 'b',
  cé: 'c',
  ce: 'c',
  dé: 'd',
  de: 'd',
  e: 'e',
  eu: 'e',
  èf: 'f',
  ef: 'f',
  effe: 'f',
  gé: 'g',
  ge: 'g',
  ache: 'h',
  hache: 'h',
  i: 'i',
  ji: 'j',
  ka: 'k',
  èl: 'l',
  el: 'l',
  elle: 'l',
  èm: 'm',
  em: 'm',
  ème: 'm',
  èn: 'n',
  en: 'n',
  ène: 'n',
  o: 'o',
  eau: 'o',
  pé: 'p',
  pe: 'p',
  ku: 'q',
  cu: 'q',
  èr: 'r',
  er: 'r',
  ère: 'r',
  esse: 's',
  ès: 's',
  té: 't',
  te: 't',
  u: 'u',
  vé: 'v',
  ve: 'v',
  ixe: 'x',
  zède: 'z',
  zed: 'z',
};

const DIGIT_WORDS = {
  // fr
  zéro: '0',
  zero: '0',
  un: '1',
  une: '1',
  deux: '2',
  trois: '3',
  quatre: '4',
  cinq: '5',
  six: '6',
  sept: '7',
  huit: '8',
  neuf: '9',
  // en
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  seven: '7',
  eight: '8',
  nine: '9',
  // es
  cero: '0',
  uno: '1',
  dos: '2',
  tres: '3',
  cuatro: '4',
  cinco: '5',
  seis: '6',
  siete: '7',
  ocho: '8',
  nueve: '9',
};

const DASH_WORDS = new Set(['tiret', 'dash', 'moins', 'guion', 'guión', 'hyphen', 'trait']);

/** Lowercase, strip accents/punctuation — comparison form. */
export function foldToken(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Phonetic-lite folding (FR-oriented): sound-alike consonant collapse. */
export function phoneticKey(raw) {
  let s = foldToken(raw);
  s = s.replace(/qu/g, 'k').replace(/q/g, 'k');
  s = s.replace(/c(?=[aou0-9]|$)/g, 'k'); // ca/co/cu + final c → k
  s = s.replace(/ck/g, 'k');
  s = s.replace(/ph/g, 'f');
  s = s.replace(/h/g, '');
  s = s.replace(/y/g, 'i');
  s = s.replace(/(.)\1+/g, '$1'); // collapse doubles
  return s;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

function similar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const dist = levenshtein(a, b);
  const len = Math.max(a.length, b.length);
  return len >= 4 ? dist <= Math.floor(len / 4) : dist === 0;
}

/** Split keeping word positions; punctuation kept attached for rebuild. */
function tokenize(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

/** Strip trailing punctuation of a token ("k0," → ["k0", ","]). */
function splitPunct(token) {
  const m = token.match(/^(.*?)([.,;:!?…]*)$/);
  return [m ? m[1] : token, m ? m[2] : ''];
}

/**
 * Collapse spelled sequences:
 *  - after a spell marker: NATO words + letter names + digits + dashes
 *  - without marker: runs of ≥2 NATO words (+ digits/dashes glued around)
 */
export function collapseSpelling(text) {
  const tokens = tokenize(text);
  const out = [];
  let i = 0;

  const eat = (allowLetterNames) => {
    const letters = [];
    let trailingPunct = '';
    while (i < tokens.length) {
      const [core, punct] = splitPunct(tokens[i]);
      const key = foldToken(core);
      const folded = core
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      let mapped = null;
      if (NATO[core.toLowerCase()] || NATO[folded]) {
        mapped = NATO[core.toLowerCase()] || NATO[folded];
      } else if (allowLetterNames && (LETTER_NAMES[core.toLowerCase()] !== undefined)) {
        mapped = LETTER_NAMES[core.toLowerCase()];
      } else if (DIGIT_WORDS[core.toLowerCase()] !== undefined || DIGIT_WORDS[folded] !== undefined) {
        mapped = DIGIT_WORDS[core.toLowerCase()] ?? DIGIT_WORDS[folded];
      } else if (DASH_WORDS.has(core.toLowerCase()) || DASH_WORDS.has(folded)) {
        mapped = '-';
      } else if (/^[a-z]$/i.test(core)) {
        mapped = core.toLowerCase();
      } else if (/^\d+$/.test(key)) {
        mapped = key;
      } else {
        break;
      }
      letters.push(mapped);
      trailingPunct = punct;
      i += 1;
      if (punct) break; // sentence punctuation ends the spelling
    }
    return { letters, trailingPunct };
  };

  while (i < tokens.length) {
    const [core] = splitPunct(tokens[i]);
    const lower = core.toLowerCase();
    const folded = foldToken(core);

    if (SPELL_MARKERS.has(lower) || SPELL_MARKERS.has(folded)) {
      i += 1;
      const { letters, trailingPunct } = eat(true);
      if (letters.length >= 2) {
        out.push(letters.join('').replace(/-+/g, '-') + trailingPunct);
        continue;
      }
      // marker without a real sequence — keep the original word
      out.push(tokens[i - 1]);
      continue;
    }

    const isNato = Boolean(NATO[lower] || NATO[folded]);
    if (isNato) {
      const start = i;
      const { letters, trailingPunct } = eat(false);
      const natoCount = tokens.slice(start, i).filter((tk) => {
        const [c] = splitPunct(tk);
        return NATO[c.toLowerCase()] || NATO[foldToken(c)];
      }).length;
      if (natoCount >= 2) {
        out.push(letters.join('').replace(/-+/g, '-') + trailingPunct);
        continue;
      }
      // single NATO word ("delta") — normal conversation, keep as-is
      i = start;
      out.push(tokens[i]);
      i += 1;
      continue;
    }

    out.push(tokens[i]);
    i += 1;
  }

  return out.join(' ');
}

/**
 * Replace alias / fuzzy-matched windows with canonical names.
 * @param {string} text
 * @param {{canonicals: string[], aliases: Array<{alias:string, canonical:string}>}} lexicon
 */
export function applyLexicon(text, lexicon) {
  const canonicals = lexicon?.canonicals || [];
  const aliases = lexicon?.aliases || [];
  const replacements = [];

  const aliasMap = new Map();
  for (const { alias, canonical } of aliases) {
    aliasMap.set(foldToken(alias), canonical);
    aliasMap.set(phoneticKey(alias), canonical);
  }
  const canonByFold = new Map();
  for (const c of canonicals) {
    canonByFold.set(foldToken(c), c);
  }

  const tokens = tokenize(text);
  const out = [];
  let i = 0;

  while (i < tokens.length) {
    /** Best candidate: exact beats fuzzy, then smaller distance, then shorter window. */
    let best = null;

    for (let w = Math.min(4, tokens.length - i); w >= 1; w--) {
      const windowTokens = tokens.slice(i, i + w);
      const [lastCore, punct] = splitPunct(windowTokens[w - 1]);
      const cores = [...windowTokens.slice(0, w - 1), lastCore];
      const joined = cores.join(' ');
      const fold = foldToken(joined);
      const phon = phoneticKey(joined);
      if (!fold) continue;

      const consider = (canonical, rank, dist) => {
        if (!canonical) return;
        if (
          !best
          || rank < best.rank
          || (rank === best.rank && dist < best.dist)
          || (rank === best.rank && dist === best.dist && w < best.consumed)
        ) {
          best = { canonical, punct, from: joined, consumed: w, rank, dist };
        }
      };

      // Exact alias (folded / phonetic)
      const viaAlias = aliasMap.get(fold) || aliasMap.get(phon);
      if (viaAlias) consider(viaAlias, 0, 0);

      // Exact canonical fold ("GBS H 1" → gbs-h1) — also marks "already canonical"
      const viaFold = canonByFold.get(fold);
      if (viaFold) consider(viaFold, 0, 0);

      // Fuzzy alias (phonetic)
      for (const { alias, canonical } of aliases) {
        const af = foldToken(alias);
        const ap = phoneticKey(alias);
        if (similar(fold, af)) consider(canonical, 1, levenshtein(fold, af));
        else if (similar(phon, ap)) consider(canonical, 1, levenshtein(phon, ap));
      }

      // Fuzzy canonicals — only for name-like windows (digit or dash present)
      const nameLike = /[0-9]/.test(fold) || joined.includes('-');
      if (nameLike && fold.length >= 3) {
        for (const c of canonicals) {
          const cf = foldToken(c);
          if (similar(fold, cf)) consider(c, 1, levenshtein(fold, cf));
          else if (phon.length >= 3 && similar(phon, phoneticKey(c))) {
            consider(c, 1, levenshtein(phon, phoneticKey(c)));
          }
        }
      }
    }

    if (best && best.canonical !== best.from) {
      out.push(best.canonical + best.punct);
      replacements.push({ from: best.from, to: best.canonical });
      i += best.consumed;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }

  return { text: out.join(' '), replacements };
}

/**
 * Full pipeline: spelling collapse → lexicon (alias + fuzzy).
 * @returns {{ text: string, replacements: Array<{from:string, to:string}> }}
 */
export function normalizeTranscript(text, lexicon = { canonicals: [], aliases: [] }) {
  const collapsed = collapseSpelling(text);
  const { text: fixed, replacements } = applyLexicon(collapsed, lexicon);
  if (collapsed !== String(text || '').trim() && collapsed !== text) {
    // Track spelling collapse as a replacement for the vocal echo
    if (!replacements.length || fixed === collapsed) {
      const spelled = tokenize(fixed).filter((tk) => !tokenize(text).includes(tk));
      for (const s of spelled) {
        const [core] = splitPunct(s);
        if (/^[a-z0-9-]+$/i.test(core) && !replacements.some((r) => r.to === core)) {
          replacements.push({ from: '(épelé)', to: core });
        }
      }
    }
  }
  return { text: fixed, replacements };
}
