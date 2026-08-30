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

# TWO CLOCKS, TWO INTENTS — and confusing them makes a test prove nothing.
#
# **Operating** (Rule 0E): an image already published at this tag IS the
# artefact. Rebuilding it does not make it truer, it re-downloads the world.
# Reuse is correct, and it is the default: that is Rule 10's fast clock.
#
# **Proving** (Pillar 1, "creation ex nihilo"; Rule 10's clean-sheet TEST):
# the question is whether the whole edifice still builds from a single git
# repository with no hidden dependency. A skipped build answers nothing.
# **A beta or clean-sheet run MUST set SHAPER_FORCE_REBUILD=1** — the protocol
# says so, and this script says so too when it skips.
#
# Measured on the reference host: a cold rebuild of the nine images took ~45
# minutes (base image pulled from docker.io, CLIs reinstalled per bridge);
# the same nine already published took seconds to confirm.
published() {
  local repo="$1"
  curl -sf --max-time 10 \
    "http${SHAPER_TLS_VERIFY:+s}://${SHAPER_REGISTRY}/v2/shaper/${repo}/manifests/${SHAPER_IMAGE_TAG}" \
    -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
    -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' >/dev/null 2>&1
}

if [[ "${SHAPER_FORCE_REBUILD:-0}" == "1" ]]; then
  echo "[build-all-bricks] SHAPER_FORCE_REBUILD=1 — building every image from source (ex nihilo)"
fi

if [[ "${SHAPER_FORCE_REBUILD:-0}" != "1" ]] && published base; then
  echo "[build-all-bricks] shaper/base:${SHAPER_IMAGE_TAG} already published — REUSED, not built."
  echo "[build-all-bricks]   Proving a clean sheet? This proves nothing: SHAPER_FORCE_REBUILD=1."
else
  bash scripts/build-base-image.sh
fi
export SHAPER_BASE_IMAGE="${SHAPER_BASE_IMAGE:-${SHAPER_REGISTRY}/shaper/base:${SHAPER_IMAGE_TAG}}"

for brick in \
  brick-vault brick-logger brick-queue brick-maestro \
  brick-bridge-opencode brick-bridge-agy brick-bridge-cursor brick-bridge-deepseek
do
  if [[ "${SHAPER_FORCE_REBUILD:-0}" != "1" ]] && published "${brick}"; then
    echo "[build-all-bricks] shaper/${brick}:${SHAPER_IMAGE_TAG} already published — skipped"
    continue
  fi
  bash "scripts/build-${brick}.sh"
done

echo "[build-all-bricks] OK — every base brick built from ${SHAPER_BASE_IMAGE}"
