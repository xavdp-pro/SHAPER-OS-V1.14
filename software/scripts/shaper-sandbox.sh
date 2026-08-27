#!/usr/bin/env bash
# Intent: software/RULES.md#rule-36
# ==============================================================================
# shaper-sandbox.sh — Ephemeral Podman sandbox launcher (--rm)
# Usage:
#   bash scripts/shaper-sandbox.sh run [--image <image>] [--mount-ged] [--dir <path>] --cmd "<command>"
#
# Examples:
#   bash scripts/shaper-sandbox.sh run --image python:3.11-slim --cmd "python -c 'print(1+1)'"
#   bash scripts/shaper-sandbox.sh run --mount-ged --image node:20-alpine --cmd "node process_docs.js"
# ==============================================================================
set -euo pipefail

IMAGE="docker.io/library/node:20-alpine"
MOUNT_GED=0
WORKDIR="$(pwd)"
CMD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    run)
      shift
      ;;
    --image)
      IMAGE="$2"
      shift 2
      ;;
    --mount-ged)
      MOUNT_GED=1
      shift
      ;;
    --dir)
      WORKDIR="$2"
      shift 2
      ;;
    --cmd)
      CMD="$2"
      shift 2
      ;;
    *)
      if [[ -z "$CMD" ]]; then
        CMD="$*"
        break
      fi
      shift
      ;;
  esac
done

if [[ -z "$CMD" ]]; then
  echo "Error: no command specified (--cmd '<command>')"
  exit 1
fi

MOUNTS=("-v" "$WORKDIR:/workspace:rw,z")

if [[ "$MOUNT_GED" -eq 1 ]]; then
  SHAPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  mkdir -p "$SHAPER_DIR/data/ged"
  MOUNTS+=("-v" "$SHAPER_DIR/data/ged:/data/ged:rw,z")
fi

echo "[shaper-sandbox] 🚀 Launching ephemeral sandbox ($IMAGE)..."
podman run --rm -i \
  -w /workspace \
  "${MOUNTS[@]}" \
  "$IMAGE" \
  sh -c "$CMD"

echo "[shaper-sandbox] 🧹 Sandbox finished and cleaned up cleanly."
