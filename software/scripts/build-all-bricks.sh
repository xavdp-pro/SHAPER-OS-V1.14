#!/usr/bin/env bash
# Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
# Builds every base brick from the pinned base image.
#
# The base image is built and pushed first: it is the only place a brick may
# take a package from. Nothing is read from the working tree at brick-build
# time, so no brick can be satisfied by filesystem adjacency, and no secret in
# the tree can reach a build context.
set -euo pipefail
: "${SHAPER_REGISTRY:?SHAPER_REGISTRY is required}"
: "${SHAPER_IMAGE_TAG:?SHAPER_IMAGE_TAG is required; never publish latest}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash scripts/build-base-image.sh
export SHAPER_BASE_IMAGE="${SHAPER_BASE_IMAGE:-${SHAPER_REGISTRY}/shaper/base:${SHAPER_IMAGE_TAG}}"

for brick in \
  brick-vault brick-logger brick-queue brick-maestro \
  brick-bridge-opencode brick-bridge-agy brick-bridge-cursor brick-bridge-deepseek
do
  bash "scripts/build-${brick}.sh"
done

echo "[build-all-bricks] OK — every base brick built from ${SHAPER_BASE_IMAGE}"
