import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { listVoiceAliases } from './voiceAliasStore.js';

/**
 * Infrastructure lexicon for voice: canonical machine / infra names the
 * operator may say aloud. Sources:
 *  - CLI nodes (config)
 *  - SSH hosts — the DEPLOYMENT's ssh configs, discovered at runtime
 *    (each client install has its own machines; nothing is hardcoded)
 *  - voice_aliases table (canonicals + spoken aliases)
 * Feeds Deepgram keyterm boosting and the post-STT normalizer.
 */

const CACHE_MS = 30_000;
let cache = { at: 0, data: null };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Candidate ssh configs, most specific first:
 *  1. VOICE_SSH_CONFIG env (colon-separated) — explicit override per deployment
 *  2. /apps/{mon-app}/.ssh/config — app user home (turbinobash: derived from
 *     the code path, never hardcoded)
 *  3. ~/.ssh/config of the user running the API
 */
function sshConfigCandidates() {
  const files = [];
  const override = String(process.env.VOICE_SSH_CONFIG || '').trim();
  if (override) {
    for (const p of override.split(':')) {
      if (p.trim()) files.push(p.trim());
    }
  }
  const appRoot = __dirname.match(/^(\/apps\/[^/]+)\//)?.[1]
    || process.cwd().match(/^(\/apps\/[^/]+)(\/|$)/)?.[1];
  if (appRoot) files.push(path.join(appRoot, '.ssh/config'));
  files.push(path.join(os.homedir(), '.ssh/config'));
  return [...new Set(files)];
}

function parseSshHosts(raw, hosts) {
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*Host\s+(.+)$/i);
    if (!m) continue;
    for (const h of m[1].split('#')[0].trim().split(/\s+/)) {
      if (!h || h.includes('*') || h.includes('?') || h.startsWith('!')) continue;
      hosts.add(h);
    }
  }
}

function sshConfigHosts() {
  const hosts = new Set();
  for (const file of sshConfigCandidates()) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
    parseSshHosts(raw, hosts);
    // Include directives (one level) — master configs often split by pool
    for (const line of raw.split('\n')) {
      const inc = line.match(/^\s*Include\s+(.+)$/i);
      if (!inc) continue;
      const incPath = inc[1].trim().replace(/^~\//, `${path.dirname(path.dirname(file))}/`);
      if (incPath.includes('*')) continue;
      try { parseSshHosts(fs.readFileSync(path.resolve(path.dirname(file), incPath), 'utf8'), hosts); } catch { /* absent */ }
    }
  }
  return [...hosts];
}

export async function getVoiceLexicon() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

  // Ordered by spoken likelihood — keyterm boosting truncates, so CLI nodes
  // and alias canonicals (names the operator actually says) come first.
  const canonicals = new Set();
  for (const node of config.cli.nodes || []) {
    if (node?.name) canonicals.add(node.name);
  }

  /** @type {Array<{alias: string, canonical: string}>} */
  let aliases = [];
  try {
    aliases = await listVoiceAliases();
    for (const a of aliases) canonicals.add(a.canonical);
  } catch { /* DB down — lexicon still works from config/ssh */ }

  for (const host of sshConfigHosts()) canonicals.add(host);

  const data = {
    canonicals: [...canonicals],
    aliases: aliases.map(({ alias, canonical }) => ({ alias, canonical })),
  };
  cache = { at: Date.now(), data };
  return data;
}

export function invalidateVoiceLexicon() {
  cache = { at: 0, data: null };
}

/** Extra Deepgram keyterms — canonical names the STT should favor. */
export async function getInfraKeyterms(limit = 60) {
  const { canonicals } = await getVoiceLexicon();
  return canonicals.slice(0, limit);
}
