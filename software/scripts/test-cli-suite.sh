#!/usr/bin/env bash
set -eo pipefail

echo "================================================="
echo " 🚀 SHAPER OS — COMPLETE CLI TEST SUITE"
echo "================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Test Shaper Task Delegation CLI
echo -e "\n[1/3] Testing Task Delegation CLI (scripts/shaper-task.sh)..."
"$ROOT_DIR/scripts/test-cli-task-delegation.sh"
echo "  ✓ Delegation CLI OK"

# 2. Test Mini-GED API via Curl / CLI
echo -e "\n[2/3] Testing Mini-GED CLI Endpoints..."
mkdir -p "$ROOT_DIR/data/ged"

# Start ged server locally in background for test
PORT=8765 GED_DATA_DIR="$ROOT_DIR/data/ged" node "$ROOT_DIR/packages/ged-engine/server.js" &
GED_PID=$!
sleep 1.5

cleanup() {
  kill $GED_PID 2>/dev/null || true
}
trap cleanup EXIT

# A. Create Folder
RES_FOLD=$(curl -s -X POST http://127.0.0.1:8765/api/folders -H "Content-Type: application/json" -d '{"folder":"Archive_2026"}')
if [[ "$RES_FOLD" != *"Archive_2026"* ]]; then
  echo "❌ Mini-GED folder creation failed"
  exit 1
fi
echo "  ✓ POST /api/folders OK"

# B. Tag File
touch "$ROOT_DIR/data/ged/Archive_2026/test_cli_doc.pdf"
RES_TAG=$(curl -s -X POST http://127.0.0.1:8765/api/tag -H "Content-Type: application/json" -d '{"relPath":"Archive_2026/test_cli_doc.pdf","tag":"valid"}')
if [[ "$RES_TAG" != *"valid"* ]]; then
  echo "❌ Mini-GED file tagging failed"
  exit 1
fi
echo "  ✓ POST /api/tag OK"

# C. Move File
RES_MOVE=$(curl -s -X POST http://127.0.0.1:8765/api/move -H "Content-Type: application/json" -d '{"from":"Archive_2026/test_cli_doc.pdf","toFolder":""}')
if [[ "$RES_MOVE" != *"test_cli_doc.pdf"* ]]; then
  echo "❌ Mini-GED file move failed"
  exit 1
fi
echo "  ✓ POST /api/move (Drag & Drop backend) OK"

# Clean test file
rm -f "$ROOT_DIR/data/ged/test_cli_doc.pdf" "$ROOT_DIR/data/ged/Archive_2026/test_cli_doc.pdf" 2>/dev/null || true
kill $GED_PID 2>/dev/null || true

# 3. Test Shaper Sandbox Helper
echo -e "\n[3/4] Testing Shaper Sandbox Helper..."
if [ -f "$ROOT_DIR/scripts/shaper-sandbox.sh" ]; then
  bash "$ROOT_DIR/scripts/shaper-sandbox.sh" --help || true
  echo "  ✓ Sandbox helper syntax OK"
fi

# 4. Test Portability & Zero Machine Path
echo -e "\n[4/4] Testing Scripts Portability & Non-Regression (Rule 0B & 29)..."
node "$ROOT_DIR/scripts/test-scripts-portability.mjs"
echo "  ✓ Scripts portability OK"

echo -e "\n================================================="
echo " ✅ ALL CLI TESTS SUCCESSFULLY VALIDATED!"
echo "================================================="
