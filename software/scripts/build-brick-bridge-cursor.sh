#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "[build-brick-bridge-cursor] building localhost/shaper-bridge-cursor:latest..."
podman build -t localhost/shaper-bridge-cursor:latest -f "$ROOT/bricks/brick-bridge-cursor/Containerfile" "$ROOT"
echo "[build-brick-bridge-cursor] OK — localhost/shaper-bridge-cursor:latest"
