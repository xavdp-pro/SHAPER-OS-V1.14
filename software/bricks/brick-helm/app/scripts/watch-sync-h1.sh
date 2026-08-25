#!/usr/bin/env bash
# Sync local helm-v1 → gbs-h1 on file save (Vite HMR sur <PUBLIC_HOST>).
# Debounce + restart API seulement si server/ a changé.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DST="gbs-h1:/apps/helm-v1/app/"
RSYNC=(rsync -avz
  --exclude node_modules
  --exclude .env
  --exclude dist
  --exclude 'data/timelines/*.json'
)

SERVER_CHANGED=0
DEBOUNCE_PID=""

sync_once() {
  local out
  out="$("${RSYNC[@]}" "$ROOT/" "$DST" 2>&1)" || true
  echo "[$(date +%H:%M:%S)] synced → h1"
  if echo "$out" | grep -qE '^server/'; then
    SERVER_CHANGED=1
  fi
}

restart_api_if_needed() {
  if [ "$SERVER_CHANGED" = 1 ]; then
    ssh gbs-h1 'cd /apps/helm-v1/app && pm2 restart helm-api --update-env' 2>/dev/null \
      && echo "[$(date +%H:%M:%S)] API restarted (server/ changed)"
    SERVER_CHANGED=0
  fi
}

schedule_sync() {
  if [ -n "$DEBOUNCE_PID" ] && kill -0 "$DEBOUNCE_PID" 2>/dev/null; then
    kill "$DEBOUNCE_PID" 2>/dev/null || true
  fi
  (
    sleep 1.2
    sync_once
    restart_api_if_needed
  ) &
  DEBOUNCE_PID=$!
}

echo "watch-sync-h1: $ROOT → $DST (debounce 1.2s, HMR src/ only)"
sync_once
restart_api_if_needed

WATCH_PATHS=("$ROOT/src" "$ROOT/server" "$ROOT/vite.config.js" "$ROOT/ecosystem.config.cjs")

if command -v inotifywait >/dev/null 2>&1; then
  while inotifywait -r -e modify,create,delete,move "${WATCH_PATHS[@]}" >/dev/null 2>&1; do
    schedule_sync
  done
else
  echo "inotifywait absent — polling toutes les 5s"
  while true; do
    sleep 5
    sync_once
    restart_api_if_needed
  done
fi
