#!/usr/bin/env bash
# Intent: software/RULES.md#rule-10
# ==============================================================================
# backup-pra-sync.sh — AES-256 encrypted replication of backup to central DRP vault
# Usage:
#   bash scripts/backup-pra-sync.sh [--pra-target <ssh_or_path>]
# ==============================================================================
set -euo pipefail

SHAPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${SHAPER_DIR}/data/backups"
PRA_ENC_KEY="${PRA_ENCRYPTION_KEY:-${VAULT_MASTER_KEY:?Set PRA_ENCRYPTION_KEY or VAULT_MASTER_KEY}}"

# 1. Find the latest local backup
LATEST_BACKUP="$(ls -t "${BACKUP_DIR}"/backup_*.tar.gz 2>/dev/null | head -n1 || true)"

if [[ -z "$LATEST_BACKUP" || ! -f "$LATEST_BACKUP" ]]; then
  echo "[backup-pra-sync] No local backup found. Triggering fresh backup..."
  bash "${SHAPER_DIR}/scripts/backup-local.sh"
  LATEST_BACKUP="$(ls -t "${BACKUP_DIR}"/backup_*.tar.gz 2>/dev/null | head -n1)"
fi

ENC_DEST="${LATEST_BACKUP}.enc"

echo "[backup-pra-sync] 🔐 Encrypting snapshot with AES-256 for central DRP: ${LATEST_BACKUP}..."
openssl enc -aes-256-cbc -salt -pbkdf2 -in "$LATEST_BACKUP" -out "$ENC_DEST" -k "$PRA_ENC_KEY"

ENC_SIZE="$(du -h "$ENC_DEST" | cut -f1)"
echo "[backup-pra-sync] ✅ Encrypted snapshot ready: ${ENC_DEST} (${ENC_SIZE})"

# 2. Synchronize to remote DRP vault (if configured)
PRA_DEST_HOST="${PRA_DEST_HOST:-}"
if [[ -n "$PRA_DEST_HOST" ]]; then
  echo "[backup-pra-sync] 🚀 Sending to master DRP vault (${PRA_DEST_HOST})..."
  rsync -avz "$ENC_DEST" "${PRA_DEST_HOST}:/data/pra-vault/"
  echo "[backup-pra-sync] ✅ Snapshot replicated successfully to DRP vault!"
else
  echo "[backup-pra-sync] Note: PRA_DEST_HOST not configured (encrypted snapshot kept locally in data/backups/)."
fi

echo "{\"status\":\"ok\",\"service\":\"pra-sync-v1\",\"encryptedSnapshot\":\"${ENC_DEST}\",\"size\":\"${ENC_SIZE}\",\"timestamp\":\"$(date -Iseconds)\"}"
