#!/usr/bin/env bash
# Copy working agy OAuth session from gbs-tools helm-v2 → local AGY_HOME.
set -euo pipefail

SRC_HOST="${AGY_SYNC_SRC:-gbs-tools}"
SRC_HOME="${AGY_SYNC_SRC_HOME:-/apps/helm-v2}"
DEST_HOME="${AGY_HOME:-/root}"

mkdir -p "$DEST_HOME/.gemini/antigravity-cli" "$DEST_HOME/.config/antigravity"

copy_remote() {
  local rel="$1"
  local dest="$2"
  if scp -q "${SRC_HOST}:${SRC_HOME}/${rel}" "$dest" 2>/dev/null; then
    return 0
  fi
  # Fallback when univ7 cannot scp directly to gbs-tools
  ssh "$SRC_HOST" "cat '${SRC_HOME}/${rel}'" > "$dest"
}

copy_remote ".gemini/antigravity-cli/antigravity-oauth-token" \
  "$DEST_HOME/.gemini/antigravity-cli/antigravity-oauth-token"
copy_remote ".gemini/antigravity-cli/settings.json" \
  "$DEST_HOME/.gemini/antigravity-cli/settings.json" || true
copy_remote ".config/antigravity/credentials.json" \
  "$DEST_HOME/.config/antigravity/credentials.json" || true
if scp -q "${SRC_HOST}:${SRC_HOME}/.gemini/jetski-standalone-oauth-token" \
  "$DEST_HOME/.gemini/" 2>/dev/null; then
  :
else
  ssh "$SRC_HOST" "cat '${SRC_HOME}/.gemini/jetski-standalone-oauth-token'" \
    > "$DEST_HOME/.gemini/jetski-standalone-oauth-token" 2>/dev/null || true
fi

chmod 600 "$DEST_HOME/.gemini/antigravity-cli/antigravity-oauth-token" 2>/dev/null || true
chmod 600 "$DEST_HOME/.config/antigravity/credentials.json" 2>/dev/null || true
if [[ "$(id -u)" -eq 0 ]]; then
  chown -R root:root "$DEST_HOME/.gemini" "$DEST_HOME/.config/antigravity" 2>/dev/null || true
fi
echo "[sync-agy-session-from-gbs-tools] OK — $DEST_HOME (from ${SRC_HOST}:${SRC_HOME})"
