#!/usr/bin/env bash
# Intent: software/universes/README.md#materialise-before-mount
# Golden snippet — first DEV universe (local). Parameterized. No secrets in this file.
# Monorepo layout: clone SHAPER-OS-V1.13, universe sits beside software/:
#   <repo>/software/  +  <repo>/<univ_slug>-dev/
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SLUG="${UNIV_SLUG:-$(basename "$UNIV")}"

# The universe declares its posture in its manifest; the image must not decide it.
# An image bakes NODE_ENV=production for build optimisation, which is right, but
# it says nothing about whether this deployment is a laptop or a business. Without
# this, a DEV universe inherited "production" from the image and halted on a
# missing secret it had no reason to need.
UNIV_ENV="$(sed -n 's/.*"environment"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' "$UNIV/manifest.json" 2>/dev/null | head -1)"
case "${SHAPER_RUNTIME_MODE:-${UNIV_ENV:-dev}}" in
  prod|production) SHAPER_RUNTIME_MODE=production ;;
  *)               SHAPER_RUNTIME_MODE=development ;;
esac
export SHAPER_RUNTIME_MODE
# A production deployment supplies its own operator password. Refusing here beats
# a container that crash-loops with the reason buried in podman logs.
if [[ "$SHAPER_RUNTIME_MODE" == production ]]; then
  : "${APP_PASSWORD:?not set — a production universe supplies its own operator password; this repository ships none}"
fi

REPO_ROOT="$(cd "$UNIV/.." && pwd)"
SHAPER="${SHAPER_ROOT:-$REPO_ROOT/software}"

if [[ ! -d "$SHAPER/packages" ]]; then
  if [[ -d "$REPO_ROOT/SHAPER-OS-V1.13/software/packages" ]]; then
    SHAPER="$REPO_ROOT/SHAPER-OS-V1.13/software"
  elif [[ -d "/root/SHAPER-OS-V1.13/software/packages" ]]; then
    SHAPER="/root/SHAPER-OS-V1.13/software"
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

# The images this universe runs resolve through ONE ladder — the same names
# the build published. See scripts/deploy-image-resolve.sh (V1.13.1, beta
# campaign findings F1/F2/F8).
source "$SHAPER/scripts/deploy-image-resolve.sh"
IMG_VAULT="$(shaper_image_ref img-vault)"
IMG_LOGGER="$(shaper_image_ref img-logger)"
IMG_BRIDGE="$(shaper_image_ref img-bridge-opencode)"
IMG_QUEUE="$(shaper_image_ref img-queue)"
IMG_MAESTRO="$(shaper_image_ref img-maestro)"

# Ports: the manifest declares them; env may override; these defaults are the
# last resort. Until V1.13.1 the manifest said one family and this script
# hardcoded another, and `test:live` failed as documented (beta finding F5).
manifest_port() {
  python3 - "$UNIV/manifest.json" "$1" "$2" 2>/dev/null <<'PY' || echo "$2"
import json, sys
try:
    doc = json.load(open(sys.argv[1]))
    port = (doc.get("bricks", {}).get(sys.argv[2], {}) or {}).get("port")
    print(port if port else sys.argv[3])
except Exception:
    print(sys.argv[3])
PY
}
export VAULT_PORT="${VAULT_PORT:-$(manifest_port brick-vault 8610)}"
export LOGGER_PORT="${LOGGER_PORT:-$(manifest_port brick-logger 8620)}"
export OPENCODE_BRIDGE_PORT="${OPENCODE_BRIDGE_PORT:-$(manifest_port brick-bridge-opencode 4440)}"
export OPENCODE_SERVE_PORT="${OPENCODE_SERVE_PORT:-4441}"
export QUEUE_PORT="${QUEUE_PORT:-$(manifest_port brick-queue 8640)}"
export MAESTRO_PORT="${MAESTRO_PORT:-$(manifest_port brick-maestro 8630)}"

# No default model — Rule 7: engines are measured from THIS host, never
# declared. The opencode CLI ships inside the bridge image you just resolved:
#   podman run --rm --entrypoint opencode "$IMG_BRIDGE" models
# measure, pick the cheapest that answers, and set OPENCODE_MODEL. (Until
# V1.13.1 a withdrawn model was hardcoded here — the very one documented as
# timing out on the reference host.)
export OPENCODE_MODEL="${OPENCODE_MODEL:?not set — measure engines from this host (Rule 7): podman run --rm --entrypoint opencode <bridge-image> models}"
export DEEPGRAM_API_KEY="${DEEPGRAM_API_KEY:-}"
export GROQ_API_KEY="${GROQ_API_KEY:-}"
# The queue is the universe's unit of work. Lanes are how it is sized to the
# host: one on a modest VPS, several on a real server — same image (Rule 32).
export QUEUE_CONCURRENCY="${QUEUE_CONCURRENCY:-1}"
# How fast a waiting job's patience converts into rank. See packages/pkg-queue.
export QUEUE_AGING_SECONDS="${QUEUE_AGING_SECONDS:-60}"
# Set this to route every maestro beat through the queue instead of straight to
# a bridge — one entry point, one ledger, one place that must be right.
# One entry point, one ledger, ONE DEFAULT (V1.13.2): beats route through the
# queue unless the operator explicitly empties this — the audit trail that
# joins a job id (proof #4) exists on the DEFAULT path, not a wired one.
export MAESTRO_QUEUE_URL="${MAESTRO_QUEUE_URL:-http://127.0.0.1:$QUEUE_PORT}"
# The work area every bridge can see. A perimeter is only enforceable where the
# agent actually runs, so a path that exists on the host and not in the bridge
# container bounds nothing. Mounting one shared root at the same path everywhere
# is what makes `perimeter` mean the same thing to the caller and to the agent.
export WORK_ROOT="${WORK_ROOT:-$UNIV/work}"
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
mkdir -p "$UNIV/sav/vault" \
  "$UNIV/log" "$UNIV/sav" "$UNIV/state" \
  "$UNIV/sav/opencode-ws" "$UNIV/sav/opencode-bridge" \
  "$UNIV/sav/queue" "$WORK_ROOT"

# The vault is PER-UNIVERSE state, in this universe's own sav/ (Rule 26 spirit).
# Until V1.13.1 it lived in software/data/vault, shared by every universe on the
# host (beta finding F9).
if [[ ! -f "$UNIV/sav/vault/vault.enc" ]]; then
  echo "[podman-up] Bootstrapping vault..."
  # Bootstrapped inside the vault image, not with a host npm.
  #
  # A blank LXC carrying only podman and git has no node, and calling `npm run`
  # here made deployment fail on exactly the machine the doctrine cares about —
  # the from-scratch one. Pillar 1 says the whole edifice deploys from a single
  # Git repository with no hidden dependency; a host toolchain is such a
  # dependency, and it stayed invisible for as long as we only ever deployed on
  # a workstation that happened to have node.
  #
  # The image already carries the runtime. Use it.
  shaper_pull "$IMG_VAULT"
  podman run --rm \
    -v "$SHAPER:/shaper:Z" \
    -v "$UNIV/sav/vault:/data/vault:Z" \
    -w /shaper \
    -e VAULT_MASTER_KEY \
    -e VAULT_STORAGE_FILE=/data/vault/vault.enc \
    --entrypoint node \
    "$IMG_VAULT" \
    scripts/bootstrap-vault-from-resources.mjs
fi

# Pull everything up front, with the same TLS posture the build pushed with —
# a stack must never discover mid-boot that its registry needs --tls-verify=false.
for ref in "$IMG_VAULT" "$IMG_LOGGER" "$IMG_BRIDGE" "$IMG_QUEUE" "$IMG_MAESTRO"; do
  shaper_pull "$ref"
done

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

NET="${PODMAN_NETWORK:-host}"

echo "[podman-up] vault :$VAULT_PORT"
podman run -d --name "${SLUG}-vault" --network "$NET" --replace \
  -e VAULT_PORT="$VAULT_PORT" \
  -e VAULT_MASTER_KEY \
  -e VAULT_TOKEN \
  -e VAULT_STORAGE_FILE=/data/vault/vault.enc \
  -v "$UNIV/sav/vault:/data/vault:Z" \
  "$IMG_VAULT"

echo "[podman-up] logger :$LOGGER_PORT"
podman run -d --name "${SLUG}-logger" --network "$NET" --replace \
  -e LOGGER_PORT="$LOGGER_PORT" \
  -e LOG_DIR=/data/logger \
  -v "$UNIV/log:/data/logger:Z" \
  "$IMG_LOGGER"

# Start order mirrors the manifest bootOrder: [vault, logger] -> [queue] -> [bridge] -> [maestro].
# Until V1.13.1 this script started the bridge before the queue, in an order the
# manifest never declared (beta finding H6; BOOT-CONTRACT point 6).
echo "[podman-up] queue :$QUEUE_PORT"
podman run -d --name "${SLUG}-queue" --network "$NET" --replace \
  -e QUEUE_PORT="$QUEUE_PORT" \
  -e QUEUE_AUTO_DISPATCH=1 \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e QUEUE_BRIDGE_URL="http://127.0.0.1:$OPENCODE_BRIDGE_PORT" \
  -e QUEUE_BRIDGE_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e QUEUE_POLL_MS=2000 \
  -e QUEUE_CONCURRENCY \
  -e QUEUE_AGING_SECONDS \
  -e QUEUE_STORAGE_FILE="${QUEUE_STORAGE_FILE:-/sav/queue/jobs.jsonl}" \
  -e QUALITY_GATE_ENFORCE="${QUALITY_GATE_ENFORCE:-0}" \
  -v "$UNIV/sav/queue:/sav/queue:Z" \
  "$IMG_QUEUE"

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
  -v "$WORK_ROOT:$WORK_ROOT:Z" \
  "$IMG_BRIDGE"

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
    -v "${WORK_ROOT}:${WORK_ROOT}:Z" \
    "$(shaper_image_ref img-bridge-cursor)"
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
    -v "${WORK_ROOT}:${WORK_ROOT}:Z" \
    "$(shaper_image_ref img-bridge-agy)"
fi

TASKS_FILE="/data/univ/tasks/task-schedule.json"
if [[ -f "$UNIV/tasks/maestro-tasks.podman.json" ]]; then
  TASKS_FILE="/data/univ/tasks/maestro-tasks.podman.json"
fi

echo "[podman-up] maestro :$MAESTRO_PORT"
podman run -d --name "${SLUG}-maestro" --network "$NET" --replace \
  -e MAESTRO_PORT="$MAESTRO_PORT" \
  -e MAESTRO_AUTO_START=1 \
  -e VAULT_URL="http://127.0.0.1:$VAULT_PORT" \
  -e VAULT_TOKEN \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e MAESTRO_BRIDGE_URL="http://127.0.0.1:$OPENCODE_BRIDGE_PORT" \
  -e MAESTRO_QUEUE_URL \
  -e BRIDGE_AUTH_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e MAESTRO_TASKS_FILE="$TASKS_FILE" \
  -v "$UNIV:/data/univ:Z" \
  "$IMG_MAESTRO"

# brick-helm and the tunnel used to be started here. Both are catalogue bricks,
# and this is the base template: a blueprint that starts a brick the base does
# not ship teaches every copy of it to depend on a repository it never declared.
# A universe that wants the cockpit declares it in its own manifest with
# `"source": "catalogue"`, and belongs in the catalogue — see univ-demo there.

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
exit "$fail"
