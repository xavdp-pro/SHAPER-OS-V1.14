#!/usr/bin/env bash
# Build Podman image localhost/shaper-helm:latest (Helm v2 web chat)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[build-brick-helm] Building localhost/shaper-helm:latest..."
podman build --no-cache -t localhost/shaper-helm:latest -f bricks/brick-helm/Containerfile .
echo "[build-brick-helm] OK — localhost/shaper-helm:latest"
