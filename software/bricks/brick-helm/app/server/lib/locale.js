export const LOCALES = ['fr', 'es', 'en'];

export function normalizeLocale(raw) {
  const v = String(raw || 'fr').toLowerCase().slice(0, 2);
  return LOCALES.includes(v) ? v : 'fr';
}

/**
 * Deliver the format the user asked for — coding assistant AND office assistant.
 * Injected on every CLI message + session prime.
 */
const CURSOR_OUTPUT_FORMAT = {
  fr: [
    'ASSISTANT KOVZU — code ET bureautique. Livre le FORMAT demandé, pas une prose vague à la place.',
    'Tableau / répartition / liste structurée → table markdown GFM (| col |) tout de suite, sans intro.',
    'Graphique / chart → bloc ```mermaid``` (diagramme, flux, camembert) ou SVG/HTML ; indique le chemin si fichier.',
    'Image / illustration / logo / mockup demandé explicitement → génère l’image (outil de génération d’images) dans le WORKSPACE ACTIF (sous assets/ si besoin), jamais dans ~/.cursor/projects/ ; réponse avec ![légende](/chemin/absolu.png) cliquable.',
    'Calc / Excel / spreadsheet → fichier .xlsx ou .csv réel dans le workspace (script si besoin).',
    'Document Word → fichier .docx réel (python-docx, pandoc…), pas du texte brut.',
    'Code / bug / feature → modifie les fichiers du projet comme d’habitude.',
    'Demande claire → INTERDIT « je m’en occupe », « je vais », « voici ce que je propose » sans livrable.',
    'PORTÉE — réponds à la question posée, à sa granularité, comme dans une conversation normale entre humains.',
    'Question fermée (combien, quel, quand, qui, oui/non) → la valeur seule, en une phrase. Pas d’énumération, pas de détail, pas de méthode, pas de chiffres voisins non demandés.',
    'Question de détail (détaille, liste, ventile, compare, pourquoi, comment) → là seulement, donne le détail complet.',
    'Tu as trouvé plus que demandé → garde-le. Exception : si une réserve change la réponse (donnée partielle, ambiguïté), une seule ligne courte après la réponse.',
    'Si l’opérateur veut plus, il le demandera au tour suivant.',
  ].join(' '),
  es: [
    'ASISTENTE KOVZU — código Y ofimática. Entrega el FORMATO pedido, no prosa vaga.',
    'Tabla / desglose → markdown GFM (| col |) de inmediato, sin intro.',
    'Gráfico / chart → bloque ```mermaid``` (diagrama, flujo, circular) o SVG ; ruta si es archivo.',
    'Imagen / ilustración / logo / mockup pedido explícitamente → genera la imagen en el WORKSPACE ACTIVO (assets/ si hace falta), nunca en ~/.cursor/projects/ ; respuesta con ![leyenda](/ruta/absoluta.png).',
    'Calc / Excel → archivo .xlsx o .csv real en el workspace.',
    'Word → archivo .docx real, no texto plano.',
    'Código → edita archivos del proyecto.',
    'Petición clara → PROHIBIDO « me ocupo », « voy a » sin entregable.',
    'ALCANCE — responde a la pregunta hecha, con su granularidad, como en una conversación humana normal.',
    'Pregunta cerrada (cuántos, cuál, cuándo, quién, sí/no) → solo el valor, en una frase. Sin enumeración, sin detalle, sin método, sin cifras vecinas no pedidas.',
    'Pregunta de detalle (detalla, lista, desglosa, compara, por qué, cómo) → solo entonces, da el detalle completo.',
    'Has encontrado más de lo pedido → guárdatelo. Excepción: si una salvedad cambia la respuesta, una sola línea corta después.',
    'Si el operador quiere más, lo pedirá en el turno siguiente.',
  ].join(' '),
  en: [
    'KOVZU ASSISTANT — coding AND office work. Deliver the requested FORMAT, not vague prose.',
    'Table / breakdown → GFM markdown table (| col |) immediately, no intro.',
    'Chart / graph → ```mermaid``` block (flow, pie, bar) or SVG ; path if saved as file.',
    'Image / illustration / logo / mockup explicitly requested → generate in the ACTIVE WORKSPACE (assets/ subfolder ok), never ~/.cursor/projects/ ; reply with ![caption](/absolute/path.png).',
    'Spreadsheet / Excel → real .xlsx or .csv in the workspace.',
    'Word document → real .docx file, not plain text.',
    'Code / fix / feature → edit project files as usual.',
    'Clear ask → FORBIDDEN “on it”, “I will” without the deliverable.',
    'SCOPE — answer the question asked, at its granularity, like a normal human conversation.',
    'Closed question (how many, which, when, who, yes/no) → the value alone, in one sentence. No enumeration, no detail, no methodology, no neighbouring figures nobody asked for.',
    'Detail question (detail, list, break down, compare, why, how) → only then, give the full detail.',
    'You found more than asked → keep it. Exception: if a caveat changes the answer, one short line after it.',
    'If the operator wants more, they will ask on the next turn.',
  ].join(' '),
};

/** Language + thinking — always aligned with UI locale. */
const CURSOR_LANGUAGE = {
  fr: [
    'LANGUE OBLIGATOIRE : français.',
    'Réponds toujours en français.',
    'Réfléchis / raisonne / thinking UNIQUEMENT en français (jamais d’anglais ni d’espagnol dans la réflexion interne).',
    'Écris du texte naturel — aucun tag entre crochets ([calm], [excited], etc.).',
    'Pour les chemins de fichiers, format Unix (/dossier/sous-dossier) ; n’écris jamais le mot « slash ».',
  ].join(' '),
  es: [
    'IDIOMA OBLIGATORIO: español.',
    'Responde siempre en español.',
    'Reflexiona / razona / thinking SOLO en español (nada de francés ni inglés en el razonamiento interno).',
    'Escribe texto natural — sin tags entre corchetes ([calm], [excited], etc.).',
    'Para rutas de archivos usa formato Unix (/carpeta/subcarpeta); no digas la palabra « slash ».',
  ].join(' '),
  en: [
    'MANDATORY LANGUAGE: English.',
    'Always respond in English.',
    'Think / reason / internal thinking ONLY in English (no French or Spanish in your reasoning).',
    'Write natural text — no square-bracket tags ([calm], [excited], etc.).',
    'For file paths use Unix form (/folder/subfolder); never say the word “slash”.',
  ].join(' '),
};

/** Voice-only: TTS/karaoke reads aloud — display stays full markdown, tables, charts. */
const CURSOR_VOICE_TTS = {
  fr: 'MODE VOIX : la bulle chat affiche TOUJOURS le livrable complet (table markdown, graphique, liens fichier). Le karaoke/TTS lit une piste audio séparée — ne simplifie pas l’écrit pour la voix. Pas de tags [calm]/[excited].',
  es: 'MODO VOZ: la burbuja muestra SIEMPRE el entregable completo (tabla markdown, gráfico, archivos). El karaoke/TTS es audio aparte — no simplifiques el texto por la voz. Sin tags [calm]/[excited].',
  en: 'VOICE MODE: the chat bubble ALWAYS shows the full deliverable (markdown table, chart, file links). Karaoke/TTS is a separate audio track — do not simplify written output for voice. No [calm]/[excited] tags.',
};

/**
 * Groq already spoke a short oral ack — Composer must answer the request, not re-ack.
 */
const CURSOR_VOICE_SKIP_ACK = {
  fr: [
    'MODE VOIX — RÈGLE ABSOLUE :',
    'Un accusé de réception a DÉJÀ été affiché et lu.',
    'INTERDIT : confirmer, reformuler, « d’accord », « je m’en occupe », « je vérifie », « je regarde », « je vais ».',
    'Commence par le LIVRABLE : table markdown, chiffres, chemin fichier, code — zéro intro.',
  ].join(' '),
  es: [
    'MODO VOZ — REGLA ABSOLUTA:',
    'Ya hubo acuse de recibo.',
    'PROHIBIDO confirmar, « me ocupo », « voy a mirar ».',
    'Empieza con el ENTREGABLE: tabla, cifras, ruta, código — cero intro.',
  ].join(' '),
  en: [
    'VOICE MODE — HARD RULE:',
    'Acknowledgment already spoken.',
    'FORBIDDEN: confirming, “on it”, “I’ll check/look”.',
    'Start with the DELIVERABLE: markdown table, numbers, file path, code — zero intro.',
  ].join(' '),
};

function voiceAckAlreadySaid(locale, ackText) {
  const t = String(ackText || '').trim();
  if (!t) return '';
  const lang = normalizeLocale(locale);
  if (lang === 'es') {
    return `Acuse ya mostrado (NO lo reescribas ni lo completes): « ${t} ».`;
  }
  if (lang === 'en') {
    return `Ack already shown (do NOT rewrite or continue it): “${t}”.`;
  }
  return `Accusé déjà affiché (NE le réécris PAS et ne le continues PAS) : « ${t} ».`;
}

const IMAGE_PROMPTS = {
  fr: 'Analyse les images jointes.',
  es: 'Analiza las imágenes adjuntas.',
  en: 'Analyze the attached images.',
};

function agentIdentityDirective(locale, agentName, appName, { voiceTurn = false } = {}) {
  const name = String(agentName || 'Zephir').trim() || 'Zephir';
  const app = String(appName || 'KovZu').trim() || 'KovZu';
  const lang = normalizeLocale(locale);
  if (voiceTurn) {
    if (lang === 'es') {
      return `Tu nombre es ${name}. Responde como ${name} en ${app}. Sin presentación.`;
    }
    if (lang === 'en') {
      return `Your name is ${name}. Answer as ${name} in ${app}. No self-introduction.`;
    }
    return `Tu t’appelles ${name}. Réponds en tant que ${name} dans ${app}. Pas de présentation.`;
  }
  if (lang === 'es') {
    return `Tu nombre es ${name}. El usuario te llama ${name}. Responde como ${name}. La aplicación se llama ${app}.`;
  }
  if (lang === 'en') {
    return `Your name is ${name}. The user calls you ${name}. Answer as ${name}. The app is called ${app}.`;
  }
  return `Tu t’appelles ${name}. L’utilisateur t’appelle ${name}. Réponds en tant que ${name}. L’application s’appelle ${app}.`;
}

function cursorWorkspaceDirectives(locale, workspacePath) {
  const ws = String(workspacePath || '').trim().replace(/\\/g, '/').replace(/\/$/, '');
  if (!ws) return '';
  const lang = normalizeLocale(locale);
  const assets = `${ws}/assets`;
  const docs = `${ws}/docs`;
  const data = `${ws}/data`;
  const scripts = `${ws}/scripts`;
  if (lang === 'es') {
    return [
      `WORKSPACE ACTIVO: ${ws}.`,
      `Organiza los entregables: ${assets}/ (imágenes, exports), ${docs}/ (docx, pdf, odt), ${data}/ (csv, xlsx), ${scripts}/ (helpers puntuales).`,
      'Los entregables para el usuario se guardan en el workspace (no en ~/.cursor/projects/).',
      'En la respuesta: embed markdown ![descripción](ruta_absoluta) para imágenes; [📄 nombre](/ruta/absoluta.pdf) para documentos.',
    ].join(' ');
  }
  if (lang === 'en') {
    return [
      `ACTIVE WORKSPACE: ${ws}.`,
      `Organize deliverables: ${assets}/ (images, exports), ${docs}/ (docx, pdf, odt), ${data}/ (csv, xlsx), ${scripts}/ (one-off helpers).`,
      'User deliverables are saved in the active workspace (not in ~/.cursor/projects/).',
      'In replies: markdown embed ![caption](absolute_path) for images; [📄 name](/absolute/path.pdf) for documents.',
    ].join(' ');
  }
  return [
    `WORKSPACE ACTIF : ${ws}.`,
    `Organise les livrables : ${assets}/ (images, exports), ${docs}/ (docx, pdf, odt), ${data}/ (csv, xlsx), ${scripts}/ (scripts ponctuels).`,
    'Les livrables pour l’utilisateur sont rangés dans le workspace (pas dans ~/.cursor/projects/).',
    'Dans la réponse : embed markdown ![légende](chemin_absolu) pour les images ; [📄 nom](/chemin/absolu.pdf) pour les documents.',
  ].join(' ');
}

/** Multimedia + on-demand tooling — makes cursor-agent improvise like ChatGPT office mode. */
function cursorWorkspacePlaybookDirectives(locale, workspacePath) {
  const ws = String(workspacePath || '').trim().replace(/\\/g, '/').replace(/\/$/, '');
  if (!ws) return '';
  const lang = normalizeLocale(locale);
  if (lang === 'es') {
    return [
      'PLAYBOOK MULTIMEDIA KOVZU — improvisa e instala SOLO lo necesario para la tarea (nunca al inicio de sesión):',
      'Imagen/logo/mockup → GenerateImage, guardar en assets/ ; respuesta ![leyenda](/ruta/absoluta.png).',
      'PDF/informe → reportlab, weasyprint o pandoc en docs/ ; citar ruta absoluta en markdown.',
      'Word/docx → python-docx o pandoc en docs/ ; citar ruta absoluta.',
      'Excel/xlsx/csv → openpyxl o pandas en data/ ; citar ruta absoluta.',
      'Gráficos → ```mermaid``` inline o matplotlib guardado en assets/.',
      'Antes de instalar: which, python3 -c "import …" o npm list ; si falta → pip install / npm install / apt SOLO para esta tarea.',
      'No preinstalar paquetes al arrancar — instalar sobre la marcha cuando la tarea lo exija.',
      'Documento SUBIDO (en _attachments/) → detecta el tipo y extrae el contenido: PDF → pdftotext/pdfplumber, Word → python-docx, Excel/CSV → openpyxl/pandas ; instala solo lo necesario, luego responde o transforma.',
      'Reutiliza scripts/ del workspace antes de duplicar ; crea helpers reutilizables ahí si hace falta.',
    ].join(' ');
  }
  if (lang === 'en') {
    return [
      'KOVZU MULTIMEDIA PLAYBOOK — improvise and install ONLY what the task needs (never at session start):',
      'Image/logo/mockup → GenerateImage, save under assets/ ; reply ![caption](/absolute/path.png).',
      'PDF/report → reportlab, weasyprint, or pandoc into docs/ ; cite absolute path in markdown.',
      'Word/docx → python-docx or pandoc into docs/ ; cite absolute path.',
      'Excel/xlsx/csv → openpyxl or pandas into data/ ; cite absolute path.',
      'Charts → ```mermaid``` inline or matplotlib saved under assets/.',
      'Before installing: which, python3 -c "import …", or npm list ; if missing → pip install / npm install / apt ONLY for this task.',
      'Do NOT pre-install packages at session start — install on demand as the task requires.',
      'UPLOADED document (in _attachments/) → detect the type and extract content: PDF → pdftotext/pdfplumber, Word → python-docx, Excel/CSV → openpyxl/pandas ; install only what is needed, then answer or transform.',
      'Reuse scripts/ in the workspace before duplicating ; create reusable helpers there when useful.',
    ].join(' ');
  }
  return [
    'PLAYBOOK MULTIMÉDIA KOVZU — improvise et installe UNIQUEMENT ce qu’il faut pour la tâche (jamais au démarrage de session) :',
    'Image/logo/mockup → GenerateImage, enregistrer dans assets/ ; réponse ![légende](/chemin/absolu.png).',
    'PDF/rapport → reportlab, weasyprint ou pandoc dans docs/ ; citer le chemin absolu en markdown.',
    'Word/docx → python-docx ou pandoc dans docs/ ; citer le chemin absolu.',
    'Excel/xlsx/csv → openpyxl ou pandas dans data/ ; citer le chemin absolu.',
    'Graphiques → ```mermaid``` inline ou matplotlib enregistré dans assets/.',
    'Avant d’installer : which, python3 -c "import …" ou npm list ; si absent → pip install / npm install / apt UNIQUEMENT pour cette tâche.',
    'Ne PAS pré-installer de paquets au démarrage — installer au fil de l’eau quand la tâche l’exige.',
    'Document UPLOADÉ (dans _attachments/) → détecte le type et extrais le contenu : PDF → pdftotext/pdfplumber, Word → python-docx, Excel/CSV → openpyxl/pandas ; installe uniquement ce qu’il faut, puis réponds ou transforme.',
    'Réutilise scripts/ du workspace avant de dupliquer ; crée des helpers réutilisables là si utile.',
  ].join(' ');
}

function cursorWorkspaceContextDirectives(locale, workspacePath) {
  const layout = cursorWorkspaceDirectives(locale, workspacePath);
  const playbook = cursorWorkspacePlaybookDirectives(locale, workspacePath);
  if (!layout) return '';
  return playbook ? `${layout}\n${playbook}` : layout;
}

export function cursorOutputFormatDirectives(locale) {
  const lang = normalizeLocale(locale);
  return CURSOR_OUTPUT_FORMAT[lang] || CURSOR_OUTPUT_FORMAT.fr;
}

export function cursorLanguageDirectives(locale) {
  const lang = normalizeLocale(locale);
  return CURSOR_LANGUAGE[lang] || CURSOR_LANGUAGE.fr;
}

/** Thinking mode directive for Claude / LiteLLM inject (auto = no extra line). */
export function claudeThinkingDirective(mode, locale) {
  const m = String(mode || 'auto').trim().toLowerCase();
  if (m === 'auto') return '';
  const lang = normalizeLocale(locale);
  if (m === 'off') {
    if (lang === 'es') return 'Thinking DESACTIVADO: responde directo, sin cadena de razonamiento visible.';
    if (lang === 'en') return 'Thinking OFF: answer directly without visible chain-of-thought.';
    return 'Thinking DÉSACTIVÉ : réponds directement, sans raisonnement visible ni étapes internes.';
  }
  if (lang === 'es') return 'Thinking ACTIVADO: razona paso a paso antes de responder (visible si el modelo lo permite).';
  if (lang === 'en') return 'Thinking ON: reason step-by-step before answering (visible if the model supports it).';
  return 'Thinking ACTIVÉ : raisonne étape par étape avant de répondre (visible si le modèle le supporte).';
}

export function claudeEffortForThinking(mode) {
  const m = String(mode || 'auto').trim().toLowerCase();
  if (m === 'off') return 'low';
  if (m === 'on') return 'high';
  return 'medium';
}

/** Short per-turn reminder for LiteLLM / OpenRouter models that ignore CONTEXT.md. */
export function compactLanguageReminder(locale) {
  const lang = normalizeLocale(locale);
  if (lang === 'es') {
    return 'IDIOMA OBLIGATORIO: español (no catalán, no francés, no inglés).';
  }
  if (lang === 'en') {
    return 'MANDATORY LANGUAGE: English only (not French, Spanish, or Catalan).';
  }
  return 'LANGUE OBLIGATOIRE : français uniquement (pas d’espagnol, pas de catalan, pas d’anglais).';
}

function cursorVoiceTtsDirectives(locale) {
  const lang = normalizeLocale(locale);
  return CURSOR_VOICE_TTS[lang] || CURSOR_VOICE_TTS.fr;
}

function voiceUserRequestLabel(locale) {
  const lang = normalizeLocale(locale);
  if (lang === 'es') return 'Petición del usuario (entrega el resultado, sin acuse):';
  if (lang === 'en') return 'User request (deliver the result, no acknowledgment):';
  return 'Demande utilisateur (livre le résultat, sans accusé) :';
}

/**
 * Prefix inject message so Cursor CLI uses language, agent + app name (no emotion tags).
 * @param {string} message
 * @param {string} locale
 * @param {{ agentName?: string, appName?: string, voiceTurn?: boolean, ackText?: string, workspaceCwd?: string }} [opts]
 */
/** Rappel court par tour : consulter ses skills, sinon improviser (bases posées au prime). */
function cursorSkillsReminder(locale) {
  const lang = normalizeLocale(locale);
  if (lang === 'en') {
    return 'Use your KovZu skills: if one covers the request follow its proven method, otherwise improvise to reach the goal; install only what is needed.';
  }
  if (lang === 'es') {
    return 'Usa tus skills KovZu: si uno cubre la petición sigue su método probado, si no improvisa para lograr el objetivo; instala solo lo necesario.';
  }
  return 'Utilise tes skills KovZu : si l’un couvre la demande suis sa méthode éprouvée, sinon improvise pour atteindre le but ; installe uniquement ce qu’il faut.';
}

export function applyCursorLanguage(message, locale, opts = {}) {
  const lang = normalizeLocale(locale);
  const text = String(message || '').trim();
  const voiceTurn = Boolean(opts.voiceTurn);
  const bootstrapped = Boolean(opts.bootstrapped);
  const alwaysLang = Boolean(opts.alwaysLang);

  // LiteLLM / Kimi: re-inject language every turn — models skip CONTEXT.md rules.
  if (bootstrapped && !voiceTurn && alwaysLang) {
    const reminder = compactLanguageReminder(lang);
    const thinkingLine = claudeThinkingDirective(opts.claudeThinking, lang);
    const prefix = [reminder, thinkingLine].filter(Boolean).join('\n');
    if (!text) return prefix || text;
    if (prefix && text.includes(reminder)) {
      return thinkingLine && !text.includes(thinkingLine) ? `${thinkingLine}\n\n${text}` : text;
    }
    return prefix ? `${prefix}\n\n${text}` : text;
  }

  // After warm-up + prime: user text only — context already in chat_id / CONTEXT.md.
  if (bootstrapped && !voiceTurn) {
    return text;
  }

  const workspaceRules = cursorWorkspaceContextDirectives(lang, opts.workspaceCwd);
  const outputRules = cursorOutputFormatDirectives(lang);
  const langRules = cursorLanguageDirectives(lang);
  const skillsReminder = cursorSkillsReminder(lang);

  if (voiceTurn) {
    if (bootstrapped) {
      const parts = [
        cursorVoiceTtsDirectives(lang),
        CURSOR_VOICE_SKIP_ACK[lang] || CURSOR_VOICE_SKIP_ACK.fr,
      ];
      const already = voiceAckAlreadySaid(lang, opts.ackText);
      if (already) parts.push(already);
      const directive = parts.join('\n');
      if (!text) return directive;
      return `${directive}\n\n${voiceUserRequestLabel(lang)}\n${text}`;
    }
    const parts = [
      agentIdentityDirective(lang, opts.agentName, opts.appName, { voiceTurn: true }),
      langRules,
      ...(workspaceRules ? [workspaceRules] : []),
      outputRules,
      skillsReminder,
      cursorVoiceTtsDirectives(lang),
      CURSOR_VOICE_SKIP_ACK[lang] || CURSOR_VOICE_SKIP_ACK.fr,
    ];
    const already = voiceAckAlreadySaid(lang, opts.ackText);
    if (already) parts.push(already);
    const directive = parts.join('\n');
    if (!text) return directive;
    return `${directive}\n\n${voiceUserRequestLabel(lang)}\n${text}`;
  }

  const parts = [
    agentIdentityDirective(lang, opts.agentName, opts.appName),
    langRules,
    ...(workspaceRules ? [workspaceRules] : []),
    outputRules,
    skillsReminder,
  ];
  const thinkingLine = claudeThinkingDirective(opts.claudeThinking, lang);
  if (thinkingLine) parts.push(thinkingLine);
  const directive = parts.join('\n');
  if (!text) return directive;
  if (text.startsWith(parts[0])) return text;
  return `${directive}\n\n${text}`;
}

export function imageOnlyPrompt(locale) {
  return IMAGE_PROMPTS[normalizeLocale(locale)] || IMAGE_PROMPTS.fr;
}
