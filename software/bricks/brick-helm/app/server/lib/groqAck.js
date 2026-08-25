import { normalizeLocale } from './locale.js';

/** Intent for a short spoken receipt (not the real answer). */
export function classifyAckIntent(userMessage) {
  const t = String(userMessage || '').trim().toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!t) return 'generic';

  if (/^(bonjour|salut|hello|hey|coucou|bonsoir|hi|hola|buenas)\b/.test(t)
    || /^(bonjour|salut|hello|hey|coucou|bonsoir|hola)[.!]?\s*$/.test(t)) {
    return 'greeting';
  }
  if (/^(merci|thanks|thank you|nickel|parfait|super|top|gracias)\b/.test(t)
    || /^(merci|thanks|gracias)[.!]?\s*$/.test(t)) {
    return 'thanks';
  }
  if (/\b(aide|help|comment|pourquoi|explique|c['']est quoi|ayuda|como|por que|explica)\b/.test(t)
    || /\?/.test(t)) {
    return 'question';
  }
  if (/\b(fais|cree|créé|ecris|écris|modifie|change|ajoute|supprime|installe|lance|ouvre|cherche|trouve|verifie|vérifie|regarde|liste|montre|donne|calcule|genere|génère|haz|crea|escribe|modifica|cambia|anade|borra|instala|abre|busca|mira|lista|muestra|dame)\b/.test(t)
    || /\b(please|stp|s['']il te plait|sil te plait|por favor)\b/.test(t)) {
    return 'task';
  }
  return 'generic';
}

const ACK_BY_INTENT = {
  fr: {
    greeting: [
      'Salut, je t’écoute — vas-y.',
      'Coucou, dis-moi.',
      'Bonjour, je suis là.',
    ],
    thanks: [
      'Avec plaisir !',
      'De rien, content que ça t’aide.',
      'Tout le plaisir est pour moi.',
    ],
    question: [
      'Bonne question — je creuse ça tout de suite.',
      'Je regarde ça, un instant.',
      'Intéressant — je vérifie.',
    ],
    task: [
      'OK, je m’en occupe — deux secondes.',
      'C’est noté, je m’y mets.',
      'Parfait, je m’en charge.',
    ],
    generic: [
      'OK, je regarde ça tout de suite.',
      'Entendu, je m’en charge.',
      'D’accord, un instant.',
    ],
  },
  es: {
    greeting: ['Hola, te escucho — adelante.', 'Hey, dime.', 'Buenas, aquí estoy.'],
    thanks: ['¡Con gusto!', 'De nada, me alegra ayudar.', 'Encantado.'],
    question: ['Buena pregunta — lo reviso ahora.', 'Voy a mirarlo, un momento.', 'Interesante — lo compruebo.'],
    task: ['Vale, me pongo a ello.', 'Apuntado, en marcha.', 'Perfecto, me encargo.'],
    generic: ['OK, lo miro ahora.', 'Entendido, me encargo.', 'De acuerdo, un momento.'],
  },
  en: {
    greeting: ['Hi — I’m listening, go ahead.', 'Hey, go ahead.', 'Hello, I’m here.'],
    thanks: ['Anytime!', 'You’re welcome, glad it helped.', 'My pleasure.'],
    question: ['Good question — checking now.', 'Let me look into that.', 'Interesting — I’ll verify.'],
    task: ['OK, on it — two seconds.', 'Got it, starting now.', 'Perfect, I’m on it.'],
    generic: ['OK, looking into that now.', 'Got it, handling it.', 'Sure, one moment.'],
  },
};

/** Topic hint for fallbacks (3–4 words), never the answer. */
export function topicHint(userMessage) {
  const stop = new Set([
    'bonjour', 'salut', 'hello', 'hey', 'merci', 'please', 'stp', 'avec', 'pour',
    'dans', 'sur', 'une', 'des', 'les', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes',
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'quoi', 'comment',
    'peux', 'veux', 'fais', 'fait', 'donne', 'montre', 'dis', 'moi', 'toi',
    'creer', 'crée', 'cree', 'genere', 'génère', 'fichier', 'file', 'make',
  ]);
  const words = String(userMessage || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9àâäéèêëïîôùûüç\s-]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  return words.slice(0, 4).join(' ');
}

export function useGroqAckLlm() {
  const v = String(process.env.GROQ_ACK_LLM || '').trim().toLowerCase();
  // Default ON when unset — contextual agent-style receipts.
  if (!v) return true;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function isKnownFallback(text) {
  const t = String(text || '').trim();
  return Object.values(ACK_BY_INTENT)
    .flatMap((locale) => Object.values(locale).flat())
    .some((phrase) => phrase === t);
}

/** Reject replies that answer the request; allow warm contextual receipts. */
export function isValidAckText(text, userMessage = '') {
  const t = String(text || '').trim();
  if (isKnownFallback(t)) return true;
  if (!t || wordCount(t) > 22) return false;
  if (/[?]/.test(t)) return false;

  // Never mention backend stack in spoken ack.
  if (/\b(composer|komposer|cursor|groq|agent principal|en arrière[- ]plan|en coulisse)\b/i.test(t)) {
    return false;
  }

  // Hard reject: looks like a real answer / asking for details / dumping facts.
  if (/\b(voici|il faut|tu dois|la réponse|résultat|environ \d|\d+\s*(go|mo|gb|mb|%))\b/i.test(t)) {
    return false;
  }
  if (/^(je peux|pour cela|en fait|alors)\b/i.test(t)) return false;
  if (wordCount(t) > 8 && /\b(parce que|car |afin de)\b/i.test(t)) return false;

  const intent = classifyAckIntent(userMessage);
  if (intent === 'greeting') {
    return /^(salut|bonjour|hello|hey|coucou|bonsoir|hi)\b/i.test(t)
      || /\b(écoute|là|dis[- ]moi|je t['']écoute|vas[- ]y)\b/i.test(t);
  }
  if (intent === 'thanks') {
    return /^(de rien|avec plaisir|content|anytime|welcome|nada|gusto|pleasure|plaisir)\b/i.test(t)
      || /\b(plaisir|aide)\b/i.test(t);
  }

  // Task / question / generic : ne pas imposer une liste blanche d'ouvertures
  // (elle rejetait de bons accusés contextuels — « Je te génère l'image… » —
  // et forçait un repli générique robotique). Les garde-fous négatifs ci-dessus
  // (pas de « ? », pas de résultat/chiffres, pas de backend, ≤ 22 mots)
  // suffisent à écarter une vraie réponse. On exige juste une phrase (≥ 2 mots).
  return wordCount(t) >= 2;
}

function warmTopicAck(lang, intent, hint) {
  if (!hint) return '';
  if (lang === 'fr') {
    const templates = intent === 'question'
      ? [
        `Bonne question sur ${hint} — je creuse tout de suite.`,
        `Je regarde ${hint}, un instant.`,
        `Intéressant, je vérifie ${hint}.`,
      ]
      : [
        `D'accord, je m'occupe de ${hint} — deux secondes.`,
        `OK, ${hint} — c'est en cours.`,
        `Parfait, je te prépare ${hint}.`,
        `Je vais chercher ${hint} tout de suite.`,
        `C'est noté pour ${hint}, je m'y mets.`,
      ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
  if (lang === 'en') {
    const templates = intent === 'question'
      ? [
        `Good question about ${hint} — checking now.`,
        `Looking into ${hint} — one moment.`,
      ]
      : [
        `OK, ${hint} — on it, two seconds.`,
        `Got it — preparing ${hint}.`,
        `I'll fetch ${hint} right now.`,
      ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
  if (lang === 'es') {
    const templates = intent === 'question'
      ? [
        `Buena pregunta sobre ${hint} — lo reviso ahora.`,
        `Miro ${hint}, un momento.`,
      ]
      : [
        `Vale, ${hint} — en marcha, dos segundos.`,
        `Te preparo ${hint}.`,
        `Voy a buscar ${hint} ahora.`,
      ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
  return '';
}

/**
 * Deterministic ack that echoes resolved infra names — the driver hears
 * how the system understood "cas zero" before anything executes.
 */
export function buildEntityAck(entities, locale = 'fr') {
  const list = (entities || [])
    .map((e) => String(e || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!list.length) return '';
  const lang = String(locale || 'fr').toLowerCase().slice(0, 2);
  const names = lang === 'en'
    ? list.join(' and ')
    : lang === 'es'
      ? list.join(' y ')
      : list.join(' et ');
  if (lang === 'en') return `Got it — ${names}. On it.`;
  if (lang === 'es') return `Recibido — ${names}. Voy.`;
  return `Bien reçu — ${names}. Je m’en occupe.`;
}

export function pickFallbackAck(locale, userMessage = '') {
  const lang = normalizeLocale(locale);
  const intent = classifyAckIntent(userMessage);
  const byLang = ACK_BY_INTENT[lang] || ACK_BY_INTENT.fr;
  const list = byLang[intent] || byLang.generic;

  if (intent === 'task' || intent === 'question') {
    const hint = topicHint(userMessage);
    const warm = warmTopicAck(lang, intent, hint);
    if (warm) return warm;
  }

  return list[Math.floor(Math.random() * list.length)];
}

/** User prompt for Groq ack LLM — forces citing the request topic. */
export function buildAckUserMessage(userMessage, locale = 'fr') {
  const lang = normalizeLocale(locale);
  const intent = classifyAckIntent(userMessage);
  const hint = topicHint(userMessage) || (lang === 'en' ? 'the request' : lang === 'es' ? 'la petición' : 'la demande');
  const msg = String(userMessage || '').trim();
  if (lang === 'en') {
    return `Intent: ${intent}\nTopic to weave in naturally (3-4 words): ${hint}\nRules: one warm sentence, vary opener, never mention Composer/Cursor.\nUser message (receipt only, do not execute or answer):\n${msg}`;
  }
  if (lang === 'es') {
    return `Intención: ${intent}\nTema a incluir con naturalidad (3-4 palabras): ${hint}\nReglas: una frase cálida, varía la fórmula, nunca Composer/Cursor.\nMensaje del usuario (solo acuse, no ejecutar ni responder):\n${msg}`;
  }
  return `Intention : ${intent}\nSujet à intégrer naturellement (3-4 mots) : ${hint}\nRègles : une phrase chaleureuse, varie la tournure, jamais Composer/Cursor.\nMessage utilisateur (accusé seulement, ne pas exécuter ni répondre) :\n${msg}`;
}

export function cleanAckText(raw) {
  let text = String(raw || '')
    .replace(/^["'«»]+|["'«»]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip leaked backend references if the model slipped.
  text = text
    .replace(/\s*[,—–-]?\s*(Composer|Komposer|Cursor|Groq|l'agent).*$/i, '')
    .replace(/\s+(pendant que|tandis que|while)\s+(Composer|l'agent|the agent).*$/i, '')
    .trim();
  const max = 140;
  if (text.length > max) {
    const cut = text.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    text = (lastSpace > 50 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return text;
}
