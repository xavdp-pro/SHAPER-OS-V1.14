#!/usr/bin/env bash
# Quick Antigravity bridge diagnostic (host or container).
set -euo pipefail

BRIDGE_URL="${BRIDGE_URL:-http://127.0.0.1:4330}"
GEMINI_HOME="${AGY_GEMINI_HOME:-${HOME:-/root}/.gemini}"
CONFIG_HOME="${AGY_CONFIG_HOME:-${HOME:-/root}/.config}"

echo "=== bridge health ==="
curl -sf "$BRIDGE_URL/api/health" | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")),null,2)' || echo "FAIL: bridge unreachable"

echo ""
echo "=== bridge metrics ==="
curl -sf "$BRIDGE_URL/api/metrics" | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")),null,2)' 2>/dev/null || echo "(no metrics)"

echo ""
echo "=== host files ==="
for f in \
  /opt/bridge/antigravity/bin/agy \
  "$GEMINI_HOME/antigravity-cli/antigravity-oauth-token" \
  "$GEMINI_HOME/antigravity-cli/settings.json" \
  "$CONFIG_HOME/antigravity/credentials.json"; do
  if [[ -f "$f" ]]; then
    echo "OK  $f ($(stat -c '%U:%G %s' "$f" 2>/dev/null || ls -la "$f"))"
  else
    echo "MISS $f"
  fi
done

CLI_LOG="$GEMINI_HOME/antigravity-cli/cli.log"
if [[ -L "$CLI_LOG" || -f "$CLI_LOG" ]]; then
  echo ""
  echo "=== last agy errors (cli.log) ==="
  grep -E "quota|429|Print mode: run ended|Authentication" "$CLI_LOG" 2>/dev/null | tail -5 || echo "(no errors in log)"
fi
