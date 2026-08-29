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
echo "── the audit trail joins a real job (proof #4) ─────────────────────────"
# Until V1.13.1 this section warned when the logger was empty and the script
# still concluded "proven" — a green that Rule 0G forbids, found by all five
# beta testers. The proof standard (runbook step 6, PROOF.md step 2) is: an
# audit event correlated with a queue job id, read from outside the thing
# that produced it. No job yet, or no correlated event → NOT proven.
last_job="$(curl -sf --max-time 5 "http://127.0.0.1:$QUEUE_PORT/api/jobs" 2>/dev/null \
  | python3 -c 'import json,sys; j=json.load(sys.stdin).get("jobs", []); print(j[-1]["id"] if j else "")' 2>/dev/null || true)"
if [[ -z "$last_job" ]]; then
  say FAIL audit "no queue job exists yet — the proof requires one real deliverable (Rule 25: the gate is the typed gate, not the health port)"
  fail=1
else
  correlated="$(curl -sf --max-time 5 "http://127.0.0.1:$LOGGER_PORT/api/events/last?limit=50" 2>/dev/null \
    | python3 -c "import json,sys; e=json.load(sys.stdin).get('events', []); print(sum(1 for x in e if x.get('correlationId')=='$last_job' or (x.get('data') or {}).get('jobId')=='$last_job'))" 2>/dev/null || echo 0)"
  if [[ "$correlated" -gt 0 ]]; then
    say OK audit "$correlated event(s) correlated with $last_job"
  else
    say FAIL audit "job $last_job left no correlated audit event — the work happened off the record"
    fail=1
  fi
fi

echo
if (( fail )); then
  echo "univ-base is NOT proven. The failures above are the report."
else
  echo "univ-base is proven: every declared brick answered, and the declared task is held."
fi
exit "$fail"
