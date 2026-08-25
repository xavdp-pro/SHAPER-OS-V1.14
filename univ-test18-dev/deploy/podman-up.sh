#!/usr/bin/env bash
# Golden snippet — first DEV universe (local). Parameterized. No secrets in this file.
# Monorepo layout: clone SHAPER-OS-V1.7, universe sits beside software/:
#   <repo>/software/  +  <repo>/<univ_slug>-dev/
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SLUG="${UNIV_SLUG:-$(basename "$UNIV")}"
REPO_ROOT="$(cd "$UNIV/.." && pwd)"
SHAPER="${SHAPER_ROOT:-$REPO_ROOT/software}"

if [[ ! -d "$SHAPER/packages" ]]; then
  if [[ -d "$REPO_ROOT/SHAPER-OS-V1.7/software/packages" ]]; then
    SHAPER="$REPO_ROOT/SHAPER-OS-V1.7/software"
  elif [[ -d "/root/SHAPER-OS-V1.7/software/packages" ]]; then
    SHAPER="/root/SHAPER-OS-V1.7/software"
  elif [[ -d "$UNIV/software/packages" ]]; then
    SHAPER="$UNIV/software"
  else
    echo "[podman-up] software/ not found at $SHAPER" >&2
    exit 1
  fi
fi

# 1. Base defaults from software/.env or root .env
if [[ -f "$SHAPER/.env" ]]; then
  set -a; source "$SHAPER/.env"; set +a
elif [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi

# 2. Universe overrides (takes highest precedence)
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
elif [[ -f "$UNIV/.env" ]]; then
  set -a; source "$UNIV/.env"; set +a
elif [[ -f "$UNIV/deploy/env" ]]; then
  set -a; source "$UNIV/deploy/env"; set +a
elif [[ -f "$UNIV/deploy/${SLUG}.env" ]]; then
  set -a; source "$UNIV/deploy/${SLUG}.env"; set +a
fi

export VAULT_MASTER_KEY="${VAULT_MASTER_KEY:?Set VAULT_MASTER_KEY in $ENV_FILE}"
export VAULT_TOKEN="${VAULT_TOKEN:-}"
export BRIDGE_OPENCODE_STUB="${BRIDGE_OPENCODE_STUB:-0}"
export MAIL_AGENT_STUB="${MAIL_AGENT_STUB:-1}"
export VAULT_PORT="${VAULT_PORT:-8610}"
export LOGGER_PORT="${LOGGER_PORT:-8620}"
export OPENCODE_BRIDGE_PORT="${OPENCODE_BRIDGE_PORT:-4440}"
export OPENCODE_SERVE_PORT="${OPENCODE_SERVE_PORT:-4441}"
export QUEUE_PORT="${QUEUE_PORT:-8640}"
export MAESTRO_PORT="${MAESTRO_PORT:-8630}"
export HELM_PORT="${HELM_PORT:-8650}"
export OPENCODE_MODEL="${OPENCODE_MODEL:-opencode/nemotron-3.5-lightning-free}"
export DEEPGRAM_API_KEY="${DEEPGRAM_API_KEY:-}"
export GROQ_API_KEY="${GROQ_API_KEY:-}"
export WITH_HELM="${WITH_HELM:-0}"
# The queue is the universe's unit of work. Lanes are how it is sized to the
# host: one on a modest VPS, several on a real server — same image (Rule 32).
export QUEUE_CONCURRENCY="${QUEUE_CONCURRENCY:-1}"
# How fast a waiting job's patience converts into rank. See packages/queue.
export QUEUE_AGING_SECONDS="${QUEUE_AGING_SECONDS:-60}"
# Set this to route every maestro beat through the queue instead of straight to
# a bridge — one entry point, one ledger, one place that must be right.
export MAESTRO_QUEUE_URL="${MAESTRO_QUEUE_URL:-}"
# A universe may carry bridges of any kind, side by side. Nothing in the queue
# needs to know: a job names its bridge in `payload.bridgeUrl` and a pod in its
# `bridgeUrl`, so adding one is deployment, never code.
export WITH_BRIDGE_CURSOR="${WITH_BRIDGE_CURSOR:-0}"
export WITH_BRIDGE_AGY="${WITH_BRIDGE_AGY:-0}"
export CURSOR_BRIDGE_PORT="${CURSOR_BRIDGE_PORT:-4510}"
export AGY_BRIDGE_PORT="${AGY_BRIDGE_PORT:-4330}"

# Every path mounted below must exist first: podman refuses to create a missing
# bind source, and the failure only shows on a from-scratch universe — which is
# precisely why we deploy one from scratch.
mkdir -p "$SHAPER/data/vault" \
  "$UNIV/log" "$UNIV/sav" "$UNIV/state" \
  "$UNIV/sav/opencode-ws" "$UNIV/sav/opencode-bridge" "$UNIV/sav/tunnel" \
  "$UNIV/sav/queue"

if [[ ! -f "$SHAPER/data/vault/vault.enc" ]]; then
  echo "[podman-up] Bootstrapping vault..."
  (cd "$SHAPER" && npm run vault:bootstrap)
fi

TOKEN_FILE="$UNIV/sav/opencode-bridge/token"
if [[ -n "${OPENCODE_BRIDGE_TOKEN:-}" ]]; then
  echo "$OPENCODE_BRIDGE_TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  export BRIDGE_AUTH_TOKEN="$OPENCODE_BRIDGE_TOKEN"
elif [[ -n "${CLI_BRIDGE_TOKEN:-}" ]]; then
  echo "$CLI_BRIDGE_TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  export BRIDGE_AUTH_TOKEN="$CLI_BRIDGE_TOKEN"
elif [[ ! -f "$TOKEN_FILE" ]]; then
  openssl rand -hex 24 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  export BRIDGE_AUTH_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
else
  export BRIDGE_AUTH_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
fi

stop_rm() { podman rm -f "$1" 2>/dev/null || true; }

stop_rm "${SLUG}-vault"
stop_rm "${SLUG}-logger"
stop_rm "${SLUG}-bridge-opencode"
stop_rm "${SLUG}-bridge-cursor"
stop_rm "${SLUG}-bridge-agy"
stop_rm "${SLUG}-queue"
stop_rm "${SLUG}-maestro"
stop_rm "${SLUG}-helm"
stop_rm "${SLUG}-tunnel"

NET="${PODMAN_NETWORK:-host}"

echo "[podman-up] vault :$VAULT_PORT"
podman run -d --name "${SLUG}-vault" --network "$NET" --replace \
  -e VAULT_PORT="$VAULT_PORT" \
  -e VAULT_MASTER_KEY \
  -e VAULT_TOKEN \
  -e VAULT_STORAGE_FILE=/data/vault/vault.enc \
  -v "$SHAPER/data/vault:/data/vault:Z" \
  localhost/shaper-vault:latest

echo "[podman-up] logger :$LOGGER_PORT"
podman run -d --name "${SLUG}-logger" --network "$NET" --replace \
  -e LOGGER_PORT="$LOGGER_PORT" \
  -e LOG_DIR=/data/logger \
  -v "$UNIV/log:/data/logger:Z" \
  localhost/shaper-logger:latest

echo "[podman-up] bridge-opencode :$OPENCODE_BRIDGE_PORT"
podman run -d --name "${SLUG}-bridge-opencode" --network "$NET" --replace \
  -e OPENCODE_BRIDGE_PORT="$OPENCODE_BRIDGE_PORT" \
  -e OPENCODE_BRIDGE_BIND=0.0.0.0 \
  -e OPENCODE_SERVE_PORT="$OPENCODE_SERVE_PORT" \
  -e OPENCODE_BIN=/usr/local/bin/opencode \
  -e OPENCODE_WS_BASE=/data/opencode-ws \
  -e OPENCODE_MODEL \
  -e BRIDGE_OPENCODE_STUB \
  -e HOME=/root \
  -e TOKEN_FILE=/root/.config/opencode-bridge/token \
  -v "$UNIV/sav/opencode-ws:/data/opencode-ws:Z" \
  -v "$UNIV/sav/opencode-bridge:/root/.config/opencode-bridge:Z" \
  localhost/shaper-bridge-opencode:latest

echo "[podman-up] queue :$QUEUE_PORT"
podman run -d --name "${SLUG}-queue" --network "$NET" --replace \
  -e QUEUE_PORT="$QUEUE_PORT" \
  -e QUEUE_AUTO_DISPATCH=1 \
  -e QUEUE_BRIDGE_URL="http://127.0.0.1:$OPENCODE_BRIDGE_PORT" \
  -e QUEUE_BRIDGE_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e QUEUE_POLL_MS=2000 \
  -e QUEUE_CONCURRENCY \
  -e QUEUE_AGING_SECONDS \
  -e QUEUE_STORAGE_FILE="${QUEUE_STORAGE_FILE:-/sav/queue/jobs.jsonl}" \
  -e QUALITY_GATE_ENFORCE="${QUALITY_GATE_ENFORCE:-0}" \
  -v "$UNIV/sav/queue:/sav/queue:Z" \
  localhost/shaper-queue:latest

if [[ "$WITH_BRIDGE_CURSOR" == "1" ]]; then
  echo "[podman-up] bridge-cursor :$CURSOR_BRIDGE_PORT"
  # cursor-agent is a separate CLI from the IDE. Mounted read-only from the host
  # so the image carries no binary it cannot version.
  podman run -d --name "${SLUG}-bridge-cursor" --network "$NET" --replace \
    --cgroups=disabled \
    -e CURSOR_BRIDGE_PORT="$CURSOR_BRIDGE_PORT" \
    -e BRIDGE_CURSOR_STUB="${BRIDGE_CURSOR_STUB:-0}" \
    -e CURSOR_BIN=/usr/local/bin/cursor-agent \
    -e CURSOR_API_KEY="${CURSOR_API_KEY:-}" \
    -e CURSOR_MODEL="${CURSOR_MODEL:-composer-2.5}" \
    -e CURSOR_MODE="${CURSOR_MODE:-normal}" \
    ${CURSOR_AGENT_DIR:+-v "${CURSOR_AGENT_DIR}:/opt/cursor-agent:ro"} \
    ${CURSOR_AGENT_DIR:+-e CURSOR_BIN=/opt/cursor-agent/cursor-agent} \
    localhost/shaper-bridge-cursor:latest
fi

if [[ "$WITH_BRIDGE_AGY" == "1" ]]; then
  echo "[podman-up] bridge-agy :$AGY_BRIDGE_PORT"
  # BRIDGE_AGY_STUB=1 is baked into the image; it must be overridden explicitly
  # or the bridge stays simulated while answering healthy.
  podman run -d --name "${SLUG}-bridge-agy" --network "$NET" --replace \
    --cgroups=disabled \
    -e AGY_BRIDGE_PORT="$AGY_BRIDGE_PORT" \
    -e BRIDGE_AGY_STUB=0 \
    -e AGY_BIN=/usr/local/bin/agy \
    -e AGY_MODEL="${AGY_MODEL:-gemini-3.7-flash-low}" \
    ${AGY_HOST_BIN:+-v "${AGY_HOST_BIN}:/usr/local/bin/agy:ro"} \
    ${AGY_HOST_HOME:+-v "${AGY_HOST_HOME}:/root/.gemini"} \
    localhost/shaper-bridge-agy:latest
fi

TASKS_FILE="/data/univ/tasks/maestro-tasks.json"
if [[ -f "$UNIV/tasks/maestro-tasks.podman.json" ]]; then
  TASKS_FILE="/data/univ/tasks/maestro-tasks.podman.json"
fi

echo "[podman-up] maestro :$MAESTRO_PORT"
podman run -d --name "${SLUG}-maestro" --network "$NET" --replace \
  -e MAESTRO_PORT="$MAESTRO_PORT" \
  -e MAESTRO_AUTO_START=1 \
  -e MAIL_AGENT_STUB \
  -e VAULT_URL="http://127.0.0.1:$VAULT_PORT" \
  -e VAULT_TOKEN \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e MAESTRO_BRIDGE_URL="http://127.0.0.1:$OPENCODE_BRIDGE_PORT" \
  -e MAESTRO_QUEUE_URL \
  -e BRIDGE_AUTH_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e MAESTRO_TASKS_FILE="$TASKS_FILE" \
  -v "$UNIV:/data/univ:Z" \
  localhost/shaper-maestro:latest

if [[ "$WITH_HELM" == "1" ]]; then
  JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 24)}"
  echo "[podman-up] helm :$HELM_PORT"
  podman run -d --name "${SLUG}-helm" --network "$NET" --replace \
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
    -e GROQ_ACK_MODEL="${GROQ_ACK_MODEL:-groq/compound-mini}" \
    -e APP_MODE="${APP_MODE:-demo}" \
    -e JWT_SECRET="$JWT_SECRET" \
    localhost/shaper-helm:latest

  TUNNEL_TOKEN_FILE="$UNIV/sav/tunnel/token"
  if [[ -f "$TUNNEL_TOKEN_FILE" ]]; then
    TUNNEL_TOKEN="$(tr -d '\n' < "$TUNNEL_TOKEN_FILE")"
    echo "[podman-up] tunnel"
    podman run -d --name "${SLUG}-tunnel" --network "$NET" --replace \
      docker.io/cloudflare/cloudflared:latest \
      tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"
  fi
fi

sleep 3
fail=0
check() {
  if curl -sf "$1" >/dev/null; then
    echo "  OK  $2"
  else
    echo "  FAIL $2"
    fail=1
  fi
}
echo "[podman-up] health:"
check "http://127.0.0.1:$VAULT_PORT/api/health" vault
check "http://127.0.0.1:$LOGGER_PORT/api/health" logger
check "http://127.0.0.1:$OPENCODE_BRIDGE_PORT/api/health" bridge
check "http://127.0.0.1:$QUEUE_PORT/api/health" queue
check "http://127.0.0.1:$MAESTRO_PORT/api/health" maestro
if [[ "$WITH_HELM" == "1" ]]; then
  check "http://127.0.0.1:$HELM_PORT/api/health" helm
fi
exit "$fail"
