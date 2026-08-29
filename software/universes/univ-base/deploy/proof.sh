#!/usr/bin/env bash
# Intent: software/universes/univ-base/INTENT.md#proof
# Proves a universe is alive — and prints what it observed, not what it hoped.
# Layout-agnostic since V1.13.2: works from any universe deploy/ directory.
#
# Rule 33: declaring, materialising and proving are three separate acts. This
# script performs the third and only the third. It starts nothing and repairs
# nothing; if a brick is down, that is the finding.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
SLUG="$(basename "$UNIV")"

# Ports: env wins, then this universe's manifest, then univ-base's family.
# Until V1.13.2 the defaults were hardcoded to one universe's family and the
# script died on any other layout (validation re-test, R3).
manifest_port() {
  python3 - "$UNIV/manifest.json" "$1" "$2" 2>/dev/null <<'PY' || echo "$2"
import json, sys
try:
    doc = json.load(open(sys.argv[1]))
    port = (doc.get("bricks", {}).get(sys.argv[2], {}) or {}).get("port")
    print(port if port else sys.argv[3])
except Exception:
    print(sys.argv[3])
PY
}
VAULT_PORT="${VAULT_PORT:-$(manifest_port brick-vault 8510)}"
LOGGER_PORT="${LOGGER_PORT:-$(manifest_port brick-logger 8520)}"
QUEUE_PORT="${QUEUE_PORT:-$(manifest_port brick-queue 8540)}"
MAESTRO_PORT="${MAESTRO_PORT:-$(manifest_port brick-maestro 8530)}"
BRIDGE_PORT="${BRIDGE_PORT:-$(manifest_port brick-bridge-opencode 4440)}"

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
# The schedule lives at the root in univ-base's layout, under tasks/ in the
# runbook's — both are legitimate (manifest field `tasks` names it).
TASKS_FILE="$UNIV/task-schedule.json"
[[ -f "$TASKS_FILE" ]] || TASKS_FILE="$UNIV/tasks/task-schedule.json"
declared="$(sed -n 's/.*"slug"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TASKS_FILE" 2>/dev/null | head -1)"
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
if [[ -f "$UNIV/cfg-image-lock.json" ]]; then
  python3 "$UNIV/deploy/check-image-lock.py" "$UNIV/cfg-image-lock.json" || fail=1
else
  # A DEV universe on the registry rung has no lock yet — that is a declared
  # state, not a silent pass: record it and do not fail (Rule 36: the lock is
  # what TEST and PROD pin; record-image-lock.py creates it).
  say SKIP image-lock "no cfg-image-lock.json — DEV runs on the registry rung; record the lock before TEST"
fi

echo
echo "── the audit trail joins a real job (proof #4) ─────────────────────────"
# Until V1.13.1 this section warned when the logger was empty and the script
# still concluded "proven" — a green that Rule 0G forbids, found by all five
# beta testers. The proof standard (runbook step 6, PROOF.md step 2) is: an
# audit event correlated with a queue job id, read from outside the thing
# that produced it. No job yet, or no correlated event → NOT proven.
pairs="$(python3 - "http://127.0.0.1:$QUEUE_PORT" "http://127.0.0.1:$LOGGER_PORT" <<'PY' 2>/dev/null || echo ERR
import json, sys, urllib.request
def get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.load(r)
try:
    jobs = get(sys.argv[1] + "/api/jobs").get("jobs", [])
    events = get(sys.argv[2] + "/api/events/last?limit=200").get("events", [])
    ids = {j.get("id") for j in jobs if j.get("id")}
    hits = [e for e in events
            if e.get("correlationId") in ids or (e.get("data") or {}).get("jobId") in ids]
    print(f"{len(jobs)} {len(hits)}")
except Exception:
    print("ERR")
PY
)"
if [[ "$pairs" == "ERR" ]]; then
  say FAIL audit "could not read the queue or the logger to correlate"
  fail=1
else
  jobs_n="${pairs%% *}"; hits_n="${pairs##* }"
  if [[ "$jobs_n" -eq 0 ]]; then
    say FAIL audit "no queue job exists yet — the proof requires one real deliverable (Rule 25: the gate is the typed gate, not the health port)"
    fail=1
  elif [[ "$hits_n" -gt 0 ]]; then
    say OK audit "$hits_n audit event(s) correlated across $jobs_n job(s)"
  else
    say FAIL audit "$jobs_n job(s), zero correlated audit events — the work happened off the record"
    fail=1
  fi
fi

echo
if (( fail )); then
  echo "$SLUG is NOT proven. The failures above are the report."
else
  echo "$SLUG is proven: every declared brick answered, the declared task is held, and the audit trail joins a real job."
fi
exit "$fail"
