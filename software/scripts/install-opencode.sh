#!/usr/bin/env bash
# Install OpenCode CLI for free-tier bridge (deepseek-v4-flash-free).
set -euo pipefail

DEST_DIR="${OPENCODE_INSTALL_DIR:-/opt/bridge/opencode/bin}"
SRC="${1:-${OPENCODE_SOURCE:-$HOME/.opencode/bin/opencode}}"

mkdir -p "$DEST_DIR"

if [[ -f "$SRC" ]]; then
  install -m 0755 "$SRC" "$DEST_DIR/opencode"
else
  echo "[install-opencode] Local binary missing — downloading via official installer..."
  TMP=$(mktemp -d)
  curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path 2>/dev/null || true
  if [[ -x "$HOME/.opencode/bin/opencode" ]]; then
    install -m 0755 "$HOME/.opencode/bin/opencode" "$DEST_DIR/opencode"
  else
    echo "[install-opencode] FAIL — place binary at $DEST_DIR/opencode"
    exit 1
  fi
  rm -rf "$TMP"
fi

echo "[install-opencode] OK — $DEST_DIR/opencode ($(du -h "$DEST_DIR/opencode" | cut -f1))"
"$DEST_DIR/opencode" --version 2>/dev/null || true
