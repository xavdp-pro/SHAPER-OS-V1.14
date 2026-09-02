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

# A .env file carries DEFAULTS. Anything the operator already exported wins —
# until V1.13.5 `source` clobbered it, so the engine measured at runbook step
# 4.2b was silently replaced by the empty OPENCODE_MODEL in .env and the deploy
# halted on its own halt-check; a cold tester reported patching this script (run
# without an on-disk report), and a second tester confirmed the clobbering. Same principle as the vault's storage file (V1.13.1): an explicit
# choice always beats a packaged default.
#
# Every model variable a bridge below reads is listed, under each name the
# bridge accepts: after the Rule 7 sweep the cursor and agy bridges halt
# without a measured model exactly as opencode does, and a `CURSOR_MODEL=`
# left in a .env would otherwise blank the engine the operator exported and
# trip that halt — the defect above, met again one bridge over.
KEEP_VARS=(OPENCODE_MODEL CURSOR_MODEL AGY_MODEL ANTIGRAVITY_MODEL
           SHAPER_REGISTRY SHAPER_IMAGE_TAG SHAPER_TLS_VERIFY
           VAULT_MASTER_KEY VAULT_TOKEN APP_PASSWORD MAESTRO_QUEUE_URL)
for v in "${KEEP_VARS[@]}"; do declare -g "__KEEP_$v=${!v:-}"; done

# A variables file holds only variables. `source` EXECUTES every line that is
# not blank, a comment, or KEY=value — and on the first night Rule 11 ran in
# production a human note slipped into tokens.env (`BACKOFFICE_ADMIN = email /
# password`) was run as a command: the deploy died before it could print its
# own halt (docs/proof/proof-rule-11-in-production.md, lesson 7). So every
# file is read before it is sourced, and the first line that is not a
# variable stops the deploy, quoted, with its number. Keys may carry digits
# (R2_BUCKET_NAME is a variable); a note for a human goes behind #.
#
# The value is held to the same standard as the key. A first version admitted
# any `KEY=value`, and its reviewer showed that `KEY=1; echo INJECTED` passed
# and was then run by source. A value is a double-quoted string (no `$(…)`,
# no backtick — bash expands those inside double quotes), a single-quoted
# string, or a bare word carrying no whitespace and no shell operator
# (`; & | ( ) < >` and quotes): `KEY=a b` runs `b`, `KEY=a>b` writes a file.
# This grep and ENV_VALUE in scripts/lib/preflight-checks.mjs are the same
# grammar; a test feeds both the same lines.
shaper_env_file_is_variables_only() {
  local file="$1" bad status=0
  # grep -v selects the lines that are NOT admitted. Its exit code is read
  # explicitly rather than hidden behind `|| true`: 1 means no line was
  # selected — the file is clean, the good outcome — and 2 means grep could
  # not read the file, which is a halt of its own, never a pass.
  bad="$(grep -nvE '^[[:space:]]*(#|$)|^[A-Z][A-Z0-9_]*=("([^"`$]|\$[^(])*\$?"|'"'"'[^'"'"']*'"'"'|[^[:blank:];&|()<>`'"'"'"]*)$' "$file")" || status=$?
  if (( status == 1 )); then
    return 0
  elif (( status == 2 )); then
    echo "[podman-up] cannot read $file — a file that cannot be checked is not sourced" >&2
    return 1
  fi
  echo "[podman-up] $file is not a variables file — these lines would be EXECUTED by source, not exported:" >&2
  echo "$bad" | sed 's/^/[podman-up]   line /' >&2
  echo "[podman-up] only blank lines, # comments and KEY=value are allowed, the value quoted or a bare word without whitespace or shell operators; put a note for a human behind #" >&2
  return 1
}
shaper_source_env() {
  shaper_env_file_is_variables_only "$1" || exit 1
  set -a; source "$1"; set +a
}

# 1. Base defaults from software/.env or root .env
if [[ -f "$SHAPER/.env" ]]; then
  shaper_source_env "$SHAPER/.env"
elif [[ -f "$REPO_ROOT/.env" ]]; then
  shaper_source_env "$REPO_ROOT/.env"
fi

# 2. Universe overrides (takes highest precedence)
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
  shaper_source_env "$ENV_FILE"
elif [[ -f "$UNIV/.env" ]]; then
  shaper_source_env "$UNIV/.env"
elif [[ -f "$UNIV/deploy/env" ]]; then
  shaper_source_env "$UNIV/deploy/env"
elif [[ -f "$UNIV/deploy/${SLUG}.env" ]]; then
  shaper_source_env "$UNIV/deploy/${SLUG}.env"
fi

# The operator's explicit exports come back on top of every file.
for v in "${KEEP_VARS[@]}"; do
  k="__KEEP_$v"; [[ -n "${!k}" ]] && export "$v=${!k}"
done

# The halt must SPEAK. Under set -u a bare $ENV_FILE in this message crashed
# the script with "ENV_FILE: unbound variable" whenever the key was missing
# and no override file was named — masking the real cause behind a shell
# error (v1.13.14 sealing run, incident 1).
export VAULT_MASTER_KEY="${VAULT_MASTER_KEY:?Set VAULT_MASTER_KEY in your shell or in ${ENV_FILE:-software/.env} — generate it per docs/PREREQUISITES.md §4}"
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
# last resort. Beta finding F5: the manifest said one family and this script
# hardcoded another, and `test:live` failed as documented. V1.13.1 made this
# script read the manifest — and only this script: the rest of the tree kept
# the old family until the release after v1.13.34, when one family was written
# everywhere and the one-port-family guard was born
# (pkg-universe/test/one-port-family.test.js, docs/architecture/BRICKS.md).
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
  # No default model — Rule 7, same contract as OPENCODE_MODEL above. Until the
  # Rule 7 sweep this line pinned a Composer version the bridge did not even
  # read; the bridge now halts without CURSOR_MODEL, so refuse here, where the
  # message is readable, rather than in a crash-looping container.
  if [[ "${BRIDGE_CURSOR_STUB:-0}" != "1" ]]; then
    : "${CURSOR_MODEL:?not set — bridge-cursor is enabled and names no default model (Rule 7): measure the engines reachable from this host and export CURSOR_MODEL=<model id>}"
  fi
  # cursor-agent is a separate CLI from the IDE. Mounted read-only from the host
  # so the image carries no binary it cannot version.
  podman run -d --name "${SLUG}-bridge-cursor" --network "$NET" --replace \
    --cgroups=disabled \
    -e CURSOR_BRIDGE_PORT="$CURSOR_BRIDGE_PORT" \
    -e BRIDGE_CURSOR_STUB="${BRIDGE_CURSOR_STUB:-0}" \
    -e CURSOR_BIN=/usr/local/bin/cursor-agent \
    -e CURSOR_API_KEY="${CURSOR_API_KEY:-}" \
    -e CURSOR_MODEL="${CURSOR_MODEL:-}" \
    -e CURSOR_MODE="${CURSOR_MODE:-normal}" \
    ${CURSOR_AGENT_DIR:+-v "${CURSOR_AGENT_DIR}:/opt/cursor-agent:ro"} \
    ${CURSOR_AGENT_DIR:+-e CURSOR_BIN=/opt/cursor-agent/cursor-agent} \
    -v "${WORK_ROOT}:${WORK_ROOT}:Z" \
    "$(shaper_image_ref img-bridge-cursor)"
fi

if [[ "$WITH_BRIDGE_AGY" == "1" ]]; then
  echo "[podman-up] bridge-agy :$AGY_BRIDGE_PORT"
  # No default model — Rule 7, same contract as OPENCODE_MODEL above. Until the
  # Rule 7 sweep this line pinned one version and the package pinned another:
  # two defaults for one bridge, neither measured. The real bridge is forced on
  # below, so a model is always required here.
  : "${AGY_MODEL:?not set — bridge-agy is enabled and names no default model (Rule 7): measure the engines reachable from this host and export AGY_MODEL=<model id>}"
  # BRIDGE_AGY_STUB=1 is baked into the image; it must be overridden explicitly
  # or the bridge stays simulated while answering healthy.
  podman run -d --name "${SLUG}-bridge-agy" --network "$NET" --replace \
    --cgroups=disabled \
    -e AGY_BRIDGE_PORT="$AGY_BRIDGE_PORT" \
    -e BRIDGE_AGY_STUB=0 \
    -e AGY_BIN=/usr/local/bin/agy \
    -e AGY_MODEL="$AGY_MODEL" \
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
