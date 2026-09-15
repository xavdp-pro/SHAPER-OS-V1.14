#!/usr/bin/env bash
# Intent: software/universes/univ-base/INTENT.md#proof
# Optional sixth brick on gbs-test: bridge-cursor (CLI + API key) beside univ-base.
# OpenCode stays the manifest default (free); jobs target Cursor via payload.bridgeUrl.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
VOL="$UNIV/.state"
CFG="$UNIV/cfg-univ-base.env"
PORT="${CURSOR_BRIDGE_PORT:-4510}"
TAG="${SHAPER_IMAGE_TAG:-v114-gbs}"
REG="${SHAPER_REGISTRY:-localhost:5000}"
IMG="$REG/shaper/brick-bridge-cursor:$TAG"
AGENT_DIR="${CURSOR_AGENT_DIR:-/opt/cursor-agent/2026.08.25-3e8eec8}"

if [[ ! -f "$CFG" ]]; then
  echo "[cursor-bridge] missing $CFG" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$CFG"
: "${CURSOR_API_KEY:?set CURSOR_API_KEY in cfg-univ-base.env (never commit)}"
: "${CURSOR_MODEL:?measure CURSOR_MODEL on this host first (Rule 7)}"

mkdir -p "$VOL/vol-univ-base-cursor-ws"
podman rm -f univ-base-ctr-bridge-cursor >/dev/null 2>&1 || true
podman run -d --name univ-base-ctr-bridge-cursor --network host --replace \
  -e "CURSOR_BRIDGE_PORT=$PORT" \
  -e CURSOR_BRIDGE_BIND=0.0.0.0 \
  -e CURSOR_API_KEY \
  -e CURSOR_MODEL \
  -e CURSOR_MODE="${CURSOR_MODE:-normal}" \
  -e BRIDGE_CURSOR_STUB=0 \
  -e "CURSOR_BIN=$AGENT_DIR/cursor-agent" \
  -e CURSOR_WS_BASE=/data/cursor-ws \
  -v "$AGENT_DIR:$AGENT_DIR:ro" \
  -v "$VOL/vol-univ-base-cursor-ws:/data/cursor-ws:Z" \
  "$IMG"

echo "[cursor-bridge] up on :$PORT model=$CURSOR_MODEL mode=${CURSOR_MODE:-normal}"
curl -sf "http://127.0.0.1:$PORT/api/health" | head -c 200
echo
