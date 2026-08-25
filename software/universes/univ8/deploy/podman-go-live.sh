#!/usr/bin/env bash
# univ8 — live mode: real IMAP + agy key in vault (bridge stub if agy CLI missing).
set -euo pipefail

UNIV8="$(cd "$(dirname "$0")/.." && pwd)"
SHAPER="$(cd "$UNIV8/../SHAPER-OS" && pwd)"
ENV_FILE="${ENV_FILE:-$SHAPER/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

load_remote_agy_keys() {
  for f in "$SHAPER/../../REMOTE/helm.env" "$SHAPER/../../REMOTE/antigravity-bridge.env"; do
    if [[ -f "$f" ]]; then
      ANTIGRAVITY_API_KEY="$(grep -E '^ANTIGRAVITY_API_KEY=' "$f" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
      AGY_API_KEY="$(grep -E '^AGY_API_KEY=' "$f" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
      export ANTIGRAVITY_API_KEY AGY_API_KEY
      return 0
    fi
  done
  return 1
}

# REMOTE helm.env = source of truth for authorized Antigravity key
if [[ -f "$SHAPER/../../REMOTE/helm.env" ]]; then
  node "$SHAPER/scripts/sync-agy-key-from-remote.mjs"
fi
if load_remote_agy_keys; then
  echo "[go-live] AGY key from REMOTE/helm.env"
elif [[ -z "${ANTIGRAVITY_API_KEY:-}" && -z "${AGY_API_KEY:-}" ]]; then
  :
fi

AGY_KEY="${ANTIGRAVITY_API_KEY:-${AGY_API_KEY:-}}"
if [[ -z "$AGY_KEY" ]]; then
  AGY_KEY="$(node "$SHAPER/scripts/read-vault-secret.mjs" 'secret/agy/api-key' 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.key||'')}catch{}})" || true)"
fi
if [[ -n "$AGY_KEY" ]]; then
  export ANTIGRAVITY_API_KEY="$AGY_KEY"
  unset GEMINI_API_KEY GOOGLE_API_KEY AGY_API_KEY
  echo "[go-live] Updating vault secret/agy/api-key..."
  node "$SHAPER/scripts/patch-vault-secret.mjs" 'secret/agy/api-key' \
    "$(node -e "console.log(JSON.stringify({provider:'antigravity',key:process.argv[1]}))" "$AGY_KEY")"
fi

export MAIL_AGENT_STUB=0
export BRIDGE_AGY_STUB=0
export BRIDGE_OPENCODE_STUB=0

AGY_HOST_BIN="${AGY_INSTALL_DIR:-/opt/bridge/antigravity/bin}/agy"
if [[ ! -x "$AGY_HOST_BIN" ]] && ! command -v agy >/dev/null 2>&1; then
  echo "[go-live] WARN: agy absent — BRIDGE_AGY_STUB=1"
  export BRIDGE_AGY_STUB=1
fi

OC_HOST_BIN="${OPENCODE_INSTALL_DIR:-/opt/bridge/opencode/bin}/opencode"
if [[ ! -x "$OC_HOST_BIN" ]]; then
  if [[ -x "${HOME}/.opencode/bin/opencode" ]]; then
    bash "$SHAPER/scripts/install-opencode.sh" "${HOME}/.opencode/bin/opencode" || true
  else
    echo "[go-live] WARN: opencode absent — installing..."
    bash "$SHAPER/scripts/install-opencode.sh" || true
  fi
fi
if [[ ! -x "$OC_HOST_BIN" ]]; then
  echo "[go-live] WARN: opencode still missing — BRIDGE_OPENCODE_STUB=1"
  export BRIDGE_OPENCODE_STUB=1
fi

echo "[go-live] BRIDGE_AGY_STUB=$BRIDGE_AGY_STUB MAIL_AGENT_STUB=$MAIL_AGENT_STUB"
if [[ -x "${AGY_INSTALL_DIR:-/opt/bridge/antigravity/bin}/agy" ]]; then
  bash "$SHAPER/scripts/install-antigravity-bridge-env.sh" || true
  if ssh -o ConnectTimeout=3 gbs-tools true 2>/dev/null; then
    bash "$SHAPER/scripts/sync-agy-session-from-gbs-tools.sh" || true
  else
    bash "$SHAPER/scripts/install-agy-auth.sh" || true
  fi
fi
bash "$UNIV8/deploy/podman-up.sh"

echo ""
echo "[go-live] Triggering mail beat..."
sleep 2
curl -sf -X POST "http://127.0.0.1:8530/api/pods/mail-contact-zoutik-shop/tick"
echo ""
curl -sf "http://127.0.0.1:8520/api/events/last?pod=mail-contact-zoutik-shop&limit=8"
echo ""
