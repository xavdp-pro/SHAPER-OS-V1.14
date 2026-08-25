import { normalizeLocale } from './locale.js';
import { DEFAULT_APP_NAME } from './settingsStore.js';

/**
 * Add CONTEXT.md read step into the single prime inject (no separate warm-up run).
 */
export function contextBootstrapDirective(contextPath, locale = 'fr') {
  const file = String(contextPath || '').trim();
  if (!file) return '';
  const lang = normalizeLocale(locale);
  if (lang === 'en') {
    return [
      'Bootstrap — before your greeting:',
      `Read this reference file completely with your Read tool and retain it for the whole session: ${file}`,
      'It holds language rules, output format, briefing, local notes, skills, and control scope.',
      'Do not repeat that file verbatim to the operator.',
    ].join(' ');
  }
  if (lang === 'es') {
    return [
      'Arranque — antes del saludo:',
      `Lee este archivo de referencia por completo con Read y consérvalo toda la sesión: ${file}`,
      'Contiene idioma, formato, briefing, notas locales, skills y ámbito de control.',
      'No repitas ese archivo al operador.',
    ].join(' ');
  }
  return [
    'Bootstrap — avant ta salutation :',
    `Lis ce fichier de référence en entier avec Read et retiens-le pour toute la session : ${file}`,
    'Il contient langue, format, briefing, notes locales, skills et périmètre de contrôle.',
    'Ne répète pas ce fichier à l’opérateur.',
  ].join(' ');
}

function greetingTail(lang, name) {
  if (lang === 'en') {
    return name
      ? `Greet ${name} warmly by first name (hello ${name}). In 2 simple, direct sentences, introduce yourself: you are Zephir on KovZu, an operational copilot ready to manage files, build tailored business tools, and execute tasks autonomously. Conclude by inviting them to click the help button (?) at the top right for a guided tour. Keep it crisp, natural, and concise. Do not repeat the briefing verbatim. Write plain natural text — absolutely no tables, no bullet points, no markdown formatting, no headings. Then wait.`
      : 'Greet briefly now. In 2 simple, direct sentences, introduce yourself: you are Zephir on KovZu, an operational copilot ready to manage files, build tailored business tools, and execute tasks autonomously. Conclude by inviting them to click the help button (?) at the top right for a tour. Keep it crisp, natural, and concise. Do not repeat the briefing verbatim. Write plain natural text — absolutely no tables, no bullet points, no markdown formatting, no headings. Then wait.';
  }
  if (lang === 'es') {
    return name
      ? `Saluda cordialmente a ${name} por su nombre de pila (hola ${name}). En 2 frases simples y directas, preséntate: eres Zephir en KovZu, su copiloto operativo para gestionar expedientes, construir herramientas a medida y ejecutar tareas con total autonomía. Concluye invitándole a pulsar el botón de ayuda (?) arriba a la derecha para un tour guiado. Mantén un tono natural, claro y conciso. No repitas el briefing palabra por palabra. Escribe texto natural sin formato — nada de tablas, viñetas, markdown ni encabezados. Luego espera.`
      : 'Saluda brevemente. En 2 frases simples y directas, preséntate: eres Zephir en KovZu, un copiloto operativo para gestionar expedientes, crear herramientas y ejecutar tareas con autonomía. Concluye invitando a pulsar el botón de ayuda (?) arriba a la derecha. Mantén un tono claro y conciso. No repitas el briefing. Escribe texto natural sin formato — nada de tablas, viñetas, markdown ni encabezados. Luego espera.';
  }
  return name
    ? `Salue chaleureusement ${name} par son prénom (bonjour ${name}). En 2 phrases simples et directes, présente-toi : tu es Zephir sur KovZu, son copilote opérationnel pour piloter ses dossiers, concevoir ses outils métier et exécuter ses tâches en toute autonomie. Conclus en l'invitant à cliquer sur le bouton d'aide (?) en haut à droite pour découvrir l'interface. Reste sobre, naturel et concis. Ne répète pas le briefing mot pour mot. Écris en texte libre naturel — strictement aucun tableau, aucune liste à puces, aucun formatage markdown, aucun titre. Puis attends.`
    : `Salue brièvement. En 2 phrases simples et directes, présente-toi : tu es Zephir sur KovZu, un copilote opérationnel pour piloter les dossiers, concevoir des outils métier et exécuter des tâches en toute autonomie. Conclus en invitant à cliquer sur le bouton d'aide (?) en haut à droite. Reste sobre, naturel et concis. Ne répète pas le briefing. Écris en texte libre naturel — strictement aucun tableau, aucune liste à puces, aucun formatage markdown, aucun titre. Puis attends.`;
}

function languageThinkingLine(lang) {
  if (lang === 'en') {
    return 'Always reply in the language selected in the KovZu UI for this session (English here). CRITICAL: internal thinking must ALSO be only in English.';
  }
  if (lang === 'es') {
    return 'Responde siempre en el idioma seleccionado en la UI de KovZu (español aquí). CRÍTICO: el thinking interno también debe ser SOLO en español.';
  }
  return 'Réponds toujours dans la langue sélectionnée dans l’UI KovZu (français ici). CRITIQUE : le thinking interne doit AUSSI être uniquement en français.';
}

function appendReferenceBlocks(parts, lang, brief, _contextPath, _engineLabel) {
  // ISOLATION DU PRIME — Le prompt de prime ne contient JAMAIS de directive
  // de format livrable (tableaux GFM, mermaid, etc.) ni de catalogue de skills.
  // Ces directives s'activent au premier vrai message utilisateur via
  // applyCursorLanguage(). Ici on ne garde que le briefing opérateur.
  if (brief) {
    const label = lang === 'en'
      ? 'Operator briefing (standing instructions — follow them):'
      : lang === 'es'
        ? 'Briefing del operador (instrucciones permanentes — síguelas):'
        : 'Briefing opérateur (consignes permanentes — suis-les) :';
    parts.push(label, brief);
  }
}

/**
 * Build the session-start prompt for Cursor CLI.
 * When contextPath is set, reference material lives in CONTEXT.md — prime stays slim.
 */
export function buildSessionPrimeMessage({
  briefing = '',
  userName = '',
  firstName = '',
  locale = 'fr',
  appName = DEFAULT_APP_NAME,
  contextPath = '',
  engineLabel = '',
} = {}) {
  const lang = normalizeLocale(locale);
  const app = String(appName || DEFAULT_APP_NAME).trim() || DEFAULT_APP_NAME;
  const rawFirst = String(firstName || '').trim();
  const rawFallback = String(userName || '').trim();
  let name = rawFirst;
  if (!name && rawFallback) {
    if (rawFallback.includes('@')) name = rawFallback.split('@')[0];
    else if (/^thesuperuser$/i.test(rawFallback)) name = '';
    else name = rawFallback.split(/\s+/)[0];
  }
  if (!name) {
    name = lang === 'en' ? 'there' : lang === 'es' ? '' : '';
  }
  const brief = String(briefing || '').trim();
  const whoLine = name
    ? (lang === 'en'
      ? `The operator’s first name is ${name}. Always address them as ${name} (first name only — not a username/login).`
      : lang === 'es'
        ? `El nombre de pila del operador es ${name}. Dirígete siempre a ${name} (solo el nombre de pila — no un login).`
        : `Le prénom de l’opérateur est ${name}. Adresse-toi toujours à ${name} (prénom uniquement — pas un identifiant de login).`)
    : (lang === 'en'
      ? 'Address the operator politely by name when you know it.'
      : lang === 'es'
        ? 'Dirígete al operador con cortesía.'
        : 'Adresse-toi à l’opérateur avec politesse.');

  const opener = lang === 'en'
    ? 'Session start — read and keep this for the whole session.'
    : lang === 'es'
      ? 'Inicio de sesión — lee y conserva esto durante toda la sesión.'
      : 'Démarrage de session — lis et retiens ceci pour toute la session.';
  const platform = lang === 'en'
    ? `Platform: ${app} — KovZu is the web console that pilots an artificial intelligence. You are Zephir, the AI agent inside KovZu.`
    : lang === 'es'
      ? `Plataforma: ${app} — KovZu es la consola web que pilota una inteligencia artificial. Tú eres Zephir, el agente de IA dentro de KovZu.`
      : `Plateforme : ${app} — KovZu est la console web qui pilote une intelligence artificielle. Tu es Zephir, l’agent IA à l’intérieur de KovZu.`;

  const parts = [opener, platform, whoLine];
  appendReferenceBlocks(parts, lang, brief, contextPath, engineLabel);
  parts.push(languageThinkingLine(lang));
  if (!contextPath) {
    parts.push(
      lang === 'en'
        ? 'For file paths, write Unix form with forward slashes (e.g. /apps/project/src); never say the word “slash”.'
        : lang === 'es'
          ? 'Para rutas de archivos, escribe formato Unix con barras (ej. /apps/proyecto/src); no digas la palabra « slash ».'
          : 'Pour les chemins de fichiers, écris-les au format Unix avec des barres obliques (ex. /apps/projet/src), sans dire le mot « slash ».',
    );
  }
  parts.push(greetingTail(lang, name));
  return parts.join('\n\n');
}
