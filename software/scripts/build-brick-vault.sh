#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
podman build -f bricks/brick-vault/Containerfile -t shaper-vault:latest .
echo "[build-brick-vault] OK — localhost/shaper-vault:latest"
