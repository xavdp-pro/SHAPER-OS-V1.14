#!/usr/bin/env bash
# ==============================================================================
# podman-up.sh — Bootstrap and start univ-pipeline-xav (GED + Pipeline + Cloudflare)
# ==============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIV="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$UNIV/.." && pwd)"

ENV_FILE="${1:-$HERE/env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[-] ERROR: env file missing: $ENV_FILE"
  echo "    Copy deploy/env.example to deploy/env and fill in required secrets."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

SLUG="${UNIV_SLUG:-univ-pipeline-xav}"
NET="host"

echo "=== Starting $SLUG (GED + Document Pipeline + Cloudflare) ==="

# 1. Create persistent storage directories
mkdir -p "$UNIV/sav/vault" "$UNIV/sav/logger" "$UNIV/sav/queue" "$UNIV/sav/ged" "$UNIV/sav/pipeline" "$UNIV/log"

# 2. Vault
echo "[podman-up] 1. Vault :$VAULT_PORT"
podman run -d --name "${SLUG}-vault" --network "$NET" --replace \
  -e VAULT_PORT="$VAULT_PORT" \
  -e VAULT_STORAGE_FILE="/sav/vault/secrets.enc" \
  -e VAULT_MASTER_KEY="$VAULT_MASTER_KEY" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  -v "$UNIV/sav/vault:/sav/vault:Z" \
  localhost/shaper-vault:latest

# 3. Logger
echo "[podman-up] 2. Logger :$LOGGER_PORT"
podman run -d --name "${SLUG}-logger" --network "$NET" --replace \
  -e LOGGER_PORT="$LOGGER_PORT" \
  -e LOG_FILE="/sav/logger/audit.jsonl" \
  -v "$UNIV/sav/logger:/sav/logger:Z" \
  localhost/shaper-logger:latest

# 4. Queue
echo "[podman-up] 3. Queue :$QUEUE_PORT"
podman run -d --name "${SLUG}-queue" --network "$NET" --replace \
  -e QUEUE_PORT="$QUEUE_PORT" \
  -e QUEUE_STORAGE_FILE="/sav/queue/jobs.jsonl" \
  -v "$UNIV/sav/queue:/sav/queue:Z" \
  localhost/shaper-queue:latest

# 5. Maestro
echo "[podman-up] 4. Maestro :$MAESTRO_PORT"
podman run -d --name "${SLUG}-maestro" --network "$NET" --replace \
  -e MAESTRO_PORT="$MAESTRO_PORT" \
  -e MAESTRO_AUTO_START=1 \
  -e VAULT_URL="http://127.0.0.1:$VAULT_PORT" \
  -e VAULT_TOKEN="$VAULT_TOKEN" \
  -e LOGGER_URL="http://127.0.0.1:$LOGGER_PORT" \
  -e MAESTRO_TASKS_FILE="/data/univ/tasks/maestro-tasks.json" \
  -v "$UNIV:/data/univ:Z" \
  localhost/shaper-maestro:latest

# 6. Document Pipeline (Tesseract 5.3.0 + Native pdftotext + OpenCode Vision)
echo "[podman-up] 5. Document Pipeline :$PIPELINE_PORT"
podman run -d --name "${SLUG}-pipeline" --network "$NET" --replace \
  -e PIPELINE_PORT="$PIPELINE_PORT" \
  -e NODE_ENV="production" \
  -v "$UNIV/sav/pipeline:/data/pipeline:Z" \
  -v "$REPO_ROOT/software/test-corpus:/test-corpus:ro,Z" \
  localhost/shaper-pipeline:latest

# 7. GED Engine (Web UI + CAS SHA-256 Storage + Analyze API)
echo "[podman-up] 6. GED Engine :$GED_PORT"
podman run -d --name "${SLUG}-ged" --network "$NET" --replace \
  -e GED_PORT="$GED_PORT" \
  -e GED_DATA_DIR="/data/ged" \
  -e OLLAMA_API_KEY="${OLLAMA_API_KEY:-}" \
  -e OLLAMA_CLOUD_API_KEY="${OLLAMA_CLOUD_API_KEY:-}" \
  -e OLLAMA_CLOUD_BASE_URL="${OLLAMA_CLOUD_BASE_URL:-https://ollama.com/v1}" \
  -v "$UNIV/sav/ged:/data/ged:Z" \
  localhost/shaper-ged:latest

# 8. Cloudflare Tunnel (Zero Trust Edge exposing ${SHAPER_PUBLIC_HOST})
if [[ -n "${CLOUDFLARE_GED_TUNNEL_TOKEN:-}" ]]; then
  echo "[podman-up] 7. Cloudflare Zero Trust Tunnel ($CLOUDFLARE_GED_HOSTNAME -> :$GED_PORT)"
  podman run -d --name "${SLUG}-cloudflared" --network "$NET" --replace \
    docker.io/cloudflare/cloudflared:latest \
    tunnel --no-autoupdate run --token "$CLOUDFLARE_GED_TUNNEL_TOKEN"
fi

echo ""
echo "[podman-up] Waiting 3s for services initialization..."
sleep 3

fail=0
check() {
  local url="$1"
  local name="$2"
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "  ✓ $name: OK ($url)"
  else
    echo "  ✗ $name: FAILED ($url)"
    fail=1
  fi
}

echo "[podman-up] Health verification:"
check "http://127.0.0.1:$VAULT_PORT/api/health" "Vault"
check "http://127.0.0.1:$LOGGER_PORT/api/health" "Logger"
check "http://127.0.0.1:$QUEUE_PORT/api/health" "Queue"
check "http://127.0.0.1:$MAESTRO_PORT/api/health" "Maestro"
check "http://127.0.0.1:$PIPELINE_PORT/api/health" "Document Pipeline"
check "http://127.0.0.1:$GED_PORT/api/health" "GED Engine"

if [[ $fail -eq 0 ]]; then
  echo ""
  echo "🎉 [podman-up] $SLUG is fully running and healthy!"
  echo "   → GED Local UI:     http://127.0.0.1:$GED_PORT"
  echo "   → GED Public Edge:  https://$CLOUDFLARE_GED_HOSTNAME"
  echo "   → Pipeline Engine:  http://127.0.0.1:$PIPELINE_PORT"
else
  echo ""
  echo "⚠️ [podman-up] One or more health checks failed."
  exit 1
fi
