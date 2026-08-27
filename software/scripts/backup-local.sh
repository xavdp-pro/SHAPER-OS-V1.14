#!/usr/bin/env bash
# Intent: software/RULES.md#rule-10
# ==============================================================================
# backup-local.sh — Sovereign daily local backup (/data/backups/)
# Takes a full snapshot of persistent data:
# - MariaDB SQL Dump
# - Mini-GED (/data/ged)
# - Vault (/data/vault)
# - Logger (/data/logger)
# ==============================================================================
set -euo pipefail

SHAPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${SHAPER_DIR}/data/backups"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
SNAPSHOT_NAME="backup_${TIMESTAMP}"
DEST_TAR="${BACKUP_DIR}/${SNAPSHOT_NAME}.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup-local] 📦 Starting local backup: ${SNAPSHOT_NAME}..."

# 1. Dump MariaDB
DUMP_DIR="${SHAPER_DIR}/data/_staging_dump"
mkdir -p "$DUMP_DIR"
if command -v mariadb-dump &>/dev/null; then
  # The credential comes from the environment. It was a literal here, and this
  # repository was public — see univ-base/INTENT.md on what a published
  # credential is.
  : "${MYSQL_PASSWORD:?not set — supply the database password; this repository ships none}"
  mariadb-dump -h 127.0.0.1 -u "${MYSQL_USER:-helm_user}" -p"$MYSQL_PASSWORD" helm_db > "${DUMP_DIR}/helm_db.sql" 2>/dev/null || true
elif podman exec "${UNIV_SLUG:?set UNIV_SLUG}-helm" mariadb-dump -u "${MYSQL_USER:-helm_user}" -p"${MYSQL_PASSWORD:?not set}" helm_db > "${DUMP_DIR}/helm_db.sql" 2>/dev/null; then
  echo "[backup-local] MariaDB dump successfully extracted via Podman."
else
  echo "[backup-local] Note: MariaDB dump not directly available."
fi

# 2. Full archive of persistent data (/data and /root/SHAPER-OS/data)
cd "$SHAPER_DIR"
tar -czf "$DEST_TAR" \
  --exclude="data/backups" \
  --exclude="*.tmp" \
  --exclude="node_modules" \
  -C "$SHAPER_DIR" \
  data/ \
  ${SHAPER_DIR}/.env \
  ${SHAPER_DIR}/topology.json \
  2>/dev/null || true

rm -rf "$DUMP_DIR"

SIZE="$(du -h "$DEST_TAR" | cut -f1)"
SHA256="$(sha256sum "$DEST_TAR" | awk '{print $1}')"
echo "[backup-local] ✅ Backup created: ${DEST_TAR} (${SIZE}) SHA256: ${SHA256}"

# 3. Rotate backups keeping the last 7 days
find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +7 -delete 2>/dev/null || true
echo "[backup-local] 🧹 Rotation completed (7-day retention)."

echo "{\"status\":\"ok\",\"snapshot\":\"${SNAPSHOT_NAME}\",\"path\":\"${DEST_TAR}\",\"size\":\"${SIZE}\",\"timestamp\":\"$(date -Iseconds)\"}"
