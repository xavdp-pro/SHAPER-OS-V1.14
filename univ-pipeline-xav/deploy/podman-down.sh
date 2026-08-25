#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-$HERE/env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

SLUG="${UNIV_SLUG:-univ-pipeline-xav}"

echo "=== Stopping $SLUG containers ==="

containers=(
  "${SLUG}-cloudflared"
  "${SLUG}-ged"
  "${SLUG}-pipeline"
  "${SLUG}-maestro"
  "${SLUG}-queue"
  "${SLUG}-logger"
  "${SLUG}-vault"
)

for c in "${containers[@]}"; do
  if podman container exists "$c" 2>/dev/null; then
    echo "  Stopping $c..."
    podman stop -t 2 "$c" 2>/dev/null || true
    podman rm -f "$c" 2>/dev/null || true
  fi
done

echo "=== $SLUG stopped ==="
