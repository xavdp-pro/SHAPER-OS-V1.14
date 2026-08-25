#!/usr/bin/env node
/**
 * @file client-delivery.mjs
 * @description Production client universe delivery generator for Shaper OS.
 * Prepares a duplicated, sovereign client instance with its dedicated Git repo,
 * local backups, and DRP replication key.
 *
 * Usage:
 *   node scripts/client-delivery.mjs create --slug <slug> --client "<Client Name>" --domain "<domain>" [--git-remote <url>]
 *
 * Example:
 *   node scripts/client-delivery.mjs create --slug dupont --client "Cabinet Dupont" --domain "ia.example.com" --git-remote "git@github.com:dupont/shaper-os.git"
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * A client domain is never derived from a slug: inventing `ia.<slug>.fr` hands the
 * operator a name they do not own. Ask for it, and halt until it is given.
 */
function requiredDomain(domain, slug) {
  if (domain && String(domain).trim()) return String(domain).trim();
  throw new Error(
    `No --domain given for client "${slug}". This repository invents no domain: `
    + 'ask the human operator for a public name inside a zone they already manage '
    + 'in Cloudflare, then pass it with --domain.',
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function parseArgs(args) {
  const parsed = {
    command: args[0] || 'help',
    slug: '',
    client: '',
    domain: '',
    gitRemote: '',
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--slug' && args[i + 1]) parsed.slug = args[++i].toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (args[i] === '--client' && args[i + 1]) parsed.client = args[++i];
    if (args[i] === '--domain' && args[i + 1]) parsed.domain = args[++i];
    if (args[i] === '--git-remote' && args[i + 1]) parsed.gitRemote = args[++i];
  }

  return parsed;
}

function deliverClientUniverse(options) {
  const { slug, client, domain, gitRemote } = options;
  if (!slug || !client) {
    console.error('❌ Error: --slug and --client parameters are required.');
    process.exit(1);
  }

  const univDir = path.join(ROOT_DIR, `universes/univ-${slug}`);
  const deployDir = path.join(univDir, 'deploy');
  const contextDir = path.join(univDir, 'context');
  const logDir = path.join(univDir, 'log');
  const savDir = path.join(univDir, 'sav');

  console.log(`\n🚀 [Client Delivery Engine] Preparing client instance: ${client} (${slug})...`);

  fs.mkdirSync(deployDir, { recursive: true });
  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(savDir, { recursive: true });

  const vaultToken = `vault-token-${slug}-${crypto.randomBytes(8).toString('hex')}`;
  const jwtSecret = `jwt-secret-${slug}-${crypto.randomBytes(12).toString('hex')}`;
  const masterKey = `shaper-${slug}-master-${crypto.randomBytes(16).toString('hex')}`;

  // 1. Client Environment file
  const envContent = `# Shaper OS production configuration for ${client}
CLIENT_NAME="${client}"
CLIENT_SLUG="${slug}"
DOMAIN="${requiredDomain(domain, slug)}"
VAULT_MASTER_KEY="${masterKey}"
VAULT_TOKEN="${vaultToken}"
JWT_SECRET="${jwtSecret}"
GIT_REMOTE="${gitRemote || ''}"
PRA_DEST_HOST="${process.env.PRA_DEST_HOST || ''}"   # set by the operator: destination host for PRA backups
`;
  fs.writeFileSync(path.join(deployDir, `${slug}.env`), envContent);

  // 2. Client Manifest
  const manifest = {
    universe: `univ-${slug}`,
    clientName: client,
    domain: domain || `ia.${slug}.fr`,
    createdAt: new Date().toISOString(),
    version: '1.0.0',
    gitRemote: gitRemote || 'local-repo',
    services: {
      vault: { port: 8610 },
      logger: { port: 8620 },
      queue: { port: 8640 },
      maestro: { port: 8630 },
      helm: { port: 8650 },
      ged: { port: 8660 },
    },
    backup: {
      schedule: '0 2 * * *',
      retentionDays: 7,
      praSync: true,
    }
  };
  fs.writeFileSync(path.join(univDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  // 3. Client Context
  fs.writeFileSync(path.join(contextDir, 'briefing.md'), `# Company Briefing — ${client}

Welcome to the Shaper OS universe dedicated to **${client}**.
All administrative, document, and software operations run sovereignly on this instance.
`);

  console.log(`✅ [Client Delivery Engine] Client universe generated successfully!`);
  console.log(`   📁 Directory : universes/univ-${slug}`);
  console.log(`   ⚙️ Config    : universes/univ-${slug}/deploy/${slug}.env`);
  console.log(`   📄 Manifest  : universes/univ-${slug}/manifest.json`);
  if (gitRemote) {
    console.log(`   📦 Git Repo  : ${gitRemote}`);
  }
  console.log(`\nTo initialize and start the client universe:`);
  console.log(`   export UNIV9_ENV_FILE=universes/univ-${slug}/deploy/${slug}.env`);
  console.log(`   bash universes/univ9/deploy/podman-up.sh\n`);
}

const args = process.argv.slice(2);
const parsed = parseArgs(args);

if (parsed.command === 'create') {
  deliverClientUniverse(parsed);
} else {
  console.log(`
Shaper OS — Client Delivery CLI
Usage:
  node scripts/client-delivery.mjs create --slug <slug> --client "<Client Name>" --domain "<domain>" [--git-remote <url>]
`);
}
