#!/usr/bin/env bash
# Runs the GED in development mode: sources mounted directly from the repository
# and live-reloading in the browser. No bundler, no image rebuilds —
# edit files and the browser tab updates immediately.
#
#   bash scripts/ged-dev.sh <universe_dir> [port]
#
# Ctrl+C stops the container. To return to production: rerun the universe
# podman-up.sh, which restarts from the frozen container image.
set -euo pipefail

SOFTWARE="$(cd "$(dirname "$0")/.." && pwd)"
UNIV_DIR="${1:?Usage: ged-dev.sh <universe_dir> [port]}"
PORT="${2:-8760}"
NAME="ged-dev"

UNIV_DIR="$(cd "$UNIV_DIR" && pwd)"
DATA_DIR="$UNIV_DIR/sav/ged"
mkdir -p "$DATA_DIR"

echo "[ged-dev] sources: $SOFTWARE/packages"
echo "[ged-dev] data: $DATA_DIR"
echo "[ged-dev] http://127.0.0.1:$PORT — edit public/index.html, tab follows"

podman rm -f "$NAME" >/dev/null 2>&1 || true
exec podman run --rm --name "$NAME" --network host \
  -e GED_DEV=1 \
  -e GED_PORT="$PORT" \
  -e GED_DATA_DIR=/data/ged \
  -e NODE_ENV=development \
  -v "$SOFTWARE/packages/pkg-ged-engine:/app/packages/pkg-ged-engine:ro,Z" \
  -v "$SOFTWARE/packages/pkg-rag:/app/packages/pkg-rag:ro,Z" \
  -v "$DATA_DIR:/data/ged:Z" \
  localhost/shaper-ged:latest \
  node server.js
