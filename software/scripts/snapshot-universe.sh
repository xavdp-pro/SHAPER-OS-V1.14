#!/usr/bin/env bash
# Intent: software/RULES.md#rule-12
set -euo pipefail

UNIV_DIR="${1:-}"
SNAPSHOT_TAG="${2:-checkpoint}"

if [[ -z "$UNIV_DIR" || ! -d "$UNIV_DIR" ]]; then
  echo "Usage: bash scripts/snapshot-universe.sh <universe_path> [tag]"
  echo "Example: bash scripts/snapshot-universe.sh /path/to/UNIV8 exp-001-pass"
  exit 1
fi

UNIV_DIR="$(cd "$UNIV_DIR" && pwd)"
UNIV_NAME="$(basename "$UNIV_DIR")"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
SNAPSHOT_FILE="${UNIV_DIR}/sav/snapshots/${UNIV_NAME}_${SNAPSHOT_TAG}_${TIMESTAMP}.tar.gz"

mkdir -p "${UNIV_DIR}/sav/snapshots"

# A snapshot that stopped half-way leaves no file that could pass for one —
# neither the archive nor the dump. The dump is written under a .part name
# and renamed only once it has a size; whatever is still .part when the
# script exits was never a dump. Until V1.13.3 the trap removed only the
# archive: a client that died half-way left sav/db/dump_auto_<ts>.sql
# truncated on disk, and the next snapshot — a SKIP one included — archived
# it as the database; two runs in the same second even overwrote a good dump
# with the partial one.
DUMP_PART=""
cleanup() {
  local rc=$?
  if [[ -n "$DUMP_PART" ]]; then
    rm -f "$DUMP_PART"
  fi
  if [[ $rc -ne 0 ]]; then
    rm -f "$SNAPSHOT_FILE"
    echo "[snapshot] FAILED (exit ${rc}) — no snapshot was kept." >&2
  fi
  exit "$rc"
}
trap cleanup EXIT

echo "[snapshot] Creating snapshot for ${UNIV_NAME} (tag: ${SNAPSHOT_TAG})..."

# 1. Dump MariaDB — honestly.
#
# This step used to be `$DUMP_CMD -u root --all-databases 2>/dev/null > file
# || true`: an unquoted command, no password at all, errors discarded, and a
# zero-byte .sql archived as the database when root was refused — which on a
# universe following Rule 26 it always is. Now the universe declares its
# database by setting MYSQL_USER; the password travels in MYSQL_PWD, never on
# the command line; the client is mariadb-dump, or mysqldump where only that
# exists; a failing or empty dump fails the snapshot; and a universe with no
# database says SKIP instead of pretending. Same contract as backup-local.sh.
DB_STATUS="skipped"
if [[ -z "${MYSQL_USER:-}" ]]; then
  echo "[snapshot] SKIP database dump: MYSQL_USER is not set — this universe declares no database (set MYSQL_USER and MYSQL_PASSWORD to include one)."
else
  : "${MYSQL_PASSWORD:?MYSQL_USER is set but MYSQL_PASSWORD is not — supply the database password; this repository ships none}"
  if command -v mariadb-dump >/dev/null 2>&1; then
    DUMP_CMD="mariadb-dump"
  elif command -v mysqldump >/dev/null 2>&1; then
    DUMP_CMD="mysqldump"
  else
    echo "[snapshot] MYSQL_USER is set but neither mariadb-dump nor mysqldump is installed — install mariadb-client, or unset MYSQL_USER if this universe has no database." >&2
    exit 1
  fi
  MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
  MYSQL_PORT="${MYSQL_PORT:-3306}"
  if [[ -n "${MYSQL_DATABASE:-}" ]]; then
    DUMP_SCOPE=("$MYSQL_DATABASE")
  else
    DUMP_SCOPE=(--all-databases)
  fi
  mkdir -p "${UNIV_DIR}/sav/db"
  DUMP_FILE="${UNIV_DIR}/sav/db/dump_auto_${TIMESTAMP}.sql"
  DUMP_PART="${DUMP_FILE}.part"
  echo "[snapshot] Dumping ${DUMP_SCOPE[*]} with ${DUMP_CMD} from ${MYSQL_HOST}:${MYSQL_PORT}..."
  MYSQL_PWD="$MYSQL_PASSWORD" "$DUMP_CMD" -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" \
    --single-transaction "${DUMP_SCOPE[@]}" > "$DUMP_PART"
  if [[ ! -s "$DUMP_PART" ]]; then
    echo "[snapshot] ${DUMP_CMD} exited 0 but wrote an empty dump — refusing to archive an empty database as a snapshot." >&2
    exit 1
  fi
  mv "$DUMP_PART" "$DUMP_FILE"
  DUMP_PART=""
  DB_STATUS="dumped"
  echo "[snapshot] Database dumped: ${DUMP_FILE}."
fi

# 2. Archive complete state. tar's failure is the snapshot's failure (set -e).
tar --exclude='sav/snapshots' \
    --exclude='node_modules' \
    --exclude='.git' \
    -czf "$SNAPSHOT_FILE" \
    -C "$(dirname "$UNIV_DIR")" \
    "$UNIV_NAME"

echo "[snapshot] OK — Snapshot saved (database: ${DB_STATUS}):"
echo "  -> $SNAPSHOT_FILE"
