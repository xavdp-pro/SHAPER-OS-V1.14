#!/usr/bin/env bash
# Start univ7 dev stack (node processes, not Podman) from SHAPER-OS root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
UNIV7="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

export BRIDGE_AGY_STUB="${BRIDGE_AGY_STUB:-1}"
export VAULT_PORT="${VAULT_PORT:-8510}"
export LOGGER_PORT="${LOGGER_PORT:-8520}"
export AGY_BRIDGE_PORT="${AGY_BRIDGE_PORT:-4330}"
export MAESTRO_PORT="${MAESTRO_PORT:-8530}"
export VAULT_STORAGE_FILE="${VAULT_STORAGE_FILE:-$ROOT/data/vault/vault.enc}"
export LOG_DIR="${LOG_DIR:-$UNIV7/log}"
export MAESTRO_TASKS_FILE="${MAESTRO_TASKS_FILE:-$UNIV7/tasks/maestro-tasks.json}"
export MAESTRO_BRIDGE_URL="${MAESTRO_BRIDGE_URL:-http://127.0.0.1:$AGY_BRIDGE_PORT}"
export VAULT_URL="${VAULT_URL:-http://127.0.0.1:$VAULT_PORT}"
export LOGGER_URL="${LOGGER_URL:-http://127.0.0.1:$LOGGER_PORT}"
export MAESTRO_AUTO_START="${MAESTRO_AUTO_START:-1}"

mkdir -p "$UNIV7/log" "$UNIV7/sav" "$(dirname "$VAULT_STORAGE_FILE")"

if [[ ! -f "$VAULT_STORAGE_FILE" ]]; then
  echo "[univ7] Vault not found — run: npm run vault:bootstrap"
  exit 1
fi

PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

node packages/vault/server.js &
PIDS+=($!)
sleep 0.3

node packages/logger/server.js &
PIDS+=($!)
sleep 0.3

node packages/bridge-agy/server.js &
PIDS+=($!)
sleep 0.3

node packages/maestro/server.js &
PIDS+=($!)

echo "[univ7] Stack running (stub=$BRIDGE_AGY_STUB)"
echo "  vault   http://127.0.0.1:$VAULT_PORT"
echo "  logger  http://127.0.0.1:$LOGGER_PORT"
echo "  agy     http://127.0.0.1:$AGY_BRIDGE_PORT"
echo "  maestro http://127.0.0.1:$MAESTRO_PORT"
echo "  tasks   $MAESTRO_TASKS_FILE"
echo "Press Ctrl+C to stop."

wait
