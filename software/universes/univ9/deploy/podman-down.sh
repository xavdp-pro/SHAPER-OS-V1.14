#!/usr/bin/env bash
set -euo pipefail

echo "[podman-down] Arrêt des conteneurs de l'univers UNIV9..."
podman stop -t 2 univ9-vault univ9-logger univ9-bridge-opencode univ9-queue univ9-maestro univ9-helm univ9-ged univ9-tunnel 2>/dev/null || true
podman rm -f univ9-vault univ9-logger univ9-bridge-opencode univ9-queue univ9-maestro univ9-helm univ9-ged univ9-tunnel 2>/dev/null || true
echo "[podman-down] OK — Tous les conteneurs UNIV9 sont arrêtés."
