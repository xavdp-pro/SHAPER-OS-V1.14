#!/usr/bin/env bash
# Sync local helm-v1 → gbs-h1 on file save (for Vite HMR on <PUBLIC_HOST>).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DST="gbs-h1:/apps/helm-v1/app/"
RSYNC=(rsync -avz --exclude node_modules --exclude .env --exclude dist)

sync_once() {
  "${RSYNC[@]}" "$ROOT/" "$DST"
  echo "[$(date +%H:%M:%S)] synced → h1"
}

echo "watch-sync-h1: $ROOT → $DST"
sync_once

if command -v inotifywait >/dev/null 2>&1; then
  while inotifywait -r -e modify,create,delete,move \
    "$ROOT/src" "$ROOT/server" "$ROOT/vite.config.js" "$ROOT/ecosystem.config.cjs" \
    >/dev/null 2>&1; do
    sync_once
  done
else
  echo "inotifywait absent — polling toutes les 3s"
  while true; do
    sleep 3
    sync_once
  done
fi
