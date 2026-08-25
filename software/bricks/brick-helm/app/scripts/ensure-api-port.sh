#!/usr/bin/env bash
# Free API port for helm-v2-api — kills stale node listeners not owned by current pm2 process.
set -euo pipefail

PORT="${HELM_API_PORT:-7926}"
APP_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
PM2_NAME="${HELM_API_PM2_NAME:-helm-v2-api}"

pm2_pid=""
if command -v pm2 >/dev/null 2>&1; then
  pm2_pid="$(pm2 jlist 2>/dev/null | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try {
        const apps=JSON.parse(d||'[]');
        const app=apps.find(a=>a.name==='${PM2_NAME}');
        process.stdout.write(app?.pid?String(app.pid):'');
      } catch { process.stdout.write(''); }
    });
  " || true)"
fi

is_our_pm2() {
  local pid="$1"
  [[ -n "$pm2_pid" && "$pid" == "$pm2_pid" ]]
}

echo "[ensure-api-port] checking :$PORT (pm2 $PM2_NAME pid=${pm2_pid:-none})"

for _ in 1 2 3; do
  mapfile -t pids < <(ss -tlnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print}' | grep -oP 'pid=\K[0-9]+' | sort -u || true)
  if [[ ${#pids[@]} -eq 0 ]]; then
    echo "[ensure-api-port] :$PORT free"
    exit 0
  fi
  for pid in "${pids[@]}"; do
    if is_our_pm2 "$pid"; then
      echo "[ensure-api-port] :$PORT owned by pm2 $PM2_NAME ($pid) — ok"
      exit 0
    fi
    echo "[ensure-api-port] killing stale pid $pid on :$PORT"
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1
done

if ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
  echo "[ensure-api-port] WARNING: :$PORT still busy" >&2
  exit 1
fi
echo "[ensure-api-port] :$PORT ready"
