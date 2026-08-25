#!/usr/bin/env bash
# univ8 — stop and remove all UNIV8 Podman containers.
set -euo pipefail

stop_rm() {
  podman rm -f "$1" 2>/dev/null || true
}

echo "[podman-down] Stopping UNIV8 Podman containers..."
stop_rm univ8-vault
stop_rm univ8-logger
stop_rm univ8-bridge-opencode
stop_rm univ8-queue
stop_rm univ8-maestro
stop_rm univ8-helm
stop_rm univ8-tunnel
echo "[podman-down] OK — all UNIV8 containers stopped."
