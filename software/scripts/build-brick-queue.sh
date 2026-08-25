#!/usr/bin/env bash
# Build shaper-queue image from repo root.
# Usage: ./scripts/build-brick-queue.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
podman build -f bricks/brick-queue/Containerfile -t shaper-queue:latest .
echo "[build-brick-queue] OK — localhost/shaper-queue:latest"
