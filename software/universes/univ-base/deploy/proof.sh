#!/usr/bin/env bash
# Intent: software/universes/univ-base/INTENT.md#proof
# Proves univ-base is alive — and prints what it observed, not what it hoped.
#
# Rule 33: declaring, materialising and proving are three separate acts. This
# script performs the third and only the third. It starts nothing and repairs
# nothing; if a brick is down, that is the finding.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
VAULT_PORT="${VAULT_PORT:-8510}"
LOGGER_PORT="${LOGGER_PORT:-8520}"
QUEUE_PORT="${QUEUE_PORT:-8540}"
MAESTRO_PORT="${MAESTRO_PORT:-8530}"
BRIDGE_PORT="${BRIDGE_PORT:-4440}"

fail=0
say() { printf '  %-6s %-22s %s\n' "$1" "$2" "${3:-}"; }

probe() {
  local name="$1" url="$2" body
  if body="$(curl -sf --max-time 5 "$url" 2>/dev/null)"; then
    say OK "$name" "$(echo "$body" | head -c 120)"
  else
    say FAIL "$name" "$url did not answer"
    fail=1
  fi
}

echo "── vitals ──────────────────────────────────────────────────────────────"
probe vault           "http://127.0.0.1:$VAULT_PORT/api/vitals"
probe logger          "http://127.0.0.1:$LOGGER_PORT/api/vitals"
probe queue           "http://127.0.0.1:$QUEUE_PORT/api/vitals"
probe bridge-opencode "http://127.0.0.1:$BRIDGE_PORT/api/health"
probe maestro         "http://127.0.0.1:$MAESTRO_PORT/api/vitals"

echo
echo "── the declared task is registered ─────────────────────────────────────"
declared="$(sed -n 's/.*"slug"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$UNIV/task-schedule.json" | head -1)"
if curl -sf --max-time 5 "http://127.0.0.1:$MAESTRO_PORT/api/tasks" 2>/dev/null | grep -q "\"$declared\""; then
  say OK "$declared" "held by the cadence registry"
else
  say FAIL "$declared" "declared in task-schedule.json but absent from /api/tasks"
  fail=1
fi

echo
echo "── every image this universe runs can be pulled back ───────────────────"
# A proof that only holds where the images were built proves the build, not the
# release. On gbs-test every locked digest returned `manifest unknown` from the
# registry, and this script still said "proven" — because the images were already
# in the local store. See INTENT.md#image-lock.
python3 "$UNIV/deploy/check-image-lock.py" "$UNIV/cfg-image-lock.json" || fail=1

echo
echo "── the logger holds evidence, not just a heartbeat ─────────────────────"
# /api/events is a live SSE stream: it answers ": connected" the moment you
# open it, whether or not anything was ever logged. Probing it proved the
# endpoint was reachable and called that evidence. /api/events/last returns
# what the logger actually holds.
events="$(curl -sf --max-time 5 "http://127.0.0.1:$LOGGER_PORT/api/events/last?limit=5" 2>/dev/null || true)"
count="$(printf '%s' "$events" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("events", [])))' 2>/dev/null || echo 0)"
if [[ "$count" -gt 0 ]]; then
  say OK events "$count recorded — $(printf '%s' "$events" | python3 -c 'import json,sys; e=json.load(sys.stdin)["events"]; print(", ".join(sorted({x["pod"]+":"+x["event"] for x in e})))' 2>/dev/null)"
else
  say WARN events "the logger holds nothing yet — wait one cadence and run again"
fi

echo
if (( fail )); then
  echo "univ-base is NOT proven. The failures above are the report."
else
  echo "univ-base is proven: every declared brick answered, and the declared task is held."
fi
exit "$fail"
