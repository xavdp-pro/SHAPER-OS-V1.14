#!/usr/bin/env bash
set -euo pipefail

: "${SHAPER_REGISTRY:?SHAPER_REGISTRY is required}"
: "${SHAPER_IMAGE_TAG:?SHAPER_IMAGE_TAG is required; never publish latest}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVISION="${SHAPER_SOURCE_REVISION:-$(git -C "$ROOT/.." rev-parse HEAD)}"
IMAGE="${SHAPER_REGISTRY}/shaper/base:${SHAPER_IMAGE_TAG}"

podman build \
  --build-arg "SHAPER_SOURCE_REVISION=${REVISION}" \
  -f "$ROOT/registry/Containerfile.base" \
  -t "$IMAGE" \
  "$ROOT"
podman push --tls-verify="${SHAPER_TLS_VERIFY:-true}" "$IMAGE"
echo "[build-base-image] published $IMAGE"
