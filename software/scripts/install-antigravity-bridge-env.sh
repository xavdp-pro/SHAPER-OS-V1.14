#!/usr/bin/env bash
# Align host agy layout with gbs-tools /opt/bridge/antigravity (reference: helm-v2).
set -euo pipefail

SHAPER="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE_DIR="${OPT_BRIDGE_ROOT:-/opt/bridge}/antigravity"
AGY_HOME="${AGY_HOME:-${HOME:-/root}}"
MODEL="${ANTIGRAVITY_MODEL:-gemini-3.6-flash-low}"

if [[ -z "${ANTIGRAVITY_API_KEY:-}" ]]; then
  for f in "$SHAPER/../../REMOTE/helm.env" "$SHAPER/../../REMOTE/antigravity-bridge.env"; do
    if [[ -f "$f" ]]; then
      ANTIGRAVITY_API_KEY="$(grep -E '^ANTIGRAVITY_API_KEY=' "$f" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
      [[ -z "$ANTIGRAVITY_API_KEY" ]] && ANTIGRAVITY_API_KEY="$(grep -E '^AGY_API_KEY=' "$f" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
      break
    fi
  done
fi
if [[ -z "${ANTIGRAVITY_API_KEY:-}" ]]; then
  ANTIGRAVITY_API_KEY="$(node "$SHAPER/scripts/read-vault-secret.mjs" 'secret/agy/api-key' 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.key||'')}catch{}})" || true)"
fi
if [[ -z "${ANTIGRAVITY_API_KEY:-}" || "${ANTIGRAVITY_API_KEY:0:3}" != "AQ." ]]; then
  echo "[install-antigravity-bridge-env] Missing ANTIGRAVITY_API_KEY (AQ.*)"
  exit 1
fi

mkdir -p "$BRIDGE_DIR/bin" "$AGY_HOME/.gemini/antigravity-cli" "$AGY_HOME/.config/antigravity"
cat > "$BRIDGE_DIR/.env" <<EOF
ANTIGRAVITY_BRIDGE_PORT=4330
ANTIGRAVITY_BRIDGE_BIND=127.0.0.1
ANTIGRAVITY_BIN=$BRIDGE_DIR/bin/agy
ANTIGRAVITY_WS_BASE=${ANTIGRAVITY_WS_BASE:-$SHAPER/sav/agy-ws}
ANTIGRAVITY_MODEL=$MODEL
ANTIGRAVITY_API_KEY=$ANTIGRAVITY_API_KEY
EOF
chmod 600 "$BRIDGE_DIR/.env"

node - "$AGY_HOME/.config/antigravity/credentials.json" "$ANTIGRAVITY_API_KEY" <<'NODE'
import fs from 'node:fs';
const [file, key] = process.argv.slice(2);
fs.writeFileSync(file, JSON.stringify({ api_key: key }, null, 2) + '\n', { mode: 0o600 });
NODE

node - "$AGY_HOME/.gemini/antigravity-cli/settings.json" "$MODEL" <<'NODE'
import fs from 'node:fs';
const file = process.argv[2];
const model = process.argv[3];
const settings = {
  dangerouslySkipPermissions: true,
  effort: 'low',
  model,
  outputFormat: 'stream-json',
};
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
NODE

echo "[install-antigravity-bridge-env] OK — $BRIDGE_DIR/.env (ANTIGRAVITY only, model=$MODEL)"
