#!/usr/bin/env bash
# KovZu — Claude Code natif + Remote Control (app mobile Claude, sans LiteLLM).
#
#   npm run claude:remote              # Sonnet, mode serveur (QR + liste mobile)
#   npm run claude:remote -- opus      # Opus
#   npm run claude:remote -- sonnet -i # Interactif terminal + mobile
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash /opt/bridge/claude/scripts/native-remote-control.sh "$@" "$APP_ROOT"
