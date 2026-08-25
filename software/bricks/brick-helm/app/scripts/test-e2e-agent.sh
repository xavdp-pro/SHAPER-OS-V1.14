#!/usr/bin/env bash
# Tests Playwright lents : envoie un vrai message à l'agent Cursor.
set -euo pipefail
cd "$(dirname "$0")/.."
export HELM_E2E_AGENT=1
exec bash scripts/test-e2e.sh e2e/agent.spec.js "$@"
