#!/usr/bin/env bash
# Build shaper-bridge-opencode with OpenCode CLI embedded.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/packages/pkg-opencode-bridge/server.mjs" ]]; then
  echo "[build-brick-bridge-opencode] Missing packages/pkg-opencode-bridge (vendor from xavdp-pro/opencode-bridge)"
  exit 1
fi

podman build -f bricks/brick-bridge-opencode/Containerfile -t shaper-bridge-opencode:latest .
echo "[build-brick-bridge-opencode] OK — localhost/shaper-bridge-opencode:latest (opencode inside image)"
