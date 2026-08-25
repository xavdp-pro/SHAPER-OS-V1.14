#!/usr/bin/env bash
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SLUG="univ-wordpress-father"
REPO_ROOT="$(cd "$UNIV/.." && pwd)"
SHAPER="${SHAPER_ROOT:-$REPO_ROOT/software}"
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
export VAULT_PORT="9410"
export LOGGER_PORT="9420"
export MAESTRO_PORT="9430"
export QUEUE_PORT="9440"
export SUPERVISOR_PORT="9460"
export VAULT_MASTER_KEY="${VAULT_MASTER_KEY:-shaper-wp-father-master-key!!}"
export VAULT_TOKEN="${VAULT_TOKEN:-shaper-wp-father-token}"

bash "$UNIV/deploy/render-routing.sh" "$ENV_FILE"

mkdir -p "$UNIV/log" "$UNIV/sav/queue" "$UNIV/sav/ssh" "$UNIV/data/vault" "$UNIV/tasks"

if [[ ! -f "$UNIV/sav/ssh/id_ed25519" ]]; then
  ssh-keygen -t ed25519 -f "$UNIV/sav/ssh/id_ed25519" -N "" -C "univ-wordpress-father-authority"
fi

echo "[father-up] Deploying $SLUG (manager: ${WP_MANAGER_SLUG}.${WP_ZONE})..."

podman run -d --name "${SLUG}-vault" --network host --replace --cgroups=disabled \
  -e PORT="$VAULT_PORT" \
  -e VAULT_MASTER_KEY="$VAULT_MASTER_KEY" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  -v "$UNIV/data/vault:/data/vault:Z" \
  localhost/shaper-vault:latest

podman run -d --name "${SLUG}-logger" --network host --replace --cgroups=disabled \
  -e PORT="$LOGGER_PORT" \
  -e LOG_DIR="/data/univ/log" \
  -v "$UNIV:/data/univ:Z" \
  localhost/shaper-logger:latest

podman run -d --name "${SLUG}-queue" --network host --replace --cgroups=disabled \
  -e QUEUE_PORT="$QUEUE_PORT" \
  -e QUEUE_AUTO_DISPATCH=0 \
  -e QUEUE_STORAGE_FILE="/sav/queue/jobs.jsonl" \
  -v "$UNIV/sav/queue:/sav/queue:Z" \
  localhost/shaper-queue:latest

podman run -d --name "${SLUG}-maestro" --network host --replace --cgroups=disabled \
  -e MAESTRO_PORT="$MAESTRO_PORT" \
  -e MAESTRO_AUTO_START=1 \
  -e MAIL_AGENT_STUB=1 \
  -e VAULT_URL="http://127.0.0.1:$VAULT_PORT" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e MAESTRO_TASKS_FILE="/data/univ/tasks/maestro-tasks.json" \
  -v "$UNIV:/data/univ:Z" \
  localhost/shaper-maestro:latest

CHILDREN_CONFIG="$UNIV/children.json" \
LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
SUPERVISOR_PORT="$SUPERVISOR_PORT" \
  node "$SHAPER/packages/supervisor/server.js" &
echo $! > "$UNIV/supervisor.pid"

SUPERVISOR_URL="http://127.0.0.1:$SUPERVISOR_PORT" \
WP_MANAGER_PORT="$WP_MANAGER_PORT" \
WP_ROUTING_FILE="$UNIV/routing.json" \
  node "$UNIV/lib/manager-gateway.mjs" &
echo $! > "$UNIV/manager-gateway.pid"

if [[ -n "${CLOUDFLARE_WP_TUNNEL_TOKEN:-}" ]]; then
  echo "[father-up] Cloudflare tunnel (manager + sites via Zero Trust ingress)"
  podman run -d --name "${SLUG}-cloudflared" --network host --replace --cgroups=disabled \
    docker.io/cloudflare/cloudflared:latest \
    tunnel --no-autoupdate run --token "$CLOUDFLARE_WP_TUNNEL_TOKEN"
fi

sleep 2
MANAGER_HOST="${WP_MANAGER_SLUG}.${WP_ZONE}"
SITE_HOST="${WP_SITE_SLUG}.${WP_MANAGER_SLUG}.${WP_ZONE}"
echo "[father-up] Manager UI  http://127.0.0.1:${WP_MANAGER_PORT}  → https://${MANAGER_HOST}"
echo "[father-up] Supervisor   http://127.0.0.1:${SUPERVISOR_PORT}"
echo "[father-up] Site target  http://127.0.0.1:9580  → https://${SITE_HOST}"
echo "[father-up] SSH authority: $UNIV/sav/ssh/id_ed25519.pub"
