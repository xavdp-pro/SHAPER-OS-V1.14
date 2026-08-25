#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== [build-brick-mariadb] Building image localhost/shaper-mariadb:latest ==="
podman build -t localhost/shaper-mariadb:latest -f "$ROOT_DIR/bricks/brick-mariadb/Containerfile" "$ROOT_DIR"
echo "=== [build-brick-mariadb] Image built successfully! ==="
