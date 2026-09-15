#!/usr/bin/env bash
# Intent: software/universes/univ-base/INTENT.md#proof
# Runbook step 6 on gbs-test: real bridge job, declared artefact, deploy/proof.sh exit 0.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$(dirname "$0")"
MARKER="${PROOF_MARKER:-MARKER-V114-GBS}"
CONV="${PROOF_CONVERSATION:-proof-v114-full}"
VOL="$UNIV/.state/vol-univ-base-opencode-ws"

if [[ ! -f "$UNIV/cfg-univ-base.env" ]]; then
  echo "[full-proof] missing $UNIV/cfg-univ-base.env — run bootstrap first" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$UNIV/cfg-univ-base.env"
MODEL="${OPENCODE_MODEL:-}"
if [[ -z "$MODEL" || "${BRIDGE_OPENCODE_STUB:-0}" == "1" ]]; then
  echo "[full-proof] measuring OPENCODE_MODEL (Rule 7) ..."
  bash "$DEPLOY/gbs-test-measure-opencode.sh"
  # shellcheck source=/dev/null
  source "$UNIV/cfg-univ-base.env"
  MODEL="$OPENCODE_MODEL"
  export SHAPER_REGISTRY="${SHAPER_REGISTRY:-localhost:5000}"
  export SHAPER_IMAGE_TAG="${SHAPER_IMAGE_TAG:-v114-gbs}"
  export SHAPER_TLS_VERIFY="${SHAPER_TLS_VERIFY:-false}"
  bash "$DEPLOY/podman-up.sh"
  sleep 10
fi

JOB_JSON="$(python3 - "$MARKER" "$CONV" "$MODEL" <<'PY'
import json, sys, urllib.request
marker, conv, model = sys.argv[1:4]
msg = (
    f"Write the exact text {marker}, with no trailing newline, into marker.txt. "
    f"Then reply with that same exact text."
)
body = json.dumps({
    "type": "agent.inject",
    "totalSteps": 2,
    "payload": {"message": msg, "conversation": conv, "model": model},
}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:8640/api/jobs",
    data=body,
    method="POST",
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=30) as r:
    print(json.dumps(json.load(r)["job"]))
PY
)"
JOB_ID="$(echo "$JOB_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
echo "[full-proof] submitted $JOB_ID"

python3 - "$JOB_ID" <<'PY'
import json, sys, time, urllib.request
jid = sys.argv[1]
for i in range(72):
    with urllib.request.urlopen(f"http://127.0.0.1:8640/api/jobs/{jid}", timeout=30) as r:
        j = json.load(r)["job"]
    st = j["status"]
    if st in ("COMPLETED", "FAILED"):
        print(st, (j.get("result") or {}).get("answer", ""))
        if st == "FAILED":
            sys.exit(1)
        break
    time.sleep(5)
else:
    print("TIMEOUT", file=sys.stderr)
    sys.exit(1)
PY

ARTIFACT="$VOL/$CONV/marker.txt"
export PROOF_JOB_ID="$JOB_ID"
export PROOF_ANSWER="$MARKER"
export PROOF_EXPECTED="$MARKER"
export PROOF_ARTIFACT="$ARTIFACT"
bash "$DEPLOY/proof.sh"
