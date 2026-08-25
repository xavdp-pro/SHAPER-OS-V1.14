#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for script in build-brick-vault build-brick-logger build-brick-bridge-agy build-brick-bridge-opencode build-brick-queue build-brick-maestro build-brick-helm; do
  bash "scripts/${script}.sh"
done
echo "[build-all-bricks] OK"
