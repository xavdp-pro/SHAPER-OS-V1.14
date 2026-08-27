#!/usr/bin/env bash
# Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
set -euo pipefail
: "${SHAPER_BASE_IMAGE:?SHAPER_BASE_IMAGE is required}"
: "${SHAPER_REGISTRY:?SHAPER_REGISTRY is required}"
: "${SHAPER_IMAGE_TAG:?SHAPER_IMAGE_TAG is required; never publish latest}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REVISION="${SHAPER_SOURCE_REVISION:-$(git -C "$ROOT/.." rev-parse HEAD)}"
IMAGE="${SHAPER_REGISTRY}/shaper/brick-vault:${SHAPER_IMAGE_TAG}"
podman build \
  --build-arg "SHAPER_BASE_IMAGE=${SHAPER_BASE_IMAGE}" \
  --build-arg "SHAPER_SOURCE_REVISION=${REVISION}" \
  -f bricks/brick-vault/Containerfile \
  -t "$IMAGE" \
  bricks/brick-vault
# The digest is taken from the push, never from `podman inspect` on the local
# image: the two differ, because a registry may re-serialise the manifest it
# stores. Only what the registry holds can be pulled back.
mkdir -p "$ROOT/.release"
podman push --tls-verify="${SHAPER_TLS_VERIFY:-true}" --digestfile "$ROOT/.release/brick-vault.digest" "$IMAGE"
echo "[build-brick-vault] published $IMAGE"
