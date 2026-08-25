import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSkillsCatalog } from './agentSkills.js';
import { buildControlScopeContext } from './controlScope.js';
import {
  buildAttachmentsContextBlock,
} from './attachmentRegistry.js';
import {
  cursorLanguageDirectives,
  cursorOutputFormatDirectives,
  normalizeLocale,
} from './locale.js';

export const KOVZU_DIR = '_kovzu';
export const CONTEXT_FILE = 'CONTEXT.md';
export const LOCAL_FILE = 'local.md';
export const JOURNAL_FILE = 'JOURNAL.md';

export function kovzuDir(workspaceCwd) {
  return path.join(String(workspaceCwd || '').trim(), KOVZU_DIR);
}

export function contextFilePath(workspaceCwd) {
  return path.join(kovzuDir(workspaceCwd), CONTEXT_FILE);
}

export function localNotesPath(workspaceCwd) {
  return path.join(kovzuDir(workspaceCwd), LOCAL_FILE);
}

export function journalFilePath(workspaceCwd) {
  return path.join(kovzuDir(workspaceCwd), JOURNAL_FILE);
}

function ensureLocalNotes(localPath) {
  if (fs.existsSync(localPath)) return;
  fs.writeFileSync(
    localPath,
    '# Local reference notes\n\n<!-- Project-specific context — editable anytime -->\n',
    'utf8',
  );
}

function ensureJournalFile(journalPath, lang) {
  if (fs.existsSync(journalPath)) return;
  const initial = lang === 'en'
    ? '# Persistent System Journal & State (_kovzu/JOURNAL.md)\n\n<!-- Survives container reboots and reloads. Record installed tools, configured services, and completed milestones here. -->\n'
    : lang === 'es'
      ? '# Diario de a bordo persistente & Estado del sistema (_kovzu/JOURNAL.md)\n\n<!-- Sobrevive a reinicios del contenedor. Registra aquí herramientas instaladas, servicios configurados e hitos completados. -->\n'
      : '# Journal de bord persistant & Mémoire système (_kovzu/JOURNAL.md)\n\n<!-- Ce journal survit aux reboots et aux reloads. Consigne ici tes paquets installés, briques/services configurés et jalons accomplis. -->\n';
  fs.writeFileSync(journalPath, initial, 'utf8');
}

function readTopologyManifest(workspaceCwd) {
  const candidates = [
    path.join(String(workspaceCwd || '').trim(), 'topology.json'),
    path.join(String(workspaceCwd || '').trim(), 'deps.json'),
    path.join(process.cwd(), 'software/topology.json'),
    path.join(process.cwd(), '../software/topology.json'),
    path.join(process.cwd(), '../../software/topology.json'),
    path.join(process.cwd(), '../../../software/topology.json'),
    path.join(process.cwd(), 'topology.json'),
    path.join(process.cwd(), '../../topology.json'),
    path.join(process.cwd(), '../../../topology.json'),
    '/root/SHAPER-OS/topology.json',
    '/app/topology.json',
    '/data/topology.json',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      try {
        const raw = fs.readFileSync(c, 'utf8').trim();
        if (raw) return { path: c, content: raw };
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function buildServicesDirectoryBlock(lang) {
  if (lang === 'en') {
    return [
      '| Service | Local Endpoint | Auth / Protocol | Role & Invariants |',
      '| :--- | :--- | :--- | :--- |',
      '| **Vault** | `http://127.0.0.1:8610` | `Bearer <VAULT_TOKEN from software/.env>` | AES-256-GCM encrypted secrets (`/api/secret/*`, `/api/secrets`) |',
      '| **Logger** | `http://127.0.0.1:8620` | None | JSONL audit ingestion (`POST /api/ingest`), SSE live stream |',
      '| **Queue** | `http://127.0.0.1:8640` | None | Async job queue (`POST /api/jobs`, `GET /api/jobs/:id`) |',
      '| **Maestro** | `http://127.0.0.1:8630` | None | Cluster scheduler & health (`GET /api/health`, `/api/status`) |',
      '| **GED** | `http://127.0.0.1:8660` | None | Sovereign document hub (`/data/ged/`, `.meta.json`) |',
      '| **Qdrant** | `http://127.0.0.1:6333` | None | Semantic vector store (`/collections`, `/points/search`) |',
      '| **Helm** | `http://127.0.0.1:8650` | Session | Universal KovZu operator cockpit |',
      '| **Bridge** | `http://127.0.0.1:4440` | Token | OpenCode AI runtime bridge |',
    ].join('\n');
  }
  return [
    '| Service | Point d’accès local | Auth / Protocole | Rôle & Invariants |',
    '| :--- | :--- | :--- | :--- |',
    '| **Vault** | `http://127.0.0.1:8610` | `Bearer <VAULT_TOKEN from software/.env>` | Coffre-fort chiffré AES-256-GCM (`/api/secret/*`, `/api/secrets`) |',
    '| **Logger** | `http://127.0.0.1:8620` | Aucun | Ingestion logs JSONL (`POST /api/ingest`), flux SSE temps réel |',
    '| **Queue** | `http://127.0.0.1:8640` | Aucun | File de jobs asynchrones (`POST /api/jobs`, `GET /api/jobs/:id`) |',
    '| **Maestro** | `http://127.0.0.1:8630` | Aucun | Orchestrateur & santé cluster (`GET /api/health`, `/api/status`) |',
    '| **GED** | `http://127.0.0.1:8660` | Aucun | Hub documentaire souverain (`/data/ged/`, `.meta.json`) |',
    '| **Qdrant** | `http://127.0.0.1:6333` | Aucun | Base vectorielle sémantique (`/collections`, `/points/search`) |',
    '| **Helm** | `http://127.0.0.1:8650` | Session | Cockpit de pilotage universel KovZu |',
    '| **Bridge** | `http://127.0.0.1:4440` | Token | Runtime agent OpenCode |',
  ].join('\n');
}

/**
 * Compile durable reference context into workspace/_kovzu/CONTEXT.md.
 * @returns {{ ok: boolean, path?: string, hash?: string, reason?: string }}
 */
export function digestContext({
  workspaceCwd,
  briefing = '',
  locale = 'fr',
  engineLabel = '',
} = {}) {
  const cwd = String(workspaceCwd || '').trim();
  if (!cwd) return { ok: false, reason: 'no workspace' };

  const lang = normalizeLocale(locale);
  const dir = kovzuDir(cwd);
  fs.mkdirSync(dir, { recursive: true });

  const localPath = localNotesPath(cwd);
  ensureLocalNotes(localPath);
  const localNotes = fs.readFileSync(localPath, 'utf8').trim();

  const journalPath = journalFilePath(cwd);
  ensureJournalFile(journalPath, lang);
  const journalNotes = fs.readFileSync(journalPath, 'utf8').trim();

  const sections = [
    '# KovZu session context reference',
    '',
    `Workspace: \`${cwd}\``,
    '',
    '## Annuaire Réseau des Services Shaper OS (Service Directory)',
    buildServicesDirectoryBlock(lang),
    '',
    '## Language & output format',
    cursorLanguageDirectives(lang),
    '',
    cursorOutputFormatDirectives(lang),
    '',
    '## Operator briefing (global)',
    String(briefing || '').trim() || '(none)',
    '',
    '## Local notes (project / session)',
    localNotes || '(none)',
    '',
    '## Journal de bord persistant (Mémoire système & Survie aux Reboots)',
    journalNotes || '(aucun événement consigné pour l’instant)',
    '',
    '## Attachments registry',
    buildAttachmentsContextBlock(cwd),
    '',
    '## Skills catalog',
    buildSkillsCatalog(lang, engineLabel),
  ];

  const topo = readTopologyManifest(cwd);
  if (topo) {
    sections.push(
      '',
      `## Topology & Ecosystem Manifest (${path.basename(topo.path)})`,
      '```json',
      topo.content,
      '```',
    );
  }

  const scope = buildControlScopeContext(lang);
  if (scope) {
    sections.push('', '## Control scope', scope);
  }

  const content = `${sections.join('\n')}\n`;
  const outPath = contextFilePath(cwd);
  fs.writeFileSync(outPath, content, 'utf8');

  // Also write to global shared roots so any CLI agent instance always finds it
  const globalTargets = [
    '/data/opencode-ws/_kovzu/CONTEXT.md',
    '/data/_kovzu/CONTEXT.md',
  ];
  for (const tgt of globalTargets) {
    try {
      const tgtDir = path.dirname(tgt);
      if (fs.existsSync(path.dirname(tgtDir))) {
        fs.mkdirSync(tgtDir, { recursive: true });
        fs.writeFileSync(tgt, content, 'utf8');
      }
    } catch {
      /* non-blocking */
    }
  }

  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  return { ok: true, path: outPath, hash };
}

export function hashContextFile(workspaceCwd) {
  try {
    const file = contextFilePath(workspaceCwd);
    if (!fs.existsSync(file)) return '';
    const raw = fs.readFileSync(file, 'utf8');
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}
