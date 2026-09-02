#!/usr/bin/env bash
# Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
# One image-name ladder for every deploy script — the SAME names the build
# scripts publish. Until V1.13.1 three conventions shipped together
# (<registry>/shaper/brick-X:<tag> from the build, localhost/shaper-X:latest
# in the template, localhost/shaper-brick-X:dev in univ-base) and the deploy
# half could not see what the build half had just made. All five beta testers
# hit it. Sourced by deploy/podman-up.sh; not an executable.
#
# The ladder, per brick key (img-<component>):
#   1. The caller's own pin (an image lock) — resolved BEFORE calling this.
#   2. ${SHAPER_REGISTRY}/shaper/brick-<component>:${SHAPER_IMAGE_TAG}
#      — exactly what scripts/build-brick-*.sh published. The registry is an
#      INFRASTRUCTURE PREREQUISITE, one per machine: if you do not know this
#      machine's registry, ask the human operator before launching — never
#      invent a throwaway one.
#   3. SHAPER_ALLOW_UNPINNED=1 → localhost/shaper/brick-<component>:dev,
#      matching a local laptop build (SHAPER_REGISTRY=localhost,
#      SHAPER_IMAGE_TAG=dev). Never for TEST or PROD.

shaper_image_ref() {
  local key="$1" component="${1#img-}"
  if [[ -n "${SHAPER_REGISTRY:-}" && -n "${SHAPER_IMAGE_TAG:-}" ]]; then
    echo "${SHAPER_REGISTRY}/shaper/brick-${component}:${SHAPER_IMAGE_TAG}"
    return
  fi
  if [[ "${SHAPER_ALLOW_UNPINNED:-0}" == "1" ]]; then
    echo "localhost/shaper/brick-${component}:dev"
    return
  fi
  echo "[deploy] $key: no image source. Set SHAPER_REGISTRY and SHAPER_IMAGE_TAG" >&2
  echo "[deploy] to the machine's registry and the tag you built (the registry is an" >&2
  echo "[deploy] infrastructure prerequisite — ask the operator if you do not know it)," >&2
  echo "[deploy] or SHAPER_ALLOW_UNPINNED=1 for a local dev build. See RUNBOOK step 0." >&2
  return 1
}

# Pull with the same TLS posture the build pushed with (SHAPER_TLS_VERIFY).
# Until V1.13.1 the build honoured it and the deploy did not, so a stack could
# be locked against a registry it could not pull from.
shaper_pull() {
  local ref="$1"
  if podman image exists "$ref" 2>/dev/null; then
    return 0
  fi
  podman pull --tls-verify="${SHAPER_TLS_VERIFY:-true}" "$ref"
}

# The registry's HTTP scheme, from the VALUE of SHAPER_TLS_VERIFY — the same
# posture podman is given above. Until the 2 September audit the build's
# "already published?" probe wrote `http${SHAPER_TLS_VERIFY:+s}://`, which
# tests whether the variable is SET, not what it says: the runbook's own
# `export SHAPER_TLS_VERIFY=false` (the plain-HTTP case) produced https, and a
# TLS registry with the variable unset was probed over http. Both probes
# failed silently and every brick was rebuilt every time — the reuse clock of
# Rule 10 never ran. Only the string `false` means plain HTTP.
shaper_registry_url() {
  local scheme=https
  if [[ "${SHAPER_TLS_VERIFY:-true}" == "false" ]]; then scheme=http; fi
  echo "${scheme}://${SHAPER_REGISTRY}"
}
