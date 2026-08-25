#!/usr/bin/env bash
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SLUG="univ-test-child"
REPO_ROOT="$(cd "$UNIV/.." && pwd)"
SHAPER="${SHAPER_ROOT:-$REPO_ROOT/software}"
if [[ ! -d "$SHAPER/packages" && -d "$REPO_ROOT/SHAPER-OS-V1.7/software/packages" ]]; then
  SHAPER="$REPO_ROOT/SHAPER-OS-V1.7/software"
fi

export VAULT_PORT="9210"
export LOGGER_PORT="9220"
export MAESTRO_PORT="9230"
export QUEUE_PORT="9240"
export DEEPSEEK_BRIDGE_PORT="9250"
export VAULT_MASTER_KEY="shaper-child-master-key!!"
export VAULT_TOKEN="shaper-child-token"
export OLLAMA_API_KEY="${OLLAMA_API_KEY:-8f8f531fed5d4b3691061231170dd6c9.-u2f7fiwKN0iIRYjojlBITER}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-gpt-oss:120b}"

mkdir -p "$UNIV/log" "$UNIV/sav/deepseek-ws" "$UNIV/sav/queue" "$UNIV/work" "$UNIV/tasks" "$UNIV/data/vault"

NET="host"
echo "[child-up] Deploying $SLUG..."

podman run -d --name "${SLUG}-vault" --network "$NET" --replace \
  -e PORT="$VAULT_PORT" \
  -e VAULT_MASTER_KEY="$VAULT_MASTER_KEY" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  -v "$UNIV/data/vault:/data/vault:Z" \
  localhost/shaper-vault:latest

podman run -d --name "${SLUG}-logger" --network "$NET" --replace \
  -e PORT="$LOGGER_PORT" \
  -e LOG_DIR="/data/univ/log" \
  -v "$UNIV:/data/univ:Z" \
  localhost/shaper-logger:latest

podman run -d --name "${SLUG}-bridge-deepseek" --network "$NET" --replace \
  -e DEEPSEEK_BRIDGE_PORT="$DEEPSEEK_BRIDGE_PORT" \
  -e OLLAMA_API_KEY="$OLLAMA_API_KEY" \
  -e OLLAMA_CLOUD_API_KEY="$OLLAMA_API_KEY" \
  -e OLLAMA_MODEL="$OLLAMA_MODEL" \
  -e BRIDGE_DEEPSEEK_STUB=0 \
  -e DEEPSEEK_WS_BASE="/data/deepseek-ws" \
  -v "$UNIV/sav/deepseek-ws:/data/deepseek-ws:Z" \
  -v "$UNIV/work:/root/work:Z" \
  localhost/shaper-bridge-deepseek:latest

podman run -d --name "${SLUG}-queue" --network "$NET" --replace \
  -e QUEUE_PORT="$QUEUE_PORT" \
  -e QUEUE_AUTO_DISPATCH=1 \
  -e QUEUE_BRIDGE_URL="http://127.0.0.1:$DEEPSEEK_BRIDGE_PORT" \
  -e QUEUE_POLL_MS=1000 \
  -e QUEUE_CONCURRENCY=2 \
  -e QUEUE_STORAGE_FILE="/sav/queue/jobs.jsonl" \
  -v "$UNIV/sav/queue:/sav/queue:Z" \
  localhost/shaper-queue:latest

podman run -d --name "${SLUG}-maestro" --network "$NET" --replace \
  -e MAESTRO_PORT="$MAESTRO_PORT" \
  -e MAESTRO_AUTO_START=1 \
  -e MAIL_AGENT_STUB=1 \
  -e VAULT_URL="http://127.0.0.1:$VAULT_PORT" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e MAESTRO_BRIDGE_URL="http://127.0.0.1:$DEEPSEEK_BRIDGE_PORT" \
  -e MAESTRO_QUEUE_URL="http://127.0.0.1:$QUEUE_PORT" \
  -e MAESTRO_TASKS_FILE="/data/univ/tasks/maestro-tasks.json" \
  -v "$UNIV:/data/univ:Z" \
  localhost/shaper-maestro:latest

sleep 2
echo "[child-up] $SLUG running on ports 9210-9250"
