#!/usr/bin/env bash
# Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
set -euo pipefail
: "${SHAPER_BASE_IMAGE:?SHAPER_BASE_IMAGE is required}"
: "${SHAPER_REGISTRY:?SHAPER_REGISTRY is required}"
: "${SHAPER_IMAGE_TAG:?SHAPER_IMAGE_TAG is required; never publish latest}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REVISION="${SHAPER_SOURCE_REVISION:-$(git -C "$ROOT/.." rev-parse HEAD)}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'BUILD_SOURCE_REVISION_REQUIRED' >&2; exit 1; }
NODE_IMAGE_INPUT="${SHAPER_NODE_IMAGE:-docker.io/library/node:20-alpine}"
IMAGE="${SHAPER_REGISTRY}/shaper/brick-maestro:${SHAPER_IMAGE_TAG}"
# The unit image carries its own MariaDB server (runtime/unit-mariadb): the
# build installs it from the Alpine repositories of the Node image's release
# and fails at its last step when the image would refuse to start.
podman build --no-cache \
  --build-arg "NODE_IMAGE=${NODE_IMAGE_INPUT}" \
  --build-arg "SHAPER_BASE_IMAGE=${SHAPER_BASE_IMAGE}" \
  --build-arg "SHAPER_SOURCE_REVISION=${REVISION}" \
  -f bricks/brick-maestro/Containerfile \
  -t "$IMAGE" \
  bricks/brick-maestro
bash "$ROOT/scripts/verify-built-image.sh" "$IMAGE" "$REVISION" "$NODE_IMAGE_INPUT" "$SHAPER_BASE_IMAGE"
# The digest is taken from the push, never from `podman inspect` on the local
# image: the two differ, because a registry may re-serialise the manifest it
# stores. Only what the registry holds can be pulled back.
mkdir -p "$ROOT/.release"
bash "$ROOT/scripts/publish-built-image.sh" "$IMAGE" "$ROOT/.release/brick-maestro.digest" "${SHAPER_TLS_VERIFY:-true}"
echo "[build-brick-maestro] built $IMAGE"
