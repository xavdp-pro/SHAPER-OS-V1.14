#!/usr/bin/env bash
# Intent: software/RULES.md#rule-10
set -euo pipefail

UNIV_DIR="${1:-}"
SNAPSHOT_TAG="${2:-checkpoint}"

if [[ -z "$UNIV_DIR" || ! -d "$UNIV_DIR" ]]; then
  echo "Usage: bash scripts/snapshot-universe.sh <universe_path> [tag]"
  echo "Example: bash scripts/snapshot-universe.sh /path/to/UNIV8 exp-001-pass"
  exit 1
fi

UNIV_NAME="$(basename "$UNIV_DIR")"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
SNAPSHOT_FILE="${UNIV_DIR}/sav/snapshots/${UNIV_NAME}_${SNAPSHOT_TAG}_${TIMESTAMP}.tar.gz"

mkdir -p "${UNIV_DIR}/sav/snapshots"

echo "[snapshot] Creating snapshot for ${UNIV_NAME} (tag: ${SNAPSHOT_TAG})..."

# 1. Dump MariaDB if available
if command -v mariadb-dump >/dev/null 2>&1 || command -v mysqldump >/dev/null 2>&1; then
  DUMP_CMD="mysqldump"
  command -v mariadb-dump >/dev/null 2>&1 && DUMP_CMD="mariadb-dump"
  mkdir -p "${UNIV_DIR}/sav/db"
  $DUMP_CMD -u root --all-databases 2>/dev/null > "${UNIV_DIR}/sav/db/dump_auto_${TIMESTAMP}.sql" || true
fi

# 2. Archive complete state
tar --exclude='sav/snapshots' \
    --exclude='node_modules' \
    --exclude='.git' \
    -czf "$SNAPSHOT_FILE" \
    -C "$(dirname "$UNIV_DIR")" \
    "$UNIV_NAME"

echo "[snapshot] OK — Snapshot saved to:"
echo "  -> $SNAPSHOT_FILE"
