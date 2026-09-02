#!/usr/bin/env bash
# Intent: software/RULES.md#rule-12
# ==============================================================================
# backup-local.sh — Sovereign daily local backup (data/backups/)
# Takes a full snapshot of persistent data:
# - MariaDB SQL dump (when the universe declares a database)
# - Mini-GED (data/ged)
# - Vault (data/vault)
# - Logger (data/logger)
# It never takes .env — see step 2 for why.
# ==============================================================================
set -euo pipefail

SHAPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${SHAPER_DIR}/data/backups"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
SNAPSHOT_NAME="backup_${TIMESTAMP}"
DEST_TAR="${BACKUP_DIR}/${SNAPSHOT_NAME}.tar.gz"
DUMP_DIR="${SHAPER_DIR}/data/_staging_dump"

# A backup that stopped half-way leaves nothing behind that could be mistaken
# for a backup: the staging dump goes, and so does a partial archive.
#
# A backup that stopped AFTER the archive was complete keeps it. The trap
# used to delete DEST_TAR on any non-zero exit, and the rotation step runs
# after the archive has been written, checksummed and announced: a `find`
# that could not run turned "Backup created" on the log into an empty
# directory on disk. ARCHIVE_COMPLETE is raised the moment the checksum is
# known, and from then on a failure is reported over an archive that stays.
ARCHIVE_COMPLETE=0
cleanup() {
  local rc=$?
  rm -rf "$DUMP_DIR"
  if [[ $rc -ne 0 ]]; then
    if [[ $ARCHIVE_COMPLETE -eq 1 && -f "$DEST_TAR" ]]; then
      echo "[backup-local] FAILED (exit ${rc}) after the archive was complete — ${DEST_TAR} was kept; what failed came after it." >&2
    else
      rm -f "$DEST_TAR"
      echo "[backup-local] FAILED (exit ${rc}) — no archive was kept." >&2
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"
rm -rf "$DUMP_DIR"

echo "[backup-local] Starting local backup: ${SNAPSHOT_NAME}..."

# 1. Dump MariaDB — honestly.
#
# Three things this step used to get wrong, each producing an archive that
# looked complete and was not:
#   - the password went to the client as `-p<password>`, on a command line
#     any user on the host reads through `ps` — it now travels in MYSQL_PWD,
#     which both clients read and no process listing shows;
#   - the client was hard-wired to one name: a Debian host installs
#     `mariadb-dump`, older images ship only `mysqldump`, and a script that
#     knows one of the two dumps nothing on the other — it now takes whichever
#     exists, in that order;
#   - the dump ended in `2>/dev/null || true`, so a refused connection wrote
#     an empty .sql and the archive shipped it as the database — a failing
#     dump now fails the backup, an empty dump too, and a universe with no
#     database says SKIP in so many words instead of pretending.
# The universe declares a database by setting MYSQL_USER (Rule 26: one MariaDB
# per universe). MYSQL_DATABASE narrows the dump to one schema; without it,
# every database the user can see is dumped.
DB_STATUS="skipped"
if [[ -z "${MYSQL_USER:-}" ]]; then
  echo "[backup-local] SKIP database dump: MYSQL_USER is not set — this universe declares no database (set MYSQL_USER and MYSQL_PASSWORD to include one)."
else
  : "${MYSQL_PASSWORD:?MYSQL_USER is set but MYSQL_PASSWORD is not — supply the database password; this repository ships none}"
  if command -v mariadb-dump >/dev/null 2>&1; then
    DUMP_CMD="mariadb-dump"
  elif command -v mysqldump >/dev/null 2>&1; then
    DUMP_CMD="mysqldump"
  else
    echo "[backup-local] MYSQL_USER is set but neither mariadb-dump nor mysqldump is installed — install mariadb-client, or unset MYSQL_USER if this universe has no database." >&2
    exit 1
  fi
  MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
  MYSQL_PORT="${MYSQL_PORT:-3306}"
  # The staging directory exists only when a dump is taken: created up front,
  # it went into every archive as an empty data/_staging_dump/ member.
  mkdir -p "$DUMP_DIR"
  DUMP_FILE="${DUMP_DIR}/${MYSQL_DATABASE:-all-databases}.sql"
  if [[ -n "${MYSQL_DATABASE:-}" ]]; then
    DUMP_SCOPE=("$MYSQL_DATABASE")
  else
    DUMP_SCOPE=(--all-databases)
  fi
  echo "[backup-local] Dumping ${DUMP_SCOPE[*]} with ${DUMP_CMD} from ${MYSQL_HOST}:${MYSQL_PORT}..."
  MYSQL_PWD="$MYSQL_PASSWORD" "$DUMP_CMD" -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" \
    --single-transaction "${DUMP_SCOPE[@]}" > "$DUMP_FILE"
  if [[ ! -s "$DUMP_FILE" ]]; then
    echo "[backup-local] ${DUMP_CMD} exited 0 but wrote an empty dump — refusing to archive an empty database as a backup." >&2
    exit 1
  fi
  DB_STATUS="dumped"
  echo "[backup-local] Database dumped: ${DUMP_FILE} ($(du -h "$DUMP_FILE" | cut -f1))."
fi

# 2. Archive the persistent data.
#
# .env is NOT in this archive, and must never be. It holds VAULT_MASTER_KEY,
# the key that decrypts data/vault/vault.enc — which IS in this archive. A
# backup carrying both the vault and the key that opens it is the vault in
# clear text for whoever holds the backup file. The secret that opens the
# coffer does not travel with the coffer: on restore, the key comes back from
# the operator's own key material (docs/human/KEYS-AND-ACCOUNTS.md), never
# from a backup. Until V1.13 this very command listed ${SHAPER_DIR}/.env as a
# member.
#
# .env has more than one spelling. Rule 0J propagates it as deploy/env,
# deploy/<slug>.env, and tooling adds .env.local, .env.production, .env.<slug>;
# every copy holds the same key. The exclusion is `.env*` and `*.env` — the
# first release excluded the bare `.env` and `*.env` only, and `.env.local`
# under data/ travelled with vault.enc.
#
# And tar's failure is the backup's failure: the command used to end in
# `2>/dev/null || true`, after which the script printed "Backup created" and
# {"status":"ok"} over a file tar had abandoned half-way (Rule 0G).
MEMBERS=(data/)
[[ -f "${SHAPER_DIR}/topology.json" ]] && MEMBERS+=(topology.json)
tar -czf "$DEST_TAR" \
  --exclude="data/backups" \
  --exclude="*.tmp" \
  --exclude="node_modules" \
  --exclude=".env*" \
  --exclude="*.env" \
  -C "$SHAPER_DIR" \
  "${MEMBERS[@]}"

SIZE="$(du -h "$DEST_TAR" | cut -f1)"
SHA256="$(sha256sum "$DEST_TAR" | awk '{print $1}')"
ARCHIVE_COMPLETE=1
echo "[backup-local] Backup created: ${DEST_TAR} (${SIZE}) SHA256: ${SHA256} — database: ${DB_STATUS}"

# 3. Rotate backups keeping the last 7 days. A rotation that cannot delete is
# a disk that fills up quietly, so it is not silenced either — and because the
# archive above is complete, its failure is reported over an archive that stays.
find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +7 -delete
echo "[backup-local] Rotation completed (7-day retention)."

# The status line describes a file that exists now, not one that existed a
# moment ago: a rotation with a broken clock could have eaten today's archive.
if [[ ! -f "$DEST_TAR" ]]; then
  echo "[backup-local] ${DEST_TAR} is gone after rotation — check the host clock and the retention rule; no status is reported for a file that is not there." >&2
  exit 1
fi
echo "{\"status\":\"ok\",\"snapshot\":\"${SNAPSHOT_NAME}\",\"path\":\"${DEST_TAR}\",\"size\":\"${SIZE}\",\"sha256\":\"${SHA256}\",\"database\":\"${DB_STATUS}\",\"timestamp\":\"$(date -Iseconds)\"}"
