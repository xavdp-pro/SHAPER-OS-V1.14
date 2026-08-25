#!/usr/bin/env bash
# Build shaper-maestro image from repo root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
podman build -f bricks/brick-maestro/Containerfile -t shaper-maestro:latest .
echo "[build-brick-maestro] OK — localhost/shaper-maestro:latest"
