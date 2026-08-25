#!/usr/bin/env bash
# Sync helm-v2 → gbs-cas0 (agent-demo) and reload PM2. Never overwrites .env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/sync-cas0.sh"
ssh gbs-cas0 "cd /apps/helm-v2/app && npm ci && npm run deploy"
echo "Deployed on cas0 — http://127.0.0.1:7923"
