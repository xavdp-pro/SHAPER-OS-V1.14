#!/usr/bin/env bash
# Install Antigravity CLI (agy) on host — glibc binary, used by bridge-agy container via bind-mount.
set -euo pipefail

SRC="${1:-${AGY_SOURCE:-$HOME/.local/bin/agy}}"
DEST_DIR="${AGY_INSTALL_DIR:-/opt/bridge/antigravity/bin}"
DEST="$DEST_DIR/agy"

if [[ ! -f "$SRC" ]]; then
  echo "[install-agy] Source binary not found: $SRC"
  echo "Usage: AGY_SOURCE=/path/to/agy $0"
  exit 1
fi

mkdir -p "$DEST_DIR"
install -m 0755 "$SRC" "$DEST"
echo "[install-agy] OK — $DEST ($(du -h "$DEST" | cut -f1))"
