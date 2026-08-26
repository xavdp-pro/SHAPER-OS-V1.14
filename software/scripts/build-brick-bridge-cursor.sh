#!/usr/bin/env bash
set -euo pipefail
: "${SHAPER_BASE_IMAGE:?SHAPER_BASE_IMAGE is required}"
: "${SHAPER_REGISTRY:?SHAPER_REGISTRY is required}"
: "${SHAPER_IMAGE_TAG:?SHAPER_IMAGE_TAG is required; never publish latest}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REVISION="${SHAPER_SOURCE_REVISION:-$(git -C "$ROOT/.." rev-parse HEAD)}"
IMAGE="${SHAPER_REGISTRY}/shaper/brick-bridge-cursor:${SHAPER_IMAGE_TAG}"
podman build \
  --build-arg "SHAPER_BASE_IMAGE=${SHAPER_BASE_IMAGE}" \
  --build-arg "SHAPER_SOURCE_REVISION=${REVISION}" \
  -f bricks/brick-bridge-cursor/Containerfile \
  -t "$IMAGE" \
  bricks/brick-bridge-cursor
podman push --tls-verify="${SHAPER_TLS_VERIFY:-true}" "$IMAGE"
echo "[build-brick-bridge-cursor] published $IMAGE"
