#!/usr/bin/env bash
# Intent: docs/architecture/ARTIFACT-BOUNDARY.md#registry-contract
set -euo pipefail

REGISTRY="${REGISTRY_HOST:-10.87.78.3:5000}"
REGISTRY_USER="${REGISTRY_USER:-registry}"
REGISTRY_PASS="${REGISTRY_PASS:-Bananasplit123!}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "========================================================"
echo " [SHAPER-OS] Pushing images to registry: ${REGISTRY}"
echo "========================================================"

# 1. Login to registry
echo "-> 1. Authenticating to ${REGISTRY}..."
podman login -u "${REGISTRY_USER}" -p "${REGISTRY_PASS}" --tls-verify=false "${REGISTRY}"

# 2. List of bricks to push
BRICKS=(
  "vault:bricks/brick-vault/Containerfile"
  "logger:bricks/brick-logger/Containerfile"
  "queue:bricks/brick-queue/Containerfile"
  "maestro:bricks/brick-maestro/Containerfile"
  "ged:bricks/brick-ged/Containerfile"
  "helm:bricks/brick-helm/Containerfile"
  "bridge-opencode:bricks/brick-bridge-opencode/Containerfile"
  "bridge-agy:bricks/brick-bridge-agy/Containerfile"
)

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

for item in "${BRICKS[@]}"; do
  NAME="${item%%:*}"
  CFILE="${item#*:}"
  LOCAL_TAG="shaper-${NAME}:latest"
  REMOTE_TAG="${REGISTRY}/shaper-${NAME}:latest"
  REMOTE_VER_TAG="${REGISTRY}/shaper-${NAME}:${TIMESTAMP}"

  echo "--------------------------------------------------------"
  echo "-> Building ${LOCAL_TAG} via ${CFILE}..."
  podman build -f "${CFILE}" -t "${LOCAL_TAG}" .

  echo "-> Tagging ${REMOTE_TAG}..."
  podman tag "${LOCAL_TAG}" "${REMOTE_TAG}"
  podman tag "${LOCAL_TAG}" "${REMOTE_VER_TAG}"

  echo "-> Pushing ${REMOTE_TAG}..."
  podman push --tls-verify=false "${REMOTE_TAG}"
  podman push --tls-verify=false "${REMOTE_VER_TAG}"
  echo "✓ ${LOCAL_TAG} -> ${REMOTE_TAG} (OK)"
done

echo "========================================================"
echo " [SHAPER-OS] All images successfully pushed to ${REGISTRY} !"
echo "========================================================"
