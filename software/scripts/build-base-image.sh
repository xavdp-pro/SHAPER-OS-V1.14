#!/usr/bin/env bash
# Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
set -euo pipefail

: "${SHAPER_REGISTRY:?SHAPER_REGISTRY is required}"
: "${SHAPER_IMAGE_TAG:?SHAPER_IMAGE_TAG is required; never publish latest}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVISION="${SHAPER_SOURCE_REVISION:-$(git -C "$ROOT/.." rev-parse HEAD)}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'BUILD_SOURCE_REVISION_REQUIRED' >&2; exit 1; }
NODE_IMAGE_INPUT="${SHAPER_NODE_IMAGE:-docker.io/library/node:20-alpine}"
IMAGE="${SHAPER_REGISTRY}/shaper/base:${SHAPER_IMAGE_TAG}"

podman build --no-cache \
  --build-arg "NODE_IMAGE=${NODE_IMAGE_INPUT}" \
  --build-arg "SHAPER_SOURCE_REVISION=${REVISION}" \
  -f "$ROOT/registry/Containerfile.base" \
  -t "$IMAGE" \
  "$ROOT"
bash "$ROOT/scripts/verify-built-image.sh" "$IMAGE" "$REVISION" "$NODE_IMAGE_INPUT" ""
# The digest is taken from the push, never from `podman inspect` on the local
# image: the two differ, because a registry may re-serialise the manifest it
# stores. Only what the registry holds can be pulled back.
mkdir -p "$ROOT/.release"
bash "$ROOT/scripts/publish-built-image.sh" "$IMAGE" "$ROOT/.release/base-image.digest" "${SHAPER_TLS_VERIFY:-true}"
echo "[build-base-image] built $IMAGE"
