/**
 * Repository-wide guard: SHAPER OS ships no deployment domain.
 *
 * A public name belongs to an operator, not to this repository. It is supplied
 * at deploy time — asked from the human, and already managed in Cloudflare —
 * never committed. This test fails if a hostname that is neither a vendor
 * endpoint, a reserved placeholder, nor a loopback address appears in code or
 * configuration.
 *
 * Rule 0B (zero hardcoding) · Rule 29 (every fixed defect ships its test).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: INTENT.md

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const SCANNED_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.json', '.sh', '.example',
  // .jsonl was missing until a committed runtime log was found still carrying a
  // real mailbox after every source file had been sanitised. A log is a file.
  '.jsonl', '.log', '.txt', '.yml', '.yaml', '.conf', '.ini', '.toml',
]);
const SKIPPED_DIRS = new Set([
  '.git', 'node_modules', 'sav', 'dist', 'build', '.vite', 'coverage', 'log', 'data',
  '.extract-cache', '.cache', 'tmp',
  // Ground truth for OCR: these files must stay byte-identical to the images they
  // describe, so their (deliberately fictional) content is data, not configuration.
]);
const SKIPPED_FILES = new Set(['package-lock.json']);

/** Hosts that are legitimately fixed: vendor endpoints, reserved names, branding. */
const ALLOWED_HOSTS = new Set([
  // package and source registries
  'registry.npmjs.org', 'npmjs.com', 'www.npmjs.com', 'github.com',
  'raw.githubusercontent.com', 'objects.githubusercontent.com', 'nodejs.org',
  'docker.io', 'registry.hub.docker.com', 'ghcr.io', 'quay.io',
  // AI and infrastructure vendors
  'opencode.ai', 'claude.ai', 'api.anthropic.com', 'ollama.com', 'openrouter.ai',
  'api.deepseek.com', 'api.groq.com', 'console.groq.com',
  'api.deepgram.com', 'console.deepgram.com', 'developers.deepgram.com',
  'play.cartesia.ai', 'api.cartesia.ai', 'docs.cartesia.ai',
  'elevenlabs.io', 'api.elevenlabs.io', 'api.openai.com', 'api.hume.ai',
  'in-v3.mailjet.com', 'ssl0.ovh.net', 'cdn.tailwindcss.com',
  'api.cloudflare.com', 'one.dash.cloudflare.com', 'dash.cloudflare.com',
  // schemas and open-source funding boilerplate
  'json-schema.org', 'schema.org', 'schemas.openxmlformats.org',
  'opencollective.com', 'tidelift.com', 'feross.org', 'www.patreon.com',
  // author identity and public showcase (branding, not infrastructure)
  'xavdp.pro', 'shaper.xavdp.pro', 'www.linkedin.com', 'x.com',
  // loopback and unspecified
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
]);

/** Reserved suffixes that can never be a real deployment (RFC 2606 / 6761). */
const RESERVED_SUFFIXES = ['.invalid', '.test', '.example', '.localhost', '.local'];
const PLACEHOLDER_SUFFIXES = ['.domain.com', 'domain.com', 'example.com', 'example.org', 'example.net'];

const URL_HOST = /https?:\/\/([A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9])/g;
const EMAIL_HOST = /[A-Za-z0-9._%+-]+@([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,})/g;
const QUOTED_HOST = /["'](\.?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)["']/g;
const PUBLIC_TLD = /\.(fr|com|pro|net|org|io|dev|ai|app|eu|be|ch|co|uk|de|es|it|cloud|tech|info|shop|store)$/;

function isAllowed(host) {
  const h = host.replace(/^\./, '').toLowerCase();
  if (ALLOWED_HOSTS.has(h)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;               // any IP literal
  if (RESERVED_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (PLACEHOLDER_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (!PUBLIC_TLD.test(h)) return true;                              // not a real public name
  return false;
}

/**
 * Only tracked files are scanned. The invariant is about what is *committed*, and
 * scanning the live tree would also read the temporary files other suites write
 * while they run — which made this test flake.
 */
function trackedFiles() {
  const out = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean).filter((rel) => {
    const parts = rel.split('/');
    if (parts.some((p) => SKIPPED_DIRS.has(p))) return false;
    const base = parts[parts.length - 1];
    if (SKIPPED_FILES.has(base)) return false;
    return SCANNED_EXTENSIONS.has(path.extname(base)) || base.startsWith('.env');
  }).map((rel) => path.join(REPO, rel))
    // A file git still lists but that is already gone from disk is a normal
    // transient state mid-refactor. The guard must report leaks, not crash on it.
    .filter((abs) => fs.existsSync(abs));
}

describe('domain agnosticism', () => {
  it('commits no deployment hostname in code or configuration', () => {
    const violations = [];
    for (const file of trackedFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        for (const re of [URL_HOST, QUOTED_HOST, EMAIL_HOST]) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(line)) !== null) {
            const host = m[1];
            if (!isAllowed(host)) {
              violations.push(`${path.relative(REPO, file)}:${i + 1}  ${host}`);
            }
          }
        }
      });
    }
    assert.deepEqual(
      violations,
      [],
      `An operator-specific host or address is committed in this repository. `
      + `Another person must be able to deploy this under their own domain and `
      + `accounts by changing environment values only:\n  `
      + `${violations.join('\n  ')}\n`,
    );
  });
});
