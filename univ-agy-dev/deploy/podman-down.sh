#!/usr/bin/env bash
set -euo pipefail
UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SLUG="${UNIV_SLUG:-$(basename "$UNIV")}"
echo "[podman-down] Stopping $SLUG containers..."
podman rm -f "${SLUG}-maestro" "${SLUG}-queue" "${SLUG}-bridge-agy" "${SLUG}-bridge-deepseek" "${SLUG}-logger" "${SLUG}-vault" 2>/dev/null || true
echo "[podman-down] Done."
