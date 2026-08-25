#!/usr/bin/env bash
# Push a voluntary job to univ8 queue (processed by OpenCode bridge).
set -euo pipefail

QUEUE_URL="${QUEUE_URL:-http://127.0.0.1:8640}"
MESSAGE="${1:-}"
CONV="${2:-univ8-$(date +%s)}"

if [[ -z "$MESSAGE" ]]; then
  cat <<'EOF'
Usage: enqueue.sh "What you want the agent to do" [conversation-name]

Examples:
  bash UNIV8/deploy/enqueue.sh "Fais une analyse des taches et devis"
  bash UNIV8/deploy/enqueue.sh "Reply only PONG" test-pong

Job params (JSON):
  type: agent.inject
  payload.message      (required) — instruction for the agent
  payload.conversation (optional) — session name
  payload.bridgeUrl    (optional) — default http://127.0.0.1:4440
  payload.model        (optional) — default opencode/nemotron-3-ultra-free
EOF
  exit 1
fi

BODY=$(MESSAGE="$MESSAGE" CONV="$CONV" node -e '
const m=process.env.MESSAGE, c=process.env.CONV;
process.stdout.write(JSON.stringify({
  type: "agent.inject",
  totalSteps: 2,
  payload: {
    message: m,
    conversation: c,
    bridgeUrl: process.env.BRIDGE_URL || "http://127.0.0.1:4440",
    model: process.env.OPENCODE_MODEL || "opencode/nemotron-3-ultra-free"
  }
}))
')

echo "[enqueue] POST $QUEUE_URL/api/jobs"
RESP=$(curl -sf -X POST "$QUEUE_URL/api/jobs" -H 'Content-Type: application/json' -d "$BODY")
echo "$RESP"
JOB_ID=$(echo "$RESP" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).job.id')
echo "[enqueue] Watching $JOB_ID ..."
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 2
  J=$(curl -sf "$QUEUE_URL/api/jobs/$JOB_ID")
  STATUS=$(echo "$J" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).job.status')
  echo "  [$i] $STATUS"
  if [[ "$STATUS" == "COMPLETED" || "$STATUS" == "FAILED" ]]; then
    echo "$J"
    exit 0
  fi
done
echo "[enqueue] still running — check: curl $QUEUE_URL/api/jobs/$JOB_ID"
