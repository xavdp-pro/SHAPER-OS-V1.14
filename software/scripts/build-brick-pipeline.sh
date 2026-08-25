#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "[build-brick-pipeline] building localhost/shaper-pipeline:latest..."
podman build -t localhost/shaper-pipeline:latest -f "$ROOT/bricks/brick-pipeline/Containerfile" "$ROOT"
echo "[build-brick-pipeline] OK — localhost/shaper-pipeline:latest"
