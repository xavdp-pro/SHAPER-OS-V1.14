#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
podman build -f bricks/brick-logger/Containerfile -t shaper-logger:latest .
echo "[build-brick-logger] OK — localhost/shaper-logger:latest"
