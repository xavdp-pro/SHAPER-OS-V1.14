#!/usr/bin/env bash
# Intent: software/RULES.md#rule-10
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
echo "[restore] OK — Universe restored successfully to ${TARGET_DIR}."
