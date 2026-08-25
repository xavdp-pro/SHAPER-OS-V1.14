#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "[build-brick-ged] building localhost/shaper-ged:latest..."
podman build -t localhost/shaper-ged:latest -f "$ROOT/bricks/brick-ged/Containerfile" "$ROOT"
echo "[build-brick-ged] OK — localhost/shaper-ged:latest"
