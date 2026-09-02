#!/usr/bin/env bash
# Intent: software/RULES.md#rule-12
# ==============================================================================
# backup-pra-sync.sh — AES-256 encrypted replication of backup to central DRP vault
# Usage:
#   PRA_ENCRYPTION_KEY=<backup-only key> bash scripts/backup-pra-sync.sh
# ==============================================================================
set -euo pipefail

SHAPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${SHAPER_DIR}/data/backups"

# The archive is encrypted with PRA_ENCRYPTION_KEY, and with nothing else.
#
# Until V1.13 this script fell back to VAULT_MASTER_KEY when no PRA key was
# set — which made the vault's master key the backup's key: whoever broke one
# backup held the key to every vault.enc inside it. The key is generated for
# backups and for nothing else (openssl rand -hex 32), it is required, and it
# is refused when it is the vault key. And it reaches openssl through the
# environment: as `-k <key>` it sat on the command line, readable by every
# process on the host through `ps` for the whole encryption.
: "${PRA_ENCRYPTION_KEY:?set PRA_ENCRYPTION_KEY to a key generated for backups only (openssl rand -hex 32) — never the vault master key; this repository ships none}"

# The vault key is looked for wherever it lives, not only in the environment.
# A cron job never sources .env, and the first release compared the PRA key
# with VAULT_MASTER_KEY only when that variable was exported: an operator who
# reused the vault key ran through unseen whenever the key sat in the .env
# beside this script — which is where Rule 0J puts it. The .env files are
# read line by line, never sourced: a backup script does not execute the
# operator's environment file.
refuse_if_vault_key() {
  local candidate="$1" where="$2"
  if [[ -n "$candidate" && "$PRA_ENCRYPTION_KEY" == "$candidate" ]]; then
    echo "[backup-pra-sync] REFUSED: PRA_ENCRYPTION_KEY must not be the vault master key (it equals VAULT_MASTER_KEY from ${where}) — a backup encrypted with VAULT_MASTER_KEY hands the vault's key to whoever holds the backup. Generate a separate key: openssl rand -hex 32" >&2
    exit 1
  fi
}
vault_key_in_file() {
  local file="$1" line value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#export }"
    case "$line" in
      VAULT_MASTER_KEY=*)
        value="${line#VAULT_MASTER_KEY=}"
        value="${value#\"}"; value="${value%\"}"
        value="${value#\'}"; value="${value%\'}"
        printf '%s\n' "$value"
        ;;
    esac
  done < "$file"
}
refuse_if_vault_key "${VAULT_MASTER_KEY:-}" "the environment"
for ENV_FILE in "${SHAPER_DIR}/.env" "${SHAPER_DIR}/../.env"; do
  [[ -f "$ENV_FILE" ]] || continue
  while IFS= read -r KEY_ON_DISK; do
    refuse_if_vault_key "$KEY_ON_DISK" "$ENV_FILE"
  done < <(vault_key_in_file "$ENV_FILE")
done
export PRA_ENCRYPTION_KEY

# 1. Find the latest local backup — or make one. No `ls | head || true`: an
# empty directory is a case this script handles, not an error it hides.
latest_backup() {
  local candidates=()
  shopt -s nullglob
  candidates=("${BACKUP_DIR}"/backup_*.tar.gz)
  shopt -u nullglob
  [[ ${#candidates[@]} -eq 0 ]] && return 0
  ls -t "${candidates[@]}" | head -n1
}

LATEST_BACKUP="$(latest_backup)"
if [[ -z "$LATEST_BACKUP" ]]; then
  echo "[backup-pra-sync] No local backup found. Triggering fresh backup..."
  bash "${SHAPER_DIR}/scripts/backup-local.sh"
  LATEST_BACKUP="$(latest_backup)"
  if [[ -z "$LATEST_BACKUP" ]]; then
    echo "[backup-pra-sync] backup-local.sh returned 0 and left no archive in ${BACKUP_DIR} — nothing to encrypt." >&2
    exit 1
  fi
fi

ENC_DEST="${LATEST_BACKUP}.enc"

echo "[backup-pra-sync] Encrypting snapshot with AES-256 for central DRP: ${LATEST_BACKUP}..."
openssl enc -aes-256-cbc -salt -pbkdf2 -in "$LATEST_BACKUP" -out "$ENC_DEST" -pass env:PRA_ENCRYPTION_KEY

ENC_SIZE="$(du -h "$ENC_DEST" | cut -f1)"
echo "[backup-pra-sync] Encrypted snapshot ready: ${ENC_DEST} (${ENC_SIZE})"

# 2. Synchronize to remote DRP vault (if configured)
PRA_DEST_HOST="${PRA_DEST_HOST:-}"
REPLICATED="false"
if [[ -n "$PRA_DEST_HOST" ]]; then
  echo "[backup-pra-sync] Sending to master DRP vault (${PRA_DEST_HOST})..."
  rsync -avz "$ENC_DEST" "${PRA_DEST_HOST}:/data/pra-vault/"
  REPLICATED="true"
  echo "[backup-pra-sync] Snapshot replicated to DRP vault."
else
  echo "[backup-pra-sync] Note: PRA_DEST_HOST not configured (encrypted snapshot kept locally in data/backups/, NOT replicated)."
fi

echo "{\"status\":\"ok\",\"service\":\"pra-sync-v1\",\"encryptedSnapshot\":\"${ENC_DEST}\",\"size\":\"${ENC_SIZE}\",\"replicated\":${REPLICATED},\"timestamp\":\"$(date -Iseconds)\"}"
