#!/usr/bin/env bash
set -euo pipefail

SHAPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_PORT=8649
export SHAPER_QUEUE_URL="http://127.0.0.1:${TEST_PORT}"

echo "[test-cli] 1. Starting test Queue server on :${TEST_PORT}..."
node --input-type=module -e "
import { createQueueServer } from '${SHAPER_DIR}/packages/queue/index.js';
const s = createQueueServer({ port: ${TEST_PORT} });
s.on('listening', () => console.log('QUEUE_READY'));
" &
QUEUE_PID=$!

trap "kill $QUEUE_PID 2>/dev/null || true" EXIT

# Wait for queue to be ready
for i in {1..20}; do
  if curl -s "http://127.0.0.1:${TEST_PORT}/api/health" &>/dev/null; then
    break
  fi
  sleep 0.2
done

echo "[test-cli] 2. Enqueuing task via shaper-task.sh..."
ENQUEUE_RES="$(bash "${SHAPER_DIR}/scripts/shaper-task.sh" enqueue --type "batch_compta" --payload '{"client":"Dupont","docs":50}')"
echo "Enqueue Output: $ENQUEUE_RES"

JOB_ID="$(node -e "console.log(JSON.parse(process.argv[1]).job.id)" "$ENQUEUE_RES")"
echo "Created Job ID: $JOB_ID"

echo "[test-cli] 3. Simulating background worker processing task..."
(
  sleep 1
  curl -s -X PATCH "http://127.0.0.1:${TEST_PORT}/api/jobs/${JOB_ID}" \
    -H "Content-Type: application/json" \
    -d '{"status":"RUNNING","progress":50,"step":1}' > /dev/null
  sleep 1
  curl -s -X PATCH "http://127.0.0.1:${TEST_PORT}/api/jobs/${JOB_ID}" \
    -H "Content-Type: application/json" \
    -d '{"status":"COMPLETED","progress":100,"step":2,"result":{"file":"/data/ged/Bilan_Dupont.xlsx","totalRows":250}}' > /dev/null
) &

echo "[test-cli] 4. Asynchronously waiting for result via shaper-task.sh wait..."
WAIT_RES="$(bash "${SHAPER_DIR}/scripts/shaper-task.sh" wait --id "$JOB_ID" --timeout 10)"
echo "Wait Result: $WAIT_RES"

STATUS="$(node -e "console.log(JSON.parse(process.argv[1]).job.status)" "$WAIT_RES")"
FILE="$(node -e "console.log(JSON.parse(process.argv[1]).job.result.file)" "$WAIT_RES")"

if [[ "$STATUS" == "COMPLETED" && "$FILE" == "/data/ged/Bilan_Dupont.xlsx" ]]; then
  echo "✅ [test-cli] SUCCESS: Task delegated and result retrieved successfully!"
else
  echo "❌ [test-cli] FAILED: Unexpected result ($STATUS, $FILE)"
  exit 1
fi
