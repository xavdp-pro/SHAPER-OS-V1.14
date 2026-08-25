#!/usr/bin/env bash
SLUG="univ-wordpress-father"
UNIV="$(cd "$(dirname "$0")/.." && pwd)"
echo "[father-down] Stopping $SLUG..."
for pidf in "$UNIV/supervisor.pid" "$UNIV/manager-gateway.pid"; do
  if [[ -f "$pidf" ]]; then
    kill "$(cat "$pidf")" 2>/dev/null || true
    rm -f "$pidf"
  fi
done
podman rm -f "${SLUG}-vault" "${SLUG}-logger" "${SLUG}-queue" "${SLUG}-maestro" "${SLUG}-cloudflared" 2>/dev/null || true
echo "[father-down] Cleaned up."
