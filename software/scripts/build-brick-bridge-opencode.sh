#!/usr/bin/env bash
# Build shaper-bridge-opencode with OpenCode CLI embedded.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BIN_DIR="$ROOT/bricks/brick-bridge-opencode/bin"
mkdir -p "$BIN_DIR"
if [[ ! -x "$BIN_DIR/opencode" ]]; then
  SRC="${OPENCODE_SOURCE:-${HOME}/.opencode/bin/opencode}"
  if [[ ! -x "$SRC" ]]; then
    SRC=/opt/bridge/opencode/bin/opencode
  fi
  if [[ ! -x "$SRC" ]]; then
    echo "[build-brick-bridge-opencode] Missing opencode binary. Install first:"
    echo "  curl -fsSL https://opencode.ai/install | bash"
    exit 1
  fi
  install -m 0755 "$SRC" "$BIN_DIR/opencode"
  echo "[build-brick-bridge-opencode] Vendored $(du -h "$BIN_DIR/opencode" | cut -f1) binary"
fi

if [[ ! -f "$ROOT/packages/opencode-bridge/server.mjs" ]]; then
  echo "[build-brick-bridge-opencode] Missing packages/opencode-bridge (vendor from xavdp-pro/opencode-bridge)"
  exit 1
fi

podman build -f bricks/brick-bridge-opencode/Containerfile -t shaper-bridge-opencode:latest .
echo "[build-brick-bridge-opencode] OK — localhost/shaper-bridge-opencode:latest (opencode inside image)"
