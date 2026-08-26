#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
fi
exec node "$ROOT/server.mjs"
