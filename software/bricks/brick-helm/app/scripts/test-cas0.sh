#!/usr/bin/env bash
# Deploy agent-demo on cas0, run demo unit tests + Playwright against ${SHAPER_PUBLIC_HOST}
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Deploy cas0"
bash scripts/deploy-cas0.sh

echo "==> Unit tests (demo)"
npm test

echo "==> E2E agent-demo (cas0)"
export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:7923}"
exec npx playwright test e2e/demo.spec.js
