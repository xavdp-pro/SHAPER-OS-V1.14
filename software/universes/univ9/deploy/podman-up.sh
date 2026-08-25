#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIV9="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -d "$UNIV9/../SHAPER-OS" ]]; then
  SHAPER="$(cd "$UNIV9/../SHAPER-OS" && pwd)"
else
  SHAPER="$(cd "$UNIV9/../.." && pwd)"
fi
NET="host"

ENV_FILE="${UNIV9_ENV_FILE:-$UNIV9/deploy/univ9.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$SHAPER/.env"
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

export VAULT_MASTER_KEY="${VAULT_MASTER_KEY:?Set VAULT_MASTER_KEY in .env}"
export VAULT_TOKEN="${VAULT_TOKEN:-}"
export VAULT_PORT="${VAULT_PORT:-8610}"
export LOGGER_PORT="${LOGGER_PORT:-8620}"
export OPENCODE_BRIDGE_PORT="${OPENCODE_BRIDGE_PORT:-4440}"
export OPENCODE_SERVE_PORT="${OPENCODE_SERVE_PORT:-4441}"
export QUEUE_PORT="${QUEUE_PORT:-8640}"
export MAESTRO_PORT="${MAESTRO_PORT:-8630}"
export HELM_PORT="${HELM_PORT:-8650}"
export GED_PORT="${GED_PORT:-8660}"
export DEEPGRAM_API_KEY="${DEEPGRAM_API_KEY:-}"
export GROQ_API_KEY="${GROQ_API_KEY:-}"

mkdir -p "$SHAPER/data/vault" "$UNIV9/log" "$UNIV9/sav" "$UNIV9/state" "$UNIV9/sav/opencode-ws" "$UNIV9/sav/opencode-bridge" "$UNIV9/sav/tunnel" "$UNIV9/sav/mariadb"

if [[ ! -f "$SHAPER/data/vault/vault.enc" ]]; then
  echo "[podman-up] Bootstrapping vault..."
  (cd "$SHAPER" && npm run vault:bootstrap)
fi

echo "[podman-up] 1. Démarrage de univ9-vault sur :$VAULT_PORT..."
podman run -d --name univ9-vault --network "$NET" --replace \
  -e VAULT_PORT="$VAULT_PORT" \
  -e VAULT_STORAGE_FILE=/data/vault/vault.enc \
  -e VAULT_MASTER_KEY="$VAULT_MASTER_KEY" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  -v "$SHAPER/data/vault:/data/vault:rw,z" \
  localhost/shaper-vault:latest

echo "[podman-up] 2. Démarrage de univ9-logger sur :$LOGGER_PORT..."
podman run -d --name univ9-logger --network "$NET" --replace \
  -e LOGGER_PORT="$LOGGER_PORT" \
  -e LOG_DIR=/data/logger \
  -v "$UNIV9/log:/data/logger:rw,z" \
  localhost/shaper-logger:latest

echo "[podman-up] 3. Démarrage de univ9-bridge-opencode sur :$OPENCODE_BRIDGE_PORT..."
BRIDGE_AUTH_TOKEN="opencode-bridge-token-univ9"
echo -n "$BRIDGE_AUTH_TOKEN" > "$UNIV9/sav/opencode-bridge/token"

podman run -d --name univ9-bridge-opencode --network "$NET" --replace \
  -e OPENCODE_BRIDGE_PORT="$OPENCODE_BRIDGE_PORT" \
  -e OPENCODE_BRIDGE_BIND=0.0.0.0 \
  -e OPENCODE_SERVE_PORT="$OPENCODE_SERVE_PORT" \
  -e OPENCODE_BIN=/usr/local/bin/opencode \
  -e OPENCODE_WS_BASE=/data/opencode-ws \
  -e OPENCODE_MODEL \
  -e BRIDGE_OPENCODE_STUB \
  -e OPENCODE_BRIDGE_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e HOME=/root \
  -e TOKEN_FILE=/root/.config/opencode-bridge/token \
  -e GROQ_API_KEY \
  -e DEEPSEEK_API_KEY \
  -e ANTHROPIC_API_KEY \
  -e OPENAI_API_KEY \
  -e GEMINI_API_KEY \
  -v "$UNIV9/sav/opencode-ws:/data/opencode-ws:Z" \
  -v "$UNIV9/sav/opencode-bridge:/root/.config/opencode-bridge:Z" \
  localhost/shaper-bridge-opencode:latest

echo "[podman-up] 4. Démarrage de univ9-queue sur :$QUEUE_PORT..."
podman run -d --name univ9-queue --network "$NET" --replace \
  -e QUEUE_PORT="$QUEUE_PORT" \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -v "$UNIV9/state:/data/queue:rw,z" \
  localhost/shaper-queue:latest

echo "[podman-up] 5. Démarrage de univ9-maestro sur :$MAESTRO_PORT..."
podman run -d --name univ9-maestro --network "$NET" --replace \
  -e MAESTRO_PORT="$MAESTRO_PORT" \
  -e MAESTRO_TASKS_FILE=/data/maestro/tasks.json \
  -e VAULT_URL="http://127.0.0.1:$VAULT_PORT" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e QUEUE_URL="http://127.0.0.1:$QUEUE_PORT" \
  -e BRIDGE_OPENCODE_URL="http://127.0.0.1:$OPENCODE_BRIDGE_PORT" \
  -v "$UNIV9/tasks/maestro-tasks.podman.json:/data/maestro/tasks.json:ro,z" \
  -v "$UNIV9/state:/data/maestro/state:rw,z" \
  localhost/shaper-maestro:latest

echo "[podman-up] 6. Démarrage de univ9-helm (Mode DEV avec Vite HMR & MariaDB embarqué) sur :$HELM_PORT..."
podman run -d --name univ9-helm --network "$NET" --replace \
  -e PORT="$HELM_PORT" \
  -e HOST="0.0.0.0" \
  -e NODE_ENV="development" \
  -e VITE_DEV="true" \
  -e CLI_BRIDGE_NAME=opencode \
  -e CLI_BRIDGE_URL="http://127.0.0.1:$OPENCODE_BRIDGE_PORT" \
  -e CLI_BRIDGE_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e DEFAULT_AGENT_PLUGIN=opencode \
  -e AGENT_PLUGINS="opencode|http://127.0.0.1:$OPENCODE_BRIDGE_PORT|$BRIDGE_AUTH_TOKEN" \
  -e DEEPGRAM_API_KEY="$DEEPGRAM_API_KEY" \
  -e GROQ_API_KEY="$GROQ_API_KEY" \
  -e GROQ_ACK_LLM=1 \
  -e GROQ_ACK_MODEL="groq/compound-mini" \
  -e JWT_SECRET="univ9-jwt-secret-helm-shaper" \
  -v "$SHAPER/bricks/brick-helm/app/server:/app/server:ro,z" \
  -v "$SHAPER/bricks/brick-helm/app/src:/app/src:ro,z" \
  -v "$SHAPER/bricks/brick-helm/app/public:/app/public:ro,z" \
  -v "$SHAPER/bricks/brick-helm/app/index.html:/app/index.html:ro,z" \
  -v "$SHAPER/bricks/brick-helm/app/vite.config.js:/app/vite.config.js:ro,z" \
  -v "$UNIV9/sav/mariadb:/data/mariadb:rw,z" \
  -v "$UNIV9/sav/opencode-ws:/data/opencode-ws:rw,z" \
  -v "$UNIV9/sav/opencode-ws:/data/workspaces:rw,z" \
  -v "$SHAPER/data/ged:/data/ged:rw,z" \
  -v "$SHAPER/topology.json:/data/topology.json:ro,z" \
  localhost/shaper-helm:latest

echo "[podman-up] 7. Démarrage de univ9-ged (Mini-GED Document Hub) sur :$GED_PORT..."
mkdir -p "$SHAPER/data/ged"
podman run -d --name univ9-ged --network "$NET" --replace \
  -e GED_PORT="$GED_PORT" \
  -e GED_DATA_DIR=/data/ged \
  -v "$SHAPER/packages/ged-engine:/app:ro,z" \
  -v "$SHAPER/data/ged:/data/ged:rw,z" \
  localhost/shaper-ged:latest

TUNNEL_TOKEN_FILE="$UNIV9/sav/tunnel/token"
if [[ -f "$TUNNEL_TOKEN_FILE" ]]; then
  TUNNEL_TOKEN="$(tr -d '\n' < "$TUNNEL_TOKEN_FILE")"
  echo "[podman-up] 8. Démarrage de univ9-tunnel (Cloudflare Tunnel ${SHAPER_PUBLIC_HOST})..."
  podman run -d --name univ9-tunnel --network "$NET" --replace \
    docker.io/cloudflare/cloudflared:latest \
    tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"
fi

podman ps --format "table {{.ID}}  {{.Image}}  {{.Command}}  {{.Created}}  {{.Status}}  {{.Ports}}  {{.Names}}"

sleep 3
echo ""
echo "[podman-up] Vérification de la santé des briques :"
curl -s "http://127.0.0.1:$VAULT_PORT/health" || echo "vault DOWN"
echo " vault OK"
curl -s "http://127.0.0.1:$LOGGER_PORT/health" || echo "logger DOWN"
echo " logger OK"
curl -s "http://127.0.0.1:$OPENCODE_BRIDGE_PORT/api/health" || echo "bridge DOWN"
echo " bridge OK"
curl -s "http://127.0.0.1:$QUEUE_PORT/health" || echo "queue DOWN"
echo " queue OK"
curl -s "http://127.0.0.1:$MAESTRO_PORT/health" || echo "maestro DOWN"
echo " maestro OK"
curl -s "http://127.0.0.1:$HELM_PORT/api/health" || echo "helm DOWN"
echo " helm OK"
curl -s "http://127.0.0.1:$GED_PORT/health" || echo "ged DOWN"
echo " ged OK"
