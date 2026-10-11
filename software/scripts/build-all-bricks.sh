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
# **A beta or clean-sheet run MUST set SHAPER_FORCE_REBUILD=1, under a tag the
# registry has never served** — the protocol says so, and this script says so
# too when it skips, and halts when the tag is already served (below).
#
# No duration is promised here — Rule 10 forbids the figure, and the one this
# header once carried came from an unverified report and was wrong by 45x.
# The proof of an ex nihilo build is factual, never a stopwatch: the tag was
# absent from the registry before, present after, and every digest in
# .release/ is servable back.
source "$ROOT/scripts/deploy-image-resolve.sh"   # shaper_registry_url: the scheme follows SHAPER_TLS_VERIFY's value

# A PUBLISHED TAG IS NEVER MOVED — and SHAPER_FORCE_REBUILD=1 does not move it.
#
# Until the base release this script read SHAPER_FORCE_REBUILD=1 as "build and
# push every image", whatever the registry already served: a clean-sheet run
# pointed at a published tag re-pushed it, and every lock that pinned its
# digests named images the tag no longer served (software/universes/
# _template/AGENT-DEPLOY.md, Forbidden 3). A probe that could not reach the
# registry read as "not published" and pushed too. Now, as the univ-base
# bootstrap does, every repository is asked BEFORE anything is built, and only
# the answer 404 lets a push happen:
#
#   - 200 under SHAPER_FORCE_REBUILD=1  → halt: a proof from nothing needs a tag
#                                          the registry has never served
#   - 200 otherwise                     → reused, not built (operating)
#   - 404                               → built and pushed
#   - any other answer, or none         → halt: whether the tag is published
#                                          cannot be told, so nothing is pushed
#
# SHAPER_PUSH=0 publishes nothing (publish-built-image.sh keeps every image
# local), so no registry tag can move: every image is built, and the registry
# is not asked.
REPOS=(base
  brick-vault brick-logger brick-queue brick-maestro
  brick-bridge-opencode brick-bridge-agy brick-bridge-cursor brick-bridge-deepseek)

halt() { echo "[build-all-bricks] $*" >&2; exit 1; }

# The registry's HTTP status for one repository at this tag; "000" when it did
# not answer.
manifest_status() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    "$(shaper_registry_url)/v2/shaper/${1}/manifests/${SHAPER_IMAGE_TAG}" \
    -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
    -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' 2>/dev/null)" || true
  echo "${code:-000}"
}

declare -A REUSE=()
if [[ "${SHAPER_PUSH:-1}" == 0 ]]; then
  echo "[build-all-bricks] SHAPER_PUSH=0 — every image is built and kept local; nothing is pushed, the registry is not asked"
else
  served=() unknown=()
  for repo in "${REPOS[@]}"; do
    code="$(manifest_status "$repo")"
    case "$code" in
      404) ;;
      200) served+=("$repo"); REUSE[$repo]=1 ;;
      *)   unknown+=("shaper/$repo:${SHAPER_IMAGE_TAG} (HTTP $code)") ;;
    esac
  done
  if (( ${#unknown[@]} )); then
    printf '[build-all-bricks]   %s\n' "${unknown[@]}" >&2
    halt "$(shaper_registry_url) did not answer 200 or 404 for the above: whether the tag is published cannot be told. Nothing was built or pushed. Halt."
  fi
  if [[ "${SHAPER_FORCE_REBUILD:-0}" == "1" ]]; then
    if (( ${#served[@]} )); then
      printf '[build-all-bricks]   %s\n' "${served[@]/#/shaper/}" >&2
      halt "SHAPER_FORCE_REBUILD=1, and the registry already serves ${SHAPER_IMAGE_TAG} for the above: a published tag is never moved. Prove the build from nothing under a NEW SHAPER_IMAGE_TAG. Nothing was built or pushed. Halt."
    fi
    echo "[build-all-bricks] SHAPER_FORCE_REBUILD=1 — the registry serves none of ${SHAPER_IMAGE_TAG}: building every image from source (ex nihilo)"
  fi
fi

if [[ -n "${REUSE[base]:-}" ]]; then
  echo "[build-all-bricks] shaper/base:${SHAPER_IMAGE_TAG} already published — REUSED, not built."
  echo "[build-all-bricks]   Proving a clean sheet? This proves nothing: SHAPER_FORCE_REBUILD=1 under a new tag."
else
  bash scripts/build-base-image.sh
fi
export SHAPER_BASE_IMAGE="${SHAPER_BASE_IMAGE:-${SHAPER_REGISTRY}/shaper/base:${SHAPER_IMAGE_TAG}}"

for brick in "${REPOS[@]:1}"; do
  if [[ -n "${REUSE[$brick]:-}" ]]; then
    echo "[build-all-bricks] shaper/${brick}:${SHAPER_IMAGE_TAG} already published — skipped"
    continue
  fi
  bash "scripts/build-${brick}.sh"
done

echo "[build-all-bricks] OK — every base brick built from ${SHAPER_BASE_IMAGE}"
