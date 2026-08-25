#!/usr/bin/env bash
# Safe sync h1 → cas0 demo host. NEVER overwrite host secrets (.env).
set -euo pipefail

SRC="${1:-/apps/helm-v2/app/}"
DEST="${2:-gbs-cas0:/apps/helm-v2/app/}"

rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .env \
  --exclude .env.* \
  --exclude etc \
  --exclude logs \
  --exclude tmp \
  --exclude data \
  --exclude dist \
  --exclude '.pm2' \
  --exclude 'core*' \
  --exclude nosav \
  "$SRC" "$DEST"

echo "Synced $SRC → $DEST (secrets .env excluded)"
