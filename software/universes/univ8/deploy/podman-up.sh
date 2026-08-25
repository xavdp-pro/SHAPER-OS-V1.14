#!/usr/bin/env bash
# univ8 — start full Podman stack with OpenCode bridge (host network).
set -euo pipefail

UNIV8="$(cd "$(dirname "$0")/.." && pwd)"
SHAPER="$(cd "$UNIV8/../SHAPER-OS" && pwd)"

if [[ ! -d "$SHAPER/packages" ]]; then
  echo "[podman-up] SHAPER-OS not found at $SHAPER"
  exit 1
fi

ENV_FILE="${ENV_FILE:-$SHAPER/.env}"
_override_bridge=0
_override_mail=0
[[ -n "${BRIDGE_OPENCODE_STUB+x}" ]] && _override_bridge=1 && _saved_bridge="$BRIDGE_OPENCODE_STUB"
[[ -n "${MAIL_AGENT_STUB+x}" ]] && _override_mail=1 && _saved_mail="$MAIL_AGENT_STUB"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
[[ $_override_bridge -eq 1 ]] && export BRIDGE_OPENCODE_STUB="$_saved_bridge"
[[ $_override_mail -eq 1 ]] && export MAIL_AGENT_STUB="$_saved_mail"

export VAULT_MASTER_KEY="${VAULT_MASTER_KEY:?Set VAULT_MASTER_KEY in $SHAPER/.env}"
export VAULT_TOKEN="${VAULT_TOKEN:-}"
export BRIDGE_OPENCODE_STUB="${BRIDGE_OPENCODE_STUB:-1}"
export MAIL_AGENT_STUB="${MAIL_AGENT_STUB:-1}"
export VAULT_PORT="${VAULT_PORT:-8610}"
export LOGGER_PORT="${LOGGER_PORT:-8620}"
export OPENCODE_BRIDGE_PORT="${OPENCODE_BRIDGE_PORT:-4440}"
export OPENCODE_SERVE_PORT="${OPENCODE_SERVE_PORT:-4441}"
export QUEUE_PORT="${QUEUE_PORT:-8640}"
export MAESTRO_PORT="${MAESTRO_PORT:-8630}"
export HELM_PORT="${HELM_PORT:-8650}"
export DEEPGRAM_API_KEY="${DEEPGRAM_API_KEY:-}"
export GROQ_API_KEY="${GROQ_API_KEY:-}"
export CARTESIA_API_KEY="${CARTESIA_API_KEY:-}"
export ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:-}"
export OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"

mkdir -p "$SHAPER/data/vault" "$UNIV8/log" "$UNIV8/sav" "$UNIV8/state" "$UNIV8/sav/opencode-ws" "$UNIV8/sav/opencode-bridge" "$UNIV8/sav/tunnel"

if [[ ! -f "$SHAPER/data/vault/vault.enc" ]]; then
  echo "[podman-up] Bootstrapping vault..."
  (cd "$SHAPER" && npm run vault:bootstrap)
fi

TOKEN_FILE="$UNIV8/sav/opencode-bridge/token"
if [[ ! -f "$TOKEN_FILE" ]]; then
  openssl rand -hex 24 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "[podman-up] Generated bridge auth token in $TOKEN_FILE"
fi
export BRIDGE_AUTH_TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"

stop_rm() {
  podman rm -f "$1" 2>/dev/null || true
}

stop_rm univ8-vault
stop_rm univ8-logger
stop_rm univ8-bridge-opencode
stop_rm univ8-queue
stop_rm univ8-maestro
stop_rm univ8-helm
stop_rm univ8-tunnel

NET="${PODMAN_NETWORK:-host}"

echo "[podman-up] 1. Starting univ8-vault on :$VAULT_PORT..."
podman run -d --name univ8-vault --network "$NET" --replace \
  -e VAULT_PORT="$VAULT_PORT" \
  -e VAULT_MASTER_KEY \
  -e VAULT_TOKEN \
  -e VAULT_STORAGE_FILE=/data/vault/vault.enc \
  -v "$SHAPER/data/vault:/data/vault:Z" \
  localhost/shaper-vault:latest

echo "[podman-up] 2. Starting univ8-logger on :$LOGGER_PORT..."
podman run -d --name univ8-logger --network "$NET" --replace \
  -e LOGGER_PORT="$LOGGER_PORT" \
  -e LOG_DIR=/data/logger \
  -v "$UNIV8/log:/data/logger:Z" \
  localhost/shaper-logger:latest

echo "[podman-up] 3. Starting univ8-bridge-opencode on :$OPENCODE_BRIDGE_PORT (OpenCode inside image)..."
export OPENCODE_MODEL="${OPENCODE_MODEL:-opencode/nemotron-3.5-lightning-free}"
podman run -d --name univ8-bridge-opencode --network "$NET" --replace \
  -e OPENCODE_BRIDGE_PORT="$OPENCODE_BRIDGE_PORT" \
  -e OPENCODE_BRIDGE_BIND=0.0.0.0 \
  -e OPENCODE_SERVE_PORT="$OPENCODE_SERVE_PORT" \
  -e OPENCODE_BIN=/usr/local/bin/opencode \
  -e OPENCODE_WS_BASE=/data/opencode-ws \
  -e OPENCODE_MODEL \
  -e BRIDGE_OPENCODE_STUB \
  -e HOME=/root \
  -e TOKEN_FILE=/root/.config/opencode-bridge/token \
  -v "$UNIV8/sav/opencode-ws:/data/opencode-ws:Z" \
  -v "$UNIV8/sav/opencode-bridge:/root/.config/opencode-bridge:Z" \
  localhost/shaper-bridge-opencode:latest

echo "[podman-up] 4. Starting univ8-queue on :$QUEUE_PORT..."
podman run -d --name univ8-queue --network "$NET" --replace \
  -e QUEUE_PORT="$QUEUE_PORT" \
  -e QUEUE_AUTO_DISPATCH=1 \
  -e QUEUE_BRIDGE_URL="http://127.0.0.1:$OPENCODE_BRIDGE_PORT" \
  -e QUEUE_BRIDGE_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e QUEUE_POLL_MS=2000 \
  localhost/shaper-queue:latest

echo "[podman-up] 5. Starting univ8-maestro on :$MAESTRO_PORT..."
podman run -d --name univ8-maestro --network "$NET" --replace \
  -e MAESTRO_PORT="$MAESTRO_PORT" \
  -e MAESTRO_AUTO_START=1 \
  -e MAIL_AGENT_STUB \
  -e VAULT_URL="http://127.0.0.1:$VAULT_PORT" \
  -e VAULT_TOKEN \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e MAESTRO_BRIDGE_URL="http://127.0.0.1:$OPENCODE_BRIDGE_PORT" \
  -e BRIDGE_AUTH_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e MAESTRO_TASKS_FILE=/data/univ8/tasks/maestro-tasks.podman.json \
  -e UNIV8_CHECKPOINT=/data/univ8/state/checkpoint.json \
  -v "$UNIV8:/data/univ8:Z" \
  localhost/shaper-maestro:latest

echo "[podman-up] 6. Starting univ8-helm on :$HELM_PORT (Web Chat + Deepgram STT)..."
podman run -d --name univ8-helm --network "$NET" --replace \
  -e PORT="$HELM_PORT" \
  -e HOST="0.0.0.0" \
  -e CLI_BRIDGE_NAME=opencode \
  -e CLI_BRIDGE_URL="http://127.0.0.1:$OPENCODE_BRIDGE_PORT" \
  -e CLI_BRIDGE_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e DEFAULT_AGENT_PLUGIN=opencode \
  -e AGENT_PLUGINS="opencode|http://127.0.0.1:$OPENCODE_BRIDGE_PORT|$BRIDGE_AUTH_TOKEN" \
  -e DEEPGRAM_API_KEY="$DEEPGRAM_API_KEY" \
  -e GROQ_API_KEY="$GROQ_API_KEY" \
  -e GROQ_ACK_LLM=1 \
  -e GROQ_ACK_MODEL="groq/compound-mini" \
  -e CARTESIA_API_KEY="$CARTESIA_API_KEY" \
  -e ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" \
  -e OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  -e APP_MODE=demo \
  -e JWT_SECRET="univ8-jwt-secret-helm-chat" \
  localhost/shaper-helm:latest

TUNNEL_TOKEN_FILE="$UNIV8/sav/tunnel/token"
if [[ -f "$TUNNEL_TOKEN_FILE" ]]; then
  TUNNEL_TOKEN="$(tr -d '\n' < "$TUNNEL_TOKEN_FILE")"
  echo "[podman-up] 7. Starting univ8-tunnel (Cloudflare Tunnel ${SHAPER_PUBLIC_HOST})..."
  podman run -d --name univ8-tunnel --network "$NET" --replace \
    docker.io/cloudflare/cloudflared:latest \
    tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"
fi

sleep 3
podman ps --filter "name=univ8-"

echo ""
echo "[podman-up] Health checks:"
curl -sf "http://127.0.0.1:$VAULT_PORT/api/health" && echo " vault OK" || echo " vault FAIL"
curl -sf "http://127.0.0.1:$LOGGER_PORT/api/health" && echo " logger OK" || echo " logger FAIL"
curl -sf "http://127.0.0.1:$OPENCODE_BRIDGE_PORT/api/health" && echo " opencode bridge OK" || echo " opencode bridge FAIL"
curl -sf -H "Authorization: Bearer $BRIDGE_AUTH_TOKEN" "http://127.0.0.1:$OPENCODE_BRIDGE_PORT/api/status" && echo " opencode status OK" || echo " opencode status FAIL"
curl -sf "http://127.0.0.1:$QUEUE_PORT/api/health" && echo " queue OK" || echo " queue FAIL"
curl -sf "http://127.0.0.1:$MAESTRO_PORT/api/health" && echo " maestro OK" || echo " maestro FAIL"
curl -sf "http://127.0.0.1:$HELM_PORT/api/health" && echo " helm chat OK" || echo " helm chat FAIL"
