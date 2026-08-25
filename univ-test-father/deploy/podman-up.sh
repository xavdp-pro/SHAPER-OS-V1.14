#!/usr/bin/env bash
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SLUG="univ-test-father"
REPO_ROOT="$(cd "$UNIV/.." && pwd)"
SHAPER="${SHAPER_ROOT:-$REPO_ROOT/software}"
if [[ ! -d "$SHAPER/packages" && -d "$REPO_ROOT/SHAPER-OS-V1.7/software/packages" ]]; then
  SHAPER="$REPO_ROOT/SHAPER-OS-V1.7/software"
fi

export VAULT_PORT="9110"
export LOGGER_PORT="9120"
export MAESTRO_PORT="9130"
export QUEUE_PORT="9140"
export SUPERVISOR_PORT="9160"
export VAULT_MASTER_KEY="shaper-father-master-key!!"
export VAULT_TOKEN="shaper-father-token"

mkdir -p "$UNIV/log" "$UNIV/sav/queue" "$UNIV/work" "$UNIV/tasks" "$UNIV/data/vault"

NET="host"
echo "[father-up] Deploying $SLUG..."

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

podman run -d --name "${SLUG}-queue" --network "$NET" --replace \
  -e QUEUE_PORT="$QUEUE_PORT" \
  -e QUEUE_AUTO_DISPATCH=0 \
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
  -e MAESTRO_TASKS_FILE="/data/univ/tasks/maestro-tasks.json" \
  -v "$UNIV:/data/univ:Z" \
  localhost/shaper-maestro:latest

# Start supervisor daemon
node "$SHAPER/packages/supervisor/server.js" &
echo $! > "$UNIV/supervisor.pid"

sleep 2
echo "[father-up] $SLUG running on ports 9110-9160"
