#!/usr/bin/env bash
SLUG="univ-test-father"
UNIV="$(cd "$(dirname "$0")/.." && pwd)"
echo "[father-down] Stopping containers and supervisor for $SLUG..."
if [[ -f "$UNIV/supervisor.pid" ]]; then
  kill "$(cat "$UNIV/supervisor.pid")" 2>/dev/null || true
  rm -f "$UNIV/supervisor.pid"
fi
pkill -f "supervisor/server.js" 2>/dev/null || true
podman rm -f "${SLUG}-vault" "${SLUG}-logger" "${SLUG}-queue" "${SLUG}-maestro" 2>/dev/null || true
echo "[father-down] Cleaned up."
