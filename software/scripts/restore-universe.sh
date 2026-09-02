#!/usr/bin/env bash
# Intent: software/RULES.md#rule-11
set -euo pipefail

SNAPSHOT_TAR="${1:-}"
TARGET_DIR="${2:-}"

if [[ -z "$SNAPSHOT_TAR" || ! -f "$SNAPSHOT_TAR" || -z "$TARGET_DIR" ]]; then
  echo "Usage: bash scripts/restore-universe.sh <snapshot_file.tar.gz> <destination_directory>"
  echo "Example: bash scripts/restore-universe.sh /path/to/UNIV8_exp-001-pass_xxx.tar.gz /path/to/destination"
  exit 1
fi

echo "[restore] Restoring snapshot ${SNAPSHOT_TAR} to ${TARGET_DIR}..."
mkdir -p "$TARGET_DIR"
tar -xzf "$SNAPSHOT_TAR" -C "$TARGET_DIR"
echo "[restore] Extracted to ${TARGET_DIR} — not proven yet."

# Restoration ends with the universe's own deploy/proof.sh — a restore nobody
# proved is a claim (Rule 11). Until V1.13 this script printed "Universe
# restored successfully" the moment tar returned, which says the bytes were
# written and nothing about whether the universe they form can run. The
# proof lives at <universe>/deploy/proof.sh; a snapshot made by
# snapshot-universe.sh unpacks the universe as one top-level directory, so
# both the destination and its single child are looked at.
PROOF=""
for candidate in "${TARGET_DIR}/deploy/proof.sh" "${TARGET_DIR}"/*/deploy/proof.sh; do
  if [[ -f "$candidate" ]]; then
    if [[ -n "$PROOF" ]]; then
      echo "[restore] restored, NOT proven: more than one deploy/proof.sh under ${TARGET_DIR} (${PROOF}, ${candidate}) — restore one universe per destination." >&2
      exit 2
    fi
    PROOF="$candidate"
  fi
done

if [[ -z "$PROOF" ]]; then
  echo "[restore] restored, NOT proven: no deploy/proof.sh under ${TARGET_DIR}. The bytes are back; nobody has shown the universe runs. Provide the universe's proof (docs/agent/RUNBOOK-EXPLICIT.md) and run it before calling this a restore." >&2
  exit 2
fi

UNIV_ROOT="$(cd "$(dirname "$PROOF")/.." && pwd)"
echo "[restore] Proving with ${PROOF}..."
if (cd "$UNIV_ROOT" && bash "$PROOF"); then
  echo "[restore] OK — universe restored to ${UNIV_ROOT} AND proven by its own deploy/proof.sh."
else
  rc=$?
  echo "[restore] FAILED — universe restored to ${UNIV_ROOT} but its deploy/proof.sh exited ${rc}. This is not a restore until the proof passes." >&2
  exit "$rc"
fi
