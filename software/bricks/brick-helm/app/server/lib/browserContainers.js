import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * POC gestionnaire de conteneurs navigateur (docker sur gbs-h1 ; podman ailleurs
 * plus tard via CONTAINER_CLI). Sert les onglets Debug/Navigateur du panneau droit :
 * lister les conteneurs, lancer un Neko (navigateur WebRTC), arrêter, statut.
 *
 * Label KovZu : `kovzu.browser=1` marque les conteneurs qu'on gère nous-mêmes.
 * Les autres (ex. xavdp-navigator) sont listés en lecture seule (external).
 */

const CLI = process.env.CONTAINER_CLI || 'docker';
const LABEL = 'kovzu.browser';
const NEKO_IMAGE = process.env.NEKO_IMAGE || 'ghcr.io/m1k1o/neko/chromium:latest';
const PORT_MIN = 9450;
const PORT_MAX = 9490;

async function cli(args, { timeout = 20000 } = {}) {
  const { stdout } = await exec(CLI, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

function firstPublishedPort(portsField) {
  // "127.0.0.1:9420->9420/tcp" → 9420 (host side)
  const m = String(portsField || '').match(/127\.0\.0\.1:(\d+)->/);
  return m ? Number(m[1]) : null;
}

/** Lit le mot de passe Neko depuis l'env du conteneur (robuste au redémarrage API). */
async function nekoPassword(name) {
  try {
    const out = await cli(['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', name]);
    const line = out.split('\n').find((l) => l.startsWith('NEKO_PASSWORD='));
    return line ? line.slice('NEKO_PASSWORD='.length).trim() : '';
  } catch {
    return '';
  }
}

/**
 * Query d'auto-login à ajouter à l'URL de l'iframe. Couvre les variantes Neko
 * (v2 `usr`/`pwd`, v3 `password`). Vide si pas de mot de passe connu.
 */
function loginQuery(password) {
  if (!password) return '';
  const p = encodeURIComponent(password);
  return `?usr=admin&pwd=${p}&password=${p}`;
}

/** Liste les conteneurs (nos navigateurs + externes connus type xavdp-navigator). */
export async function listContainers() {
  let out = '';
  try {
    out = await cli(['ps', '-a', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Label "kovzu.browser"}}']);
  } catch (err) {
    return { ok: false, error: err.message, containers: [] };
  }
  const containers = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [name, image, status, ports, managed] = line.split('\t');
    const isBrowserish = managed === '1'
      || /neko|chrom|browser|navigator|selenium|firefox/i.test(`${name} ${image}`);
    if (!isBrowserish) continue;
    const isManaged = managed === '1';
    const running = /^Up/i.test(status || '');
    // Auto-login seulement pour NOS conteneurs Neko (mot de passe lisible via env).
    const pw = isManaged && running ? await nekoPassword(name) : '';
    containers.push({
      name,
      image,
      status,
      port: firstPublishedPort(ports),
      managed: isManaged,
      running,
      loginQuery: loginQuery(pw),
    });
  }
  return { ok: true, containers };
}

function freePortCandidate(used) {
  for (let p = PORT_MIN; p <= PORT_MAX; p += 1) {
    if (!used.has(p)) return p;
  }
  return null;
}

/** Lance un conteneur Neko (navigateur WebRTC) et publie son UI sur un port local. */
export async function startNeko({ name = 'kovzu-neko', screen = '1280x720@30' } = {}) {
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60) || 'kovzu-neko';
  const { containers } = await listContainers();
  const existing = containers.find((c) => c.name === safe);
  if (existing) {
    if (!existing.running) await cli(['start', safe]).catch(() => {});
    return { ok: true, name: safe, port: existing.port, reused: true };
  }
  const used = new Set(containers.map((c) => c.port).filter(Boolean));
  const port = freePortCandidate(used);
  if (!port) return { ok: false, error: 'aucun port libre (9450-9490)' };

  const pw = Math.random().toString(36).slice(2, 10);
  // NB : WebRTC via tunnel Cloudflare nécessite ICE-lite + TCP-mux (voir doc).
  const args = [
    'run', '-d', '--name', safe, '--label', `${LABEL}=1`, '--shm-size', '1g',
    '-p', `127.0.0.1:${port}:8080`,
    '-e', `NEKO_SCREEN=${screen}`,
    '-e', `NEKO_PASSWORD=${pw}`,
    '-e', `NEKO_PASSWORD_ADMIN=${pw}`,
    '-e', 'NEKO_ICELITE=true',
    NEKO_IMAGE,
  ];
  try {
    await cli(args, { timeout: 120000 });
    return {
      ok: true, name: safe, port, password: pw, image: NEKO_IMAGE,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Recrée à neuf le conteneur Neko (rm -f puis start). */
export async function rebuildNeko({ name = 'kovzu-neko' } = {}) {
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60) || 'kovzu-neko';
  await cli(['rm', '-f', safe]).catch(() => {});
  return startNeko({ name: safe });
}

export async function stopContainer(name) {
  const safe = String(name || '').trim();
  if (!safe) return { ok: false, error: 'nom requis' };
  try {
    await cli(['stop', safe]);
    return { ok: true, name: safe };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Retire un conteneur géré par KovZu (arrêt + suppression). */
export async function removeContainer(name) {
  const safe = String(name || '').trim();
  if (!safe) return { ok: false, error: 'nom requis' };
  try {
    await cli(['rm', '-f', safe]);
    return { ok: true, name: safe };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function nekoImage() {
  return NEKO_IMAGE;
}
