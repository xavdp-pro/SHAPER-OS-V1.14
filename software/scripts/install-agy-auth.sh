#!/usr/bin/env bash
# Headless agy auth: OAuth token + credentials.json + settings (no modelProvider: gemini).
set -euo pipefail

SHAPER="$(cd "$(dirname "$0")/.." && pwd)"
GEMINI_SRC="${GEMINI_SRC:-$HOME/.gemini}"
DEST_GEMINI="${AGY_GEMINI_HOME:-${HOME:-/root}/.gemini}"
DEST_CONFIG="${AGY_CONFIG_HOME:-${HOME:-/root}/.config}/antigravity"
TOKEN_SRC="$GEMINI_SRC/antigravity-cli/antigravity-oauth-token"

if [[ -z "${ANTIGRAVITY_API_KEY:-}" && -z "${AGY_API_KEY:-}" ]]; then
  for f in "$SHAPER/../../REMOTE/helm.env" "$SHAPER/../../REMOTE/antigravity-bridge.env"; do
    if [[ -f "$f" ]]; then
      ANTIGRAVITY_API_KEY="$(grep -E '^ANTIGRAVITY_API_KEY=' "$f" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
      AGY_API_KEY="$(grep -E '^AGY_API_KEY=' "$f" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
      break
    fi
  done
fi
AGY_KEY="${ANTIGRAVITY_API_KEY:-${AGY_API_KEY:-}}"
if [[ -z "$AGY_KEY" && -f "$SHAPER/.env" ]]; then
  AGY_KEY="$(node "$SHAPER/scripts/read-vault-secret.mjs" 'secret/agy/api-key' 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.key||'')}catch{}})" || true)"
fi
if [[ -z "$AGY_KEY" ]]; then
  echo "[install-agy-auth] Missing ANTIGRAVITY_API_KEY (AQ.*)"
  exit 1
fi

if [[ -f "$TOKEN_SRC" ]]; then
  mkdir -p "$DEST_GEMINI/antigravity-cli"
  install -m 0600 "$TOKEN_SRC" "$DEST_GEMINI/antigravity-cli/antigravity-oauth-token"
  if [[ -f "$GEMINI_SRC/jetski-standalone-oauth-token" ]]; then
    install -m 0600 "$GEMINI_SRC/jetski-standalone-oauth-token" "$DEST_GEMINI/jetski-standalone-oauth-token"
  fi
else
  echo "[install-agy-auth] WARN: no OAuth token at $TOKEN_SRC (agy may require login)"
fi

mkdir -p "$DEST_CONFIG" "$DEST_GEMINI/antigravity-cli"
node - "$DEST_CONFIG/credentials.json" "$AGY_KEY" <<'NODE'
import fs from 'node:fs';
const [file, key] = process.argv.slice(2);
fs.writeFileSync(file, JSON.stringify({ api_key: key }, null, 2) + '\n', { mode: 0o600 });
NODE

node - "$DEST_GEMINI/antigravity-cli/settings.json" <<'NODE'
import fs from 'node:fs';
const file = process.argv[2];
let base = {};
if (fs.existsSync(file)) {
  try { base = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fresh */ }
}
delete base.modelProvider;
const settings = {
  ...base,
  dangerouslySkipPermissions: true,
  effort: 'low',
  model: 'gemini-3.7-flash-low',
  outputFormat: 'stream-json',
};
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
NODE

echo "[install-agy-auth] OK — gemini=$DEST_GEMINI config=$DEST_CONFIG (AQ key, no GEMINI_API_KEY)"
