#!/usr/bin/env bash
# univ-demo — restore playground at 02:00 (Europe/Paris).
set -euo pipefail

UNIV_ROOT="${UNIV_DEMO_ROOT:-/apps/univ-demo}"
KIT="${UNIV_ROOT}/kit"
LOG="${UNIV_ROOT}/log/nightly-restore.log"
mkdir -p "$(dirname "$LOG")"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }

log "=== univ-demo nightly restore start ==="

# Podman Helm + embedded MariaDB
REF="${UNIV_ROOT}/sav/db-reference/univ-demo.sql.gz"
LEGACY_REF="/apps/demo-agent-v3/sav/db-reference/demo-agent-v3.sql.gz"
MDB_DIR="${UNIV_ROOT}/sav/mariadb"

if podman ps --format '{{.Names}}' 2>/dev/null | grep -qx 'univ-demo-helm'; then
  if [[ -f "$REF" ]]; then
    log "Stopping univ-demo-helm for DB restore"
    podman stop univ-demo-helm 2>/dev/null || true
    rm -rf "${MDB_DIR:?}/"*
    mkdir -p "$MDB_DIR"
    log "Extracting reference DB (will apply on next helm start)"
    gunzip -c "$REF" > "${MDB_DIR}/restore.sql"
    podman start univ-demo-helm 2>/dev/null || bash "$KIT/deploy/podman-up.sh" >>"$LOG" 2>&1
    log "Helm restarted after reference restore"
  elif [[ -f "$LEGACY_REF" ]]; then
    log "Using legacy reference from demo-agent-v3"
    mkdir -p "$(dirname "$REF")"
    cp -a "$LEGACY_REF" "$REF"
    exec bash "$0"
  else
    log "WARNING: no DB reference at $REF"
  fi
  find "${UNIV_ROOT}/sav/opencode-ws" -mindepth 1 -maxdepth 2 -type f -mtime +0 -delete 2>/dev/null || true
elif [[ -x /apps/demo-agent-v3/app/scripts/nightly-restore.sh ]]; then
  log "Fallback: demo-agent-v3 restore"
  exec bash /apps/demo-agent-v3/app/scripts/nightly-restore.sh
else
  log "ERROR: no univ-demo-helm and no demo-agent-v3 fallback"
  exit 1
fi

log "=== univ-demo nightly restore end ==="
