#!/usr/bin/env bash
# Deploy script for univ-agy-dev (Antigravity & Shaper Dev Universe)
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SLUG="${UNIV_SLUG:-$(basename "$UNIV")}"
REPO_ROOT="$(cd "$UNIV/.." && pwd)"
SHAPER="${SHAPER_ROOT:-$REPO_ROOT/software}"

if [[ ! -d "$SHAPER/packages" ]]; then
  if [[ -d "$REPO_ROOT/SHAPER-OS-V1.7/software/packages" ]]; then
    SHAPER="$REPO_ROOT/SHAPER-OS-V1.7/software"
  fi
fi

# Load env
if [[ -f "$UNIV/deploy/env" ]]; then
  set -a; source "$UNIV/deploy/env"; set +a
elif [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi

export VAULT_MASTER_KEY="${VAULT_MASTER_KEY:-shaper-agy-local-master-key!!}"
export VAULT_TOKEN="${VAULT_TOKEN:-shaper-agy-vault-token-local}"
export VAULT_PORT="${VAULT_PORT:-8810}"
export LOGGER_PORT="${LOGGER_PORT:-8820}"
export AGY_BRIDGE_PORT="${AGY_BRIDGE_PORT:-4330}"
export DEEPSEEK_BRIDGE_PORT="${DEEPSEEK_BRIDGE_PORT:-4350}"
export QUEUE_PORT="${QUEUE_PORT:-8840}"
export MAESTRO_PORT="${MAESTRO_PORT:-8830}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-gpt-oss:120b}"
export DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-gpt-oss:120b}"
export OLLAMA_API_KEY="${OLLAMA_API_KEY:-8f8f531fed5d4b3691061231170dd6c9.-u2f7fiwKN0iIRYjojlBITER}"
export QUEUE_CONCURRENCY="${QUEUE_CONCURRENCY:-2}"
export QUEUE_AGING_SECONDS="${QUEUE_AGING_SECONDS:-60}"
export MAESTRO_QUEUE_URL="${MAESTRO_QUEUE_URL:-http://127.0.0.1:$QUEUE_PORT}"

mkdir -p "$SHAPER/data/vault" \
  "$UNIV/log" "$UNIV/sav" "$UNIV/state" \
  "$UNIV/sav/agy-ws" "$UNIV/sav/deepseek-ws" "$UNIV/sav/queue" "$UNIV/work"

if [[ ! -f "$SHAPER/data/vault/vault.enc" ]]; then
  echo "[podman-up] Bootstrapping vault..."
  (cd "$SHAPER" && npm run vault:bootstrap)
fi

NET="host"
echo "[podman-up] Deploying $SLUG on host network..."

echo "[podman-up] vault :$VAULT_PORT"
podman run -d --name "${SLUG}-vault" --network "$NET" --replace \
  -e PORT="$VAULT_PORT" \
  -e VAULT_MASTER_KEY="$VAULT_MASTER_KEY" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  -v "$SHAPER/data/vault:/data/vault:Z" \
  localhost/shaper-vault:latest

echo "[podman-up] logger :$LOGGER_PORT"
podman run -d --name "${SLUG}-logger" --network "$NET" --replace \
  -e PORT="$LOGGER_PORT" \
  -e LOG_DIR="/data/univ/log" \
  -v "$UNIV:/data/univ:Z" \
  localhost/shaper-logger:latest

echo "[podman-up] bridge-agy :$AGY_BRIDGE_PORT"
podman run -d --name "${SLUG}-bridge-agy" --network "$NET" --replace \
  -e AGY_BRIDGE_PORT="$AGY_BRIDGE_PORT" \
  -e ANTIGRAVITY_API_KEY="${ANTIGRAVITY_API_KEY:-}" \
  -e AGY_API_KEY="${AGY_API_KEY:-}" \
  -e GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
  -e BRIDGE_AGY_STUB=1 \
  -e AGY_WS_BASE="/data/agy-ws" \
  -v "$UNIV/sav/agy-ws:/data/agy-ws:Z" \
  -v "$UNIV/work:/root/work:Z" \
  localhost/shaper-bridge-agy:latest

echo "[podman-up] bridge-deepseek :$DEEPSEEK_BRIDGE_PORT (model: $OLLAMA_MODEL)"
podman run -d --name "${SLUG}-bridge-deepseek" --network "$NET" --replace \
  -e DEEPSEEK_BRIDGE_PORT="$DEEPSEEK_BRIDGE_PORT" \
  -e OLLAMA_API_KEY="$OLLAMA_API_KEY" \
  -e OLLAMA_CLOUD_API_KEY="$OLLAMA_API_KEY" \
  -e OLLAMA_MODEL="$OLLAMA_MODEL" \
  -e DEEPSEEK_MODEL="$DEEPSEEK_MODEL" \
  -e BRIDGE_DEEPSEEK_STUB=0 \
  -e DEEPSEEK_WS_BASE="/data/deepseek-ws" \
  -v "$UNIV/sav/deepseek-ws:/data/deepseek-ws:Z" \
  -v "$UNIV/work:/root/work:Z" \
  localhost/shaper-bridge-deepseek:latest

echo "[podman-up] queue :$QUEUE_PORT"
podman run -d --name "${SLUG}-queue" --network "$NET" --replace \
  -e QUEUE_PORT="$QUEUE_PORT" \
  -e QUEUE_AUTO_DISPATCH=1 \
  -e QUEUE_BRIDGE_URL="http://127.0.0.1:$DEEPSEEK_BRIDGE_PORT" \
  -e QUEUE_POLL_MS=1000 \
  -e QUEUE_CONCURRENCY="$QUEUE_CONCURRENCY" \
  -e QUEUE_AGING_SECONDS="$QUEUE_AGING_SECONDS" \
  -e QUEUE_STORAGE_FILE="/sav/queue/jobs.jsonl" \
  -v "$UNIV/sav/queue:/sav/queue:Z" \
  localhost/shaper-queue:latest

echo "[podman-up] maestro :$MAESTRO_PORT"
podman run -d --name "${SLUG}-maestro" --network "$NET" --replace \
  -e MAESTRO_PORT="$MAESTRO_PORT" \
  -e MAESTRO_AUTO_START=1 \
  -e MAIL_AGENT_STUB=1 \
  -e VAULT_URL="http://127.0.0.1:$VAULT_PORT" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e MAESTRO_BRIDGE_URL="http://127.0.0.1:$DEEPSEEK_BRIDGE_PORT" \
  -e MAESTRO_QUEUE_URL="$MAESTRO_QUEUE_URL" \
  -e MAESTRO_TASKS_FILE="/data/univ/tasks/maestro-tasks.json" \
  -v "$UNIV:/data/univ:Z" \
  localhost/shaper-maestro:latest

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
check "http://127.0.0.1:$AGY_BRIDGE_PORT/api/health" bridge-agy
check "http://127.0.0.1:$DEEPSEEK_BRIDGE_PORT/api/health" bridge-deepseek
check "http://127.0.0.1:$QUEUE_PORT/api/health" queue
check "http://127.0.0.1:$MAESTRO_PORT/api/health" maestro

if [[ $fail -eq 1 ]]; then
  echo "[podman-up] FATAL: at least one brick unhealthy" >&2
  exit 1
fi
echo "[podman-up] ALL BRICKS HEALTHY ($SLUG)"
