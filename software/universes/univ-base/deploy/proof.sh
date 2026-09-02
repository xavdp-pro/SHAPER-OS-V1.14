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
VAULT_PORT="${VAULT_PORT:-$(manifest_port brick-vault 8610)}"
LOGGER_PORT="${LOGGER_PORT:-$(manifest_port brick-logger 8620)}"
QUEUE_PORT="${QUEUE_PORT:-$(manifest_port brick-queue 8640)}"
MAESTRO_PORT="${MAESTRO_PORT:-$(manifest_port brick-maestro 8630)}"
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
echo "── the deliverable is persisted and byte-exact (proofs #1-#3) ──────────"
# Runbook step 6 names four functional proofs. Until V1.13.10 this script
# performed half of #1 — a job exists — and #4, while the runbook told the
# deployer that #2, the artefact exists, and #3, its byte-exact `cmp`, were
# "yours to perform by hand today". A proof standard that is half-scripted is
# a proof standard half-applied: a beta tester read this file, found the gap,
# and nothing in that run had ever compared an artefact's bytes.
#
# What the job was asked to produce is a declaration — no script can guess it —
# so the deployer declares it and this script decides:
#
#   PROOF_JOB_ID        the job to read           (default: the most recent)
#   PROOF_ANSWER        the exact marker the job was told to reply with
#   PROOF_ARTIFACT      the file the job was told to write
#   PROOF_EXPECTED      its expected bytes, verbatim — written out with
#                       printf '%s', so a trailing newline is declared as
#                       PROOF_EXPECTED=$'the marker\n'
#   PROOF_EXPECTED_FILE ... or a file already holding those exact bytes
#
# Declaring nothing is allowed; saying nothing is not. What was not declared is
# printed as a SKIP and repeated by the closing verdict — Rule 0G forbids a
# green a reader could mistake for a full functional proof.
artefact_proven=0

answer="$(python3 - "http://127.0.0.1:$QUEUE_PORT" "${PROOF_JOB_ID:-}" "${PROOF_ANSWER:-}" <<'PY' 2>/dev/null || echo "ERR -"
import json, sys, urllib.request

def verdict(base, wanted, marker):
    with urllib.request.urlopen(base + "/api/jobs", timeout=5) as r:
        jobs = json.load(r).get("jobs", [])
    if wanted:
        jobs = [j for j in jobs if j.get("id") == wanted]
        if not jobs:
            return "ABSENT " + wanted
    if not jobs:
        return "NONE -"
    job = sorted(jobs, key=lambda j: j.get("createdAt") or "")[-1]
    jid, status = job.get("id") or "?", job.get("status") or "?"
    if status not in ("COMPLETED", "FAILED"):
        return f"RUNNING {jid} {status}"
    text = (job.get("result") or {}).get("answer")
    if not isinstance(text, str) or not text.strip():
        return f"UNPERSISTED {jid} {status}"
    if status == "FAILED":
        return f"FAILEDJOB {jid}"
    if marker and marker not in text:
        return f"MISMATCH {jid}"
    return f"OK {jid} {len(text)}"

try:
    print(verdict(sys.argv[1], sys.argv[2], sys.argv[3]))
except Exception:
    print("ERR -")
PY
)"
read -r state job_id detail <<<"$answer"
case "$state" in
  OK)          say OK   answer "$job_id COMPLETED, answer persisted (${detail} bytes)${PROOF_ANSWER:+ and carrying the declared marker}" ;;
  ERR)         say FAIL answer "could not read the queue to see what it persisted"; fail=1 ;;
  NONE)        say FAIL answer "no queue job exists yet — proof #1 needs one real deliverable"; fail=1 ;;
  ABSENT)      say FAIL answer "PROOF_JOB_ID=$job_id is not in the queue"; fail=1 ;;
  RUNNING)     say FAIL answer "$job_id is $detail, not a terminal state"; fail=1 ;;
  UNPERSISTED) say FAIL answer "$job_id reached $detail with no persisted result.answer — the answer lived only on the stream"; fail=1 ;;
  FAILEDJOB)   say FAIL answer "$job_id FAILED — a persisted failure is not a deliverable"; fail=1 ;;
  MISMATCH)    say FAIL answer "$job_id persisted an answer that does not carry the declared marker"; fail=1 ;;
  *)           say FAIL answer "unreadable queue verdict: $answer"; fail=1 ;;
esac

if [[ -z "${PROOF_ARTIFACT:-}" ]]; then
  # The manual state stays a declared state. Silence here is what let a run be
  # called proven while its artefact was never opened.
  say SKIP artefact "no PROOF_ARTIFACT declared — proofs #2 and #3 not performed; declare it with PROOF_EXPECTED or PROOF_EXPECTED_FILE"
else
  expected=""
  if [[ -n "${PROOF_EXPECTED+x}" && -n "${PROOF_EXPECTED_FILE:-}" ]]; then
    say FAIL artefact "PROOF_EXPECTED and PROOF_EXPECTED_FILE both declared — two answers to what was asked"
    fail=1
  elif [[ -n "${PROOF_EXPECTED_FILE:-}" ]]; then
    if [[ -f "$PROOF_EXPECTED_FILE" ]]; then
      expected="$PROOF_EXPECTED_FILE"
    else
      say FAIL artefact "PROOF_EXPECTED_FILE=$PROOF_EXPECTED_FILE does not exist"
      fail=1
    fi
  elif [[ -n "${PROOF_EXPECTED+x}" ]]; then
    expected="$(mktemp -t proof-expected-bytes.XXXXXX)"
    trap 'rm -f "$expected"' EXIT
    printf '%s' "$PROOF_EXPECTED" > "$expected"
  else
    # Existence alone is the check that blesses a wrong file.
    say FAIL artefact "PROOF_ARTIFACT declared without its expected bytes — an artefact nobody compared is not a proof"
    fail=1
  fi

  if [[ -n "$expected" ]]; then
    if [[ ! -f "$PROOF_ARTIFACT" ]]; then
      say FAIL artefact "$PROOF_ARTIFACT does not exist — the job answered but delivered nothing"
      fail=1
    # `cmp`, never test "$(cat f)" = v: command substitution strips trailing
    # newlines, so that idiom reports success on a file whose bytes differ.
    elif diff="$(LC_ALL=C cmp -- "$PROOF_ARTIFACT" "$expected" 2>&1)"; then
      say OK artefact "$PROOF_ARTIFACT is byte-exact ($(wc -c < "$PROOF_ARTIFACT") bytes, cmp)"
      artefact_proven=1
    else
      say FAIL artefact "$PROOF_ARTIFACT is not the declared bytes — ${diff:-cmp reported a difference}"
      fail=1
    fi
  fi
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
elif (( artefact_proven )); then
  echo "$SLUG is proven: every declared brick answered, the declared task is held, the job persisted its answer, the declared artefact is byte-exact, and the audit trail joins a real job."
else
  echo "$SLUG is proven for what was declared: bricks, task, persisted answer, audit trail. No artefact was declared, so proofs #2 and #3 of runbook step 6 were not performed — declare PROOF_ARTIFACT to script them, or run the cmp by hand and record its output. Until then this is not the full functional proof."
fi
exit "$fail"
