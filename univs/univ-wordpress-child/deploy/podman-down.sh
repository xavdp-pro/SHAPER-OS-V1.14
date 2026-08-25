#!/usr/bin/env bash
SLUG="univ-wordpress-child"
UNIV="$(cd "$(dirname "$0")/.." && pwd)"
echo "[child-down] Stopping $SLUG..."
for pidf in "$UNIV/vitals-wordpress.pid" "$UNIV/vitals-mariadb.pid"; do
  if [[ -f "$pidf" ]]; then
    kill "$(cat "$pidf")" 2>/dev/null || true
    rm -f "$pidf"
  fi
done
pkill -f "univ-wordpress-child/lib/vitals-probe.mjs" 2>/dev/null || true
podman rm -f "${SLUG}-logger" "${SLUG}-mariadb" "${SLUG}-wordpress" "${SLUG}-sshd" 2>/dev/null || true
echo "[child-down] Cleaned up."
