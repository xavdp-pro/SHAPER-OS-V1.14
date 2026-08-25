/**
 * @file analyze.js
 * Per-file analysis for the GED inspector: extract, digest, and — when a model is
 * configured — summarize for a human reader.
 *
 * Rule 0G: with no model configured we NEVER fabricate an AI summary. We return a
 * structural digest explicitly labelled `mode: "structural"`, and the UI says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractTextFromFile } from '../../rag/lib/extractor.js';

const MAX_PROMPT_CHARS = 12000;

/** Structural digest — always computed, never guessed. */
export function buildStructure(text, meta) {
  const ext = String(meta.ext || '').toLowerCase();
  const lines = text ? text.split(/\r?\n/) : [];
  const structure = {
    format: meta.format || ext.replace('.', '') || 'inconnu',
    sizeBytes: meta.sizeBytes || 0,
    chars: text ? text.length : 0,
    words: text ? (text.match(/\S+/g) || []).length : 0,
    lines: lines.length,
  };

  if (ext === '.csv' || ext === '.tsv') {
    const sep = ext === '.tsv' ? '\t' : (lines[0] || '').includes(';') ? ';' : ',';
    const header = (lines[0] || '').split(sep).map(c => c.trim()).filter(Boolean);
    const rows = lines.slice(1).filter(l => l.trim());
    structure.columns = header;
    structure.rowCount = rows.length;
    structure.separator = sep === '\t' ? 'tabulation' : sep;

    // Column totals where every value parses as a number — useful for a bilan.
    const totals = {};
    header.forEach((col, i) => {
      const values = rows.map(r => r.split(sep)[i]).filter(v => v !== undefined && String(v).trim() !== '');
      if (!values.length) return;
      const nums = values.map(v => Number(String(v).replace(/\s/g, '').replace(',', '.')));
      if (nums.every(n => Number.isFinite(n))) {
        totals[col] = Number(nums.reduce((a, b) => a + b, 0).toFixed(2));
      }
    });
    if (Object.keys(totals).length) structure.numericTotals = totals;
  }

  return structure;
}

/** Frequency-based keywords, stopwords stripped. Deterministic, no model needed. */
export function extractKeywords(text, limit = 8) {
  if (!text) return [];
  const stop = new Set(('le la les un une des de du au aux et ou mais donc or ni car ce cet cette ces son sa ses leur leurs '
    + 'pour par sur avec sans dans en est sont a ont que qui quoi dont plus moins tout tous toute toutes il elle ils elles '
    + 'nous vous je tu on se ne pas the and for with this that from are was were you your our their').split(/\s+/));
  const freq = new Map();
  for (const raw of text.toLowerCase().match(/[a-zà-ÿ0-9_-]{4,}/g) || []) {
    if (stop.has(raw)) continue;
    freq.set(raw, (freq.get(raw) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp']);

/** LLM configuration, read fresh so a container restart is enough to change it. */
export function llmConfig() {
  const apiKey = process.env.GED_LLM_API_KEY
    || process.env.OLLAMA_API_KEY
    || process.env.OLLAMA_CLOUD_API_KEY
    || process.env.OLLAMA_KEY_PRO
    || '';
  return {
    apiKey,
    baseUrl: (process.env.GED_LLM_BASE_URL || process.env.OLLAMA_CLOUD_BASE_URL || 'https://ollama.com/v1').replace(/\/$/, ''),
    model: process.env.GED_LLM_MODEL || 'nemotron-3-nano:30b',
    visionModel: process.env.GED_VISION_MODEL || 'minimax-m3',
    enabled: Boolean(apiKey),
  };
}

/**
 * Ask the configured model for a human-facing summary.
 * @returns {Promise<{summary: string, model: string}>}
 * @throws when the call fails — the caller degrades to structural and SAYS so.
 */
export async function summarizeWithModel(text, fileName, cfg = llmConfig(), fetchImpl = fetch) {
  const excerpt = text.slice(0, MAX_PROMPT_CHARS);
  const prompt = [
    `Voici le contenu du fichier « ${fileName} ».`,
    '',
    'Rédige pour un lecteur non technique, en français :',
    "1. Une phrase disant ce qu'est ce document.",
    '2. Deux à quatre phrases sur ce qu\'il contient concrètement (chiffres clés, période, parties prenantes).',
    "3. Une phrase sur ce qu'on peut en faire ou ce qu'il faut en retenir.",
    '',
    "N'invente rien. Si une information ne figure pas dans le fichier, ne la mentionne pas.",
    'Pas de titre, pas de puces, pas de markdown : du texte suivi.',
    '',
    '--- CONTENU ---',
    excerpt,
  ].join('\n');

  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: 'Tu résumes des documents pour un dirigeant non technique. Tu es factuel et concis.' },
        { role: 'user', content: prompt },
      ],
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Model HTTP ${res.status}`);
  }
  const data = await res.json();
  const summary = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!summary) throw new Error('Empty model response');
  return { summary, model: cfg.model };
}

/**
 * Ask the configured vision model for image understanding.
 * @returns {Promise<{summary: string, keywords: Array<{word: string, count: number}>, model: string}>}
 */
export async function summarizeImageWithModel(absPath, fileName, cfg = llmConfig(), fetchImpl = fetch) {
  const buffer = fs.readFileSync(absPath);
  const ext = (path.extname(fileName) || path.extname(absPath)).toLowerCase().replace('.', '') || 'jpeg';
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
  const b64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const prompt = [
    `Tu es un moteur d'analyse documentaire et vision pour la GED de l'entreprise. Analyse cette image « ${fileName} » avec précision en français.`,
    '1. Rédige un résumé fluide, soigné et factuel (1 à 3 phrases décrivant le sujet, le cadrage, les détails notables et le contexte).',
    '2. Fournis entre 5 et 8 mots-clés pertinents caractérisant l\'image.',
    '',
    'Réponds au format JSON strict :',
    '{',
    '  "summary": "Description précise...",',
    '  "keywords": ["mot1", "mot2", "mot3", "mot4", "mot5"]',
    '}',
  ].join('\n');

  const model = cfg.visionModel || 'minimax-m3';
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Vision Model HTTP ${res.status}`);
  }
  const data = await res.json();
  const rawText = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!rawText) throw new Error('Empty vision response');

  let summary = rawText;
  let keywords = [];

  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.summary) summary = String(parsed.summary).trim();
      if (Array.isArray(parsed.keywords)) {
        keywords = parsed.keywords.map(k => ({ word: String(k).trim(), count: 1 })).filter(k => k.word);
      }
    }
  } catch {
    // fallback
  }

  return { summary, keywords: keywords.slice(0, 10), model };
}

/**
 * Full analysis of one file.
 * Always returns a result — `mode` states how the summary was produced:
 *   'model'      → a configured model read the content
 *   'structural' → no model available; digest only, no prose invented
 */
export async function analyzeFile(absPath, { cfg = llmConfig(), fetchImpl = fetch, displayName } = {}) {
  const fileName = displayName || path.basename(absPath);
  const stat = fs.statSync(absPath);
  const ext = (path.extname(fileName) || path.extname(absPath)).toLowerCase();
  const isImage = IMG_EXTS.has(ext);

  let extracted = null;
  let extractError = null;
  if (!isImage) {
    try {
      extracted = await extractTextFromFile(absPath, { displayName: fileName });
    } catch (err) {
      extractError = err.message;
    }
  }

  const text = extracted?.text || '';
  const structure = buildStructure(text, {
    ext,
    format: extracted?.format || (isImage ? ext.replace('.', '') : undefined),
    sizeBytes: stat.size,
  });
  const keywords = extractKeywords(text);

  const base = {
    file: fileName,
    analyzedAt: Date.now(),
    structure,
    keywords,
    textPreview: text ? text.slice(0, 1200) : '',
    extractError,
  };

  // Traitement Image avec modèle Vision
  if (isImage) {
    if (cfg.enabled) {
      try {
        const { summary, keywords: vKeywords, model } = await summarizeImageWithModel(absPath, fileName, cfg, fetchImpl);
        return {
          ...base,
          mode: 'model',
          model,
          summary,
          keywords: vKeywords.length ? vKeywords : base.keywords,
        };
      } catch (err) {
        return {
          ...base,
          mode: 'structural',
          modelError: err.message,
          summary: `L'analyse visuelle IA n'a pas pu être effectuée (${err.message}). Voici les propriétés techniques de l'image.`,
        };
      }
    }
    return {
      ...base,
      mode: 'structural',
      summary: "Image cataloguée dans la GED. Activez la clé IA pour déclencher l'analyse visuelle automatique.",
    };
  }

  if (!text.trim()) {
    return {
      ...base,
      mode: 'structural',
      summary: extractError
        ? `Le contenu n'a pas pu être extrait (${extractError}). Seules les propriétés du fichier sont disponibles.`
        : "Aucun texte exploitable n'a été trouvé dans ce fichier. Seules ses propriétés sont disponibles.",
    };
  }

  if (cfg.enabled) {
    try {
      const { summary, model } = await summarizeWithModel(text, fileName, cfg, fetchImpl);
      return { ...base, mode: 'model', model, summary };
    } catch (err) {
      return {
        ...base,
        mode: 'structural',
        modelError: err.message,
        summary: `Le modèle n'a pas pu être interrogé (${err.message}). Voici ce qui est établi par lecture directe du fichier, sans interprétation.`,
      };
    }
  }

  return {
    ...base,
    mode: 'structural',
    summary: "Aucun modèle n'est configuré pour cette GED. Voici ce qui est établi par lecture directe du fichier, sans interprétation.",
  };
}

/**
 * HTTP envelope for POST /api/analyze.
 * Evidence fields (digest, words, totals) sit at the root so a caller does not
 * have to trust nested prose. `analysis` remains the full structural record.
 */
export function toAnalyzeResponse(doc, analysis) {
  return {
    ok: true,
    path: doc?.relPath || null,
    digest: doc?.hash || null,
    catalog: doc
      ? {
          id: doc.id,
          originalName: doc.originalName,
          folder: doc.folder || '',
          hash: doc.hash,
          size: doc.size,
        }
      : null,
    words: analysis?.structure?.words ?? 0,
    totals: analysis?.structure?.numericTotals || {},
    analysis,
  };
}
