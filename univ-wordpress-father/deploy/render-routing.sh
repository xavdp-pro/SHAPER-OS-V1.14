#!/usr/bin/env bash
# Render routing.json from WP_* env vars (convention: ${WP_SITE_HOST}).
set -euo pipefail
UNIV="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$UNIV/.." && pwd)"
REMOTE_ENV="${SHAPER_REMOTE_ENV:-$(cd "$REPO_ROOT/.." && pwd)/.env}"
ENV_FILE="${1:-$UNIV/deploy/env}"

if [[ -f "$REMOTE_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$REMOTE_ENV"
  set +a
fi
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${WP_ZONE:?not set — ask the human operator for the DNS zone (it must already be managed in Cloudflare); this repository ships no domain}"
export WP_ZONE
export WP_MANAGER_SLUG="${WP_MANAGER_SLUG:-wpmanager01}"
export WP_SITE_SLUG="${WP_SITE_SLUG:-wp01}"
export WP_MANAGER_PORT="${WP_MANAGER_PORT:-9470}"
export WP_PORT="${WP_PORT:-9580}"
export WP_CHILD_NAME="${WP_CHILD_NAME:-univ-wordpress-child}"

cd "$REPO_ROOT"
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { routingFromEnv } from './software/packages/wp-dns-convention/index.js';
const out = routingFromEnv(process.env);
writeFileSync('univ-wordpress-father/routing.json', JSON.stringify(out, null, 2) + '\n');
console.log('[render-routing]', out.managerHostname, '→', out.sites.map((s) => s.hostname).join(', '));
"
