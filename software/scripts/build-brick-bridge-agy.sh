#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
podman build -f bricks/brick-bridge-agy/Containerfile -t shaper-bridge-agy:latest .
echo "[build-brick-bridge-agy] OK — localhost/shaper-bridge-agy:latest"
