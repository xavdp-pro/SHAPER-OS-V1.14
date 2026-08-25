import fs from 'node:fs';
import path from 'node:path';
import { digestContext, localNotesPath } from './contextDigest.js';
import { normalizeLocale } from './locale.js';
import { updateUser, getUser } from './usersStore.js';
import {
  isContextBootstrapped,
  markContextBootstrapped,
} from './contextSession.js';
import { injectMessage } from './bridgeClient.js';

function appendSection(filePath, heading, line) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const block = `\n\n## ${heading} (${stamp})\n\n${String(line || '').trim()}\n`;
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  fs.writeFileSync(filePath, `${prev.trimEnd()}${block}`, 'utf8');
}

/**
 * Append a durable note — local (workspace) or global (user briefing).
 */
export async function rememberContextNote({
  userId,
  workspaceCwd,
  scope = 'local',
  content = '',
  locale = 'fr',
} = {}) {
  const text = String(content || '').trim();
  if (!text) throw new Error('content required');

  const lang = normalizeLocale(locale);

  if (scope === 'global') {
    if (!userId) throw new Error('user required for global scope');
    const user = await getUser(userId);
    if (!user) throw new Error('user not found');
    const briefing = [String(user.briefing || '').trim(), `- ${text}`]
      .filter(Boolean)
      .join('\n');
    await updateUser(userId, { briefing });
  } else {
    const cwd = String(workspaceCwd || '').trim();
    if (!cwd) throw new Error('workspace required for local scope');
    const localPath = localNotesPath(cwd);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    if (!fs.existsSync(localPath)) {
      fs.writeFileSync(
        localPath,
        '# Local reference notes\n\n<!-- Project-specific context — editable anytime -->\n',
        'utf8',
      );
    }
    appendSection(localPath, scope === 'local' ? 'Note' : 'Note', text);
  }

  const user = userId ? await getUser(userId) : null;
  const digest = digestContext({
    workspaceCwd,
    briefing: user?.briefing || '',
    locale: lang,
  });

  return { digest, scope, content: text };
}

/** Silent hot-reload when session already bootstrapped. */
export function buildContextHotReloadMessage({ contextPath, locale = 'fr' } = {}) {
  const file = String(contextPath || '').trim();
  if (!file) return '';
  const lang = normalizeLocale(locale);
  if (lang === 'en') {
    return [
      'Context update — integrate silently (do not greet or repeat to the operator).',
      `Re-read this reference file with Read: ${file}`,
      'Merge the new content into your session memory.',
      'Reply with exactly: OK',
    ].join('\n');
  }
  if (lang === 'es') {
    return [
      'Actualización de contexto — integra en silencio (sin saludo ni repetición al operador).',
      `Relee este archivo con Read: ${file}`,
      'Fusiona el nuevo contenido en tu memoria de sesión.',
      'Responde exactamente: OK',
    ].join('\n');
  }
  return [
    'Mise à jour du contexte — intègre en silence (pas de salutation ni répétition à l’opérateur).',
    `Relis ce fichier avec Read : ${file}`,
    'Fusionne le nouveau contenu dans ta mémoire de session.',
    'Réponds exactement : OK',
  ].join('\n');
}

/**
 * Remember + re-digest + optional hot inject into active CLI session.
 */
export async function orchestrateContextRemember({
  conversation,
  userId,
  workspaceCwd,
  scope,
  content,
  locale,
  hotReload = true,
} = {}) {
  const saved = await rememberContextNote({
    userId,
    workspaceCwd,
    scope,
    content,
    locale,
  });

  let inject = null;
  const bootstrapped = isContextBootstrapped(conversation, workspaceCwd);
  if (hotReload && bootstrapped && saved.digest?.path) {
    const msg = buildContextHotReloadMessage({
      contextPath: saved.digest.path,
      locale,
    });
    if (msg) {
      inject = await injectMessage(msg, conversation, [], locale, {
        injectMode: 'bootstrap',
      });
    }
  }

  if (saved.digest?.hash) {
    markContextBootstrapped(conversation, workspaceCwd, saved.digest.hash);
  }

  return {
    ok: true,
    scope: saved.scope,
    digest: saved.digest,
    hotReload: Boolean(inject),
    inject,
  };
}
