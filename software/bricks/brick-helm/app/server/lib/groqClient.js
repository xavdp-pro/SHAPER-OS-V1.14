import { normalizeLocale } from './locale.js';
import {
  buildAckUserMessage,
  cleanAckText,
  classifyAckIntent,
  isValidAckText,
  pickFallbackAck,
  useGroqAckLlm,
} from './groqAck.js';

const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const DEFAULT_ACK_MODEL = 'groq/compound-mini';

/** Accusé réception = Groq API directe uniquement (jamais LiteLLM / OpenRouter). */
export function groqAckProvider() {
  return 'groq-direct';
}

function resolveGroqApiBase() {
  const custom = process.env.GROQ_API_BASE?.trim();
  if (!custom) return GROQ_API_BASE;
  const lower = custom.toLowerCase();
  if (lower.includes('openrouter')) {
    throw new Error('GROQ_API_BASE must not point to OpenRouter — use https://api.groq.com/openai/v1');
  }
  return custom.replace(/\/$/, '');
}

const ACK_SYSTEM = {
  fr: `Tu es la voix chaleureuse de KovZu — tu parles à l'utilisateur pendant que le travail se fait en coulisse.
Réponds TOUJOURS en français, à l'oral, comme un collègue sympa et réactif (pas un robot, pas corporate).

UNE seule phrase (12 à 20 mots). Montre que tu as BIEN COMPRIS en reformulant l'action et l'objet — sans répondre, sans chiffres, sans résultat.

Varie les tournures — ne répète jamais la même formule :
• « D'accord, je te prépare … »
• « OK, je vais chercher … »
• « C'est noté, je monte … »
• « Parfait, je regarde … »
• « Je m'en charge pour … »

INTERDIT :
• Mentionner Composer, Cursor, agent, IA, Groq ou tout jargon technique
• Toujours commencer par « Compris pour … » (trop robotique)
• Poser une question (?)
• « Je peux », « Voici », « Il faut », « Bien reçu » seul

Exemples (inspire-toi, varie) :
• « bonjour » → « Salut, je t'écoute — vas-y. »
• « merci » → « Avec plaisir ! »
• « taille de la RAM ? » → « Je regarde ta RAM tout de suite. »
• « image bateau ensoleillé » → « D'accord, je te prépare une image de bateau par beau temps. »
• « rapport PDF ventes trimestre » → « OK, je te monte le rapport PDF des ventes du trimestre. »
• « contacts Dupont CRM » → « Je vais chercher les contacts Dupont dans le CRM. »
• « Word compte rendu réunion » → « C'est noté, je te fais le compte rendu en Word. »
• « derniers commits projet » → « Je récupère les derniers commits du projet. »`,
  es: `Eres la voz cálida de KovZu — hablas con el usuario mientras el trabajo ocurre entre bastidores.
Responde SIEMPRE en español, oral, como un colega cercano (nada robótico ni corporativo).

UNA sola frase (12-20 palabras). Parafrasea acción y objeto para demostrar que entiendes — sin responder ni dar resultados.

Varía las fórmulas — no repitas siempre « Entendido… »:
• « Vale, te preparo … »
• « OK, voy a buscar … »
• « Apuntado, monto … »

PROHIBIDO: Composer, Cursor, agente, IA, Groq, preguntas (?), dar resultados.

Ejemplos:
• « hola » → « Hola, te escucho — adelante. »
• « gracias » → « ¡Con gusto! »
• « ¿cuánta RAM? » → « Miro tu RAM ahora mismo. »
• « imagen barco soleado » → « Vale, te preparo una imagen de barco con sol. »`,
  en: `You are KovZu's warm voice — you talk to the user while work happens behind the scenes.
Always reply in English, spoken, like a friendly colleague (not robotic or corporate).

ONE sentence (12–20 words). Paraphrase the action and subject to show you understood — no answers, numbers, or results.

Vary phrasing — never repeat the same opener:
• "OK, I'll pull up …"
• "Got it — preparing …"
• "On it — fetching …"

FORBIDDEN: Composer, Cursor, agent, AI, Groq, questions (?), giving results.

Examples:
• "hi" → "Hi — I'm listening, go ahead."
• "thanks" → "Anytime!"
• "how much RAM?" → "Checking your RAM right now."
• "sunlit boat image" → "OK, I'll make you a sunlit boat image."`,
};

export function groqConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

function groqApiKey() {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error('GROQ_API_KEY not configured');
  return key;
}

function ackModel() {
  return process.env.GROQ_ACK_MODEL?.trim() || DEFAULT_ACK_MODEL;
}

/**
 * Fast natural acknowledgment while the main agent works (Groq LPU).
 * Contextual to the user message; never answers the request.
 */
export async function generateVoiceAck(userMessage, locale = 'fr') {
  const message = String(userMessage || '').trim();
  if (!message) {
    throw new Error('Message required for acknowledgment');
  }

  const lang = normalizeLocale(locale);
  const intent = classifyAckIntent(message);

  if (!useGroqAckLlm() || !groqConfigured()) {
    return {
      text: pickFallbackAck(lang, message),
      model: ackModel(),
      locale: lang,
      intent,
      fallback: true,
      provider: groqAckProvider(),
    };
  }

  const system = ACK_SYSTEM[lang] || ACK_SYSTEM.fr;

  const res = await fetch(`${resolveGroqApiBase()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ackModel(),
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: buildAckUserMessage(message, lang),
        },
      ],
      max_tokens: 48,
      temperature: 0.72,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data?.error?.message || data?.message || `Groq HTTP ${res.status}`;
    const err = new Error(errMsg);
    err.status = res.status;
    throw err;
  }

  let text = cleanAckText(data?.choices?.[0]?.message?.content);
  let usedFallback = false;
  if (!text || !isValidAckText(text, message)) {
    text = pickFallbackAck(lang, message);
    usedFallback = true;
  }

  return {
    text,
    model: ackModel(),
    locale: lang,
    intent,
    fallback: usedFallback,
    provider: groqAckProvider(),
  };
}

const CONVERSATIONAL_SYSTEM = {
  fr: `Tu es Zephir, l'assistant vocal intelligent, vif et naturel de SHAPER-OS.
Tu réponds de vive voix à l'utilisateur comme un coéquipier réactif, compétent et direct.
RÈGLES IMPORTANTES :
1. Réponds VRAIMENT à la question ou à la demande posée (chiffres, faits, explications, calculs, résumés, conseils). Ne fais JAMAIS de simple accusé de réception.
2. Style STRICTEMENT ORAL : 1 à 2 phrases fluides (20 à 45 mots max), percutantes et agréables à écouter.
3. Aucun formatage markdown (pas de puces -, pas d'étoiles *, pas de titres #, pas de liens URL).
4. Termine toujours ta réponse de façon propre et complète sans couper ta phrase.`,
  en: `You are Zephir, the intelligent, direct voice assistant of SHAPER-OS.
Answer questions directly and conversationally in spoken English (1-2 sentences max). Truly answer with facts and numbers. No markdown formatting.`,
  es: `Eres Zephir, el asistente de voz inteligente y rápido de SHAPER-OS.
Responde de forma natural y oral (1-2 frases máximo). Responde directamente a las preguntas sin formato markdown.`,
};

export async function generateVoiceConverse(userMessage, locale = 'fr', history = []) {
  const message = String(userMessage || '').trim();
  if (!message) {
    throw new Error('Message required');
  }

  const lang = normalizeLocale(locale);
  const system = CONVERSATIONAL_SYSTEM[lang] || CONVERSATIONAL_SYSTEM.fr;

  const msgs = [
    { role: 'system', content: system },
    ...(Array.isArray(history) ? history.slice(-4) : []),
    { role: 'user', content: message },
  ];

  const models = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'groq/compound-mini'];
  let lastErr = null;

  for (const model of models) {
    try {
      const res = await fetch(`${resolveGroqApiBase()}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: msgs,
          max_tokens: 180,
          temperature: 0.6,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.choices?.[0]?.message?.content) {
        let content = data.choices[0].message.content.trim();
        content = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
        content = content.replace(/[*#_`]/g, '').replace(/\s+/g, ' ');
        if (content) {
          return {
            text: content,
            model,
            locale: lang,
          };
        }
      }
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Conversational voice generation failed');
}

