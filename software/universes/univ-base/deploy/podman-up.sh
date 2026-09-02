#!/usr/bin/env bash
# Intent: software/universes/univ-base/INTENT.md#image-lock
# Materialises univ-base — the canonical five-brick cell.
#
# This script is the reference an agent copies. It therefore does only what the
# manifest declares, in the order bootOrder states, from the images
# cfg-image-lock.json pins. It reads no secret from the repository, invents no
# hostname, and starts nothing the manifest did not name.
#
# Names follow docs/architecture/NAMING.md:
#   ctr-*  a running container role,  prefixed by the universe
#   vol-*  a persistent universe-owned volume
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SOFTWARE="$(cd "$UNIV/../.." && pwd)"
UNIVERSE="univ-base"
LOCK="$UNIV/cfg-image-lock.json"

# ── 1. Configuration ────────────────────────────────────────────────────────
# A variables file holds only variables. `source` EXECUTES every line that is
# not blank, a comment, or KEY=value — on the first night Rule 11 ran in
# production a human note slipped into a variables file was run as a command,
# and the deploy died before it could print its own halt
# (docs/proof/proof-rule-11-in-production.md, lesson 7). The template and
# scripts/lib/preflight-checks.mjs learned the grammar; this script, the one
# an agent copies, kept sourcing its cfg file unread. The two functions below
# are the template's, verbatim — a test feeds both scripts the same lines.
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

# The universe's own cfg-* file wins over anything the host happens to export.
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
  shaper_source_env "$ENV_FILE"
elif [[ -f "$UNIV/cfg-univ-base.env" ]]; then
  shaper_source_env "$UNIV/cfg-univ-base.env"
fi

: "${VAULT_MASTER_KEY:?not set — generate one and put it in cfg-univ-base.env; this repository ships none}"

VAULT_PORT="${VAULT_PORT:-8610}"
LOGGER_PORT="${LOGGER_PORT:-8620}"
QUEUE_PORT="${QUEUE_PORT:-8640}"
MAESTRO_PORT="${MAESTRO_PORT:-8630}"
BRIDGE_PORT="${BRIDGE_PORT:-4440}"
BRIDGE_SERVE_PORT="${BRIDGE_SERVE_PORT:-4441}"
NET="${PODMAN_NETWORK:-host}"

# ── 2. Images: pinned, or explicitly not ────────────────────────────────────
# cfg-image-lock.json holds an immutable reference per brick. A null means this
# universe has not been released yet. Running anyway is allowed for a laptop, but
# only when the operator says so — never silently, and never for TEST or PROD.
resolve_image() {
  local key="$1"
  local pinned
  pinned="$(sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$LOCK" | head -1)"
  if [[ -n "$pinned" ]]; then
    echo "$pinned"
    return
  fi
  # Rung 2 (V1.13.1): the images just published by scripts/build-brick-*.sh,
  # exactly as the build named them — the lock stays the release path, this is
  # the freshly-built path. One ladder for every deploy script (beta F2).
  if [[ -n "${SHAPER_REGISTRY:-}" && -n "${SHAPER_IMAGE_TAG:-}" ]]; then
    echo "${SHAPER_REGISTRY}/shaper/brick-${key#img-}:${SHAPER_IMAGE_TAG}"
    return
  fi
  if [[ "${SHAPER_ALLOW_UNPINNED:-0}" != "1" ]]; then
    echo "[podman-up] $key is not pinned in cfg-image-lock.json and no SHAPER_REGISTRY/SHAPER_IMAGE_TAG is set." >&2
    echo "[podman-up] The registry is an infrastructure prerequisite, one per machine —" >&2
    echo "[podman-up] ask the operator which one this machine uses (RUNBOOK step 0)." >&2
    echo "[podman-up] For a local dev run only: SHAPER_ALLOW_UNPINNED=1 $0" >&2
    exit 1
  fi
  # Matches a local laptop build: SHAPER_REGISTRY=localhost SHAPER_IMAGE_TAG=dev.
  echo "localhost/shaper/brick-${key#img-}:dev"
}

IMG_VAULT="$(resolve_image img-vault)"
IMG_LOGGER="$(resolve_image img-logger)"
IMG_QUEUE="$(resolve_image img-queue)"
IMG_MAESTRO="$(resolve_image img-maestro)"
IMG_BRIDGE="$(resolve_image img-bridge-opencode)"

# ── 3. Volumes the universe owns ────────────────────────────────────────────
VOL="$UNIV/.state"
mkdir -p "$VOL/vol-univ-base-vault" "$VOL/vol-univ-base-log" "$VOL/vol-univ-base-opencode-ws" \
         "$VOL/vol-univ-base-queue" "$VOL/vol-univ-base-bridge"

BRIDGE_TOKEN_FILE="$VOL/vol-univ-base-bridge/token"
if [[ ! -f "$BRIDGE_TOKEN_FILE" ]]; then
  openssl rand -hex 24 > "$BRIDGE_TOKEN_FILE"
  chmod 600 "$BRIDGE_TOKEN_FILE"
fi
BRIDGE_AUTH_TOKEN="$(tr -d '\r\n' < "$BRIDGE_TOKEN_FILE")"

ctr() { echo "${UNIVERSE}-ctr-$1"; }
for role in vault logger queue bridge-opencode maestro; do
  podman rm -f "$(ctr "$role")" >/dev/null 2>&1 || true
done

wait_healthy() {
  local url="$1" name="$2" tries=30
  while (( tries-- )); do
    curl -sf "$url" >/dev/null && { echo "  OK   $name"; return 0; }
    sleep 1
  done
  echo "  FAIL $name — $url never answered" >&2
  return 1
}

# ── 4. bootOrder layer 0: vault and logger ──────────────────────────────────
echo "[podman-up] layer 0 — vault :$VAULT_PORT, logger :$LOGGER_PORT"

if [[ ! -f "$VOL/vol-univ-base-vault/vault.enc" ]]; then
  # Bootstrapped inside the vault image: a clean-sheet host carries podman and
  # git, and nothing else. A host npm here is the hidden dependency Pillar 1
  # forbids, and it only ever fails on the machine the doctrine cares about.
  podman run --rm \
    -v "$SOFTWARE:/shaper:Z" -v "$VOL/vol-univ-base-vault:/data/vault:Z" -w /shaper \
    -e VAULT_MASTER_KEY -e VAULT_STORAGE_FILE=/data/vault/vault.enc \
    --entrypoint node "$IMG_VAULT" scripts/bootstrap-vault-from-resources.mjs
fi

podman run -d --name "$(ctr vault)" --network "$NET" --replace \
  -e VAULT_PORT="$VAULT_PORT" -e VAULT_MASTER_KEY -e VAULT_TOKEN="${VAULT_TOKEN:-}" \
  -e VAULT_STORAGE_FILE=/data/vault/vault.enc \
  -v "$VOL/vol-univ-base-vault:/data/vault:Z" \
  "$IMG_VAULT" >/dev/null

podman run -d --name "$(ctr logger)" --network "$NET" --replace \
  -e LOGGER_PORT="$LOGGER_PORT" -e LOG_DIR=/data/logger \
  -v "$VOL/vol-univ-base-log:/data/logger:Z" \
  "$IMG_LOGGER" >/dev/null

wait_healthy "http://127.0.0.1:$VAULT_PORT/api/health" vault
wait_healthy "http://127.0.0.1:$LOGGER_PORT/api/health" logger

# ── 5. bootOrder layer 1: queue ─────────────────────────────────────────────
echo "[podman-up] layer 1 — queue :$QUEUE_PORT"
podman run -d --name "$(ctr queue)" --network "$NET" --replace \
  -e QUEUE_PORT="$QUEUE_PORT" \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e QUEUE_AUTO_DISPATCH=1 \
  -e QUEUE_BRIDGE_URL="http://127.0.0.1:$BRIDGE_PORT" \
  -e QUEUE_BRIDGE_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e QUEUE_STORAGE_FILE=/data/queue/jobs.jsonl \
  -v "$VOL/vol-univ-base-queue:/data/queue:Z" \
  "$IMG_QUEUE" >/dev/null
wait_healthy "http://127.0.0.1:$QUEUE_PORT/api/health" queue

# ── 6. bootOrder layer 2: the bridge ────────────────────────────────────────
echo "[podman-up] layer 2 — bridge-opencode :$BRIDGE_PORT"
podman run -d --name "$(ctr bridge-opencode)" --network "$NET" --replace \
  -e OPENCODE_BRIDGE_PORT="$BRIDGE_PORT" \
  -e OPENCODE_BRIDGE_BIND=0.0.0.0 \
  -e OPENCODE_SERVE_PORT="$BRIDGE_SERVE_PORT" \
  -e OPENCODE_BIN=/usr/local/bin/opencode \
  -e OPENCODE_WS_BASE=/data/opencode-ws \
  -e OPENCODE_MODEL="${OPENCODE_MODEL:-}" \
  -v "$VOL/vol-univ-base-opencode-ws:/data/opencode-ws:Z" \
  -e BRIDGE_OPENCODE_STUB="${BRIDGE_OPENCODE_STUB:-0}" \
  -e HOME=/root \
  -e TOKEN_FILE=/root/.config/opencode-bridge/token \
  -v "$VOL/vol-univ-base-bridge:/root/.config/opencode-bridge:Z" \
  "$IMG_BRIDGE" >/dev/null
wait_healthy "http://127.0.0.1:$BRIDGE_PORT/api/health" bridge-opencode

# ── 7. bootOrder layer 3: maestro ───────────────────────────────────────────
# Last, deliberately: it paces work, and there must be somewhere to send it.
echo "[podman-up] layer 3 — maestro :$MAESTRO_PORT"
podman run -d --name "$(ctr maestro)" --network "$NET" --replace \
  -e MAESTRO_PORT="$MAESTRO_PORT" \
  -e MAESTRO_AUTO_START=1 \
  -e VAULT_URL="http://127.0.0.1:$VAULT_PORT" \
  -e VAULT_TOKEN="${VAULT_TOKEN:-}" \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e MAESTRO_QUEUE_URL="http://127.0.0.1:$QUEUE_PORT" \
  -e MAESTRO_BRIDGE_URL="http://127.0.0.1:$BRIDGE_PORT" \
  -e BRIDGE_AUTH_TOKEN="$BRIDGE_AUTH_TOKEN" \
  -e MAESTRO_TASKS_FILE=/data/univ/task-schedule.json \
  -v "$UNIV:/data/univ:Z" \
  "$IMG_MAESTRO" >/dev/null
wait_healthy "http://127.0.0.1:$MAESTRO_PORT/api/health" maestro

echo "[podman-up] univ-base is up. Prove it: bash $UNIV/deploy/proof.sh"
