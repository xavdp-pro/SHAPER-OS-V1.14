#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "[build-brick-bridge-deepseek] building localhost/shaper-bridge-deepseek:latest..."
podman build -t localhost/shaper-bridge-deepseek:latest -f "$ROOT/bricks/brick-bridge-deepseek/Containerfile" "$ROOT"
echo "[build-brick-bridge-deepseek] OK — localhost/shaper-bridge-deepseek:latest"
