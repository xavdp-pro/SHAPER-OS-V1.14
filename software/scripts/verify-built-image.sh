#!/usr/bin/env bash
# Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
# Inspect declared build identity before publication; no tag/exit-code inference.
set -euo pipefail
[[ $# -eq 4 ]] || { echo 'BUILD_IMAGE_IDENTITY_INPUT_REQUIRED' >&2; exit 1; }
image="$1"
revision="$2"
node_input="$3"
base_input="$4"
[[ "$revision" =~ ^[0-9a-f]{40}$ && -n "$image" && -n "$node_input" ]] || { echo 'BUILD_IMAGE_IDENTITY_INPUT_INVALID' >&2; exit 1; }
check_label() {
 local key="$1" expected="$2" code="$3" actual
 if ! actual="$(podman image inspect --format "{{index .Labels \"$key\"}}" "$image" 2>/dev/null)"; then
  echo 'BUILD_IMAGE_IDENTITY_UNAVAILABLE' >&2; exit 1
 fi
 [[ "$actual" == "$expected" ]] || { echo "$code" >&2; exit 1; }
}
check_label org.opencontainers.image.revision "$revision" BUILD_IMAGE_REVISION_MISMATCH
check_label org.shaper.node-image "$node_input" BUILD_IMAGE_NODE_MISMATCH
if [[ -n "$base_input" ]]; then
 check_label org.shaper.base-image "$base_input" BUILD_IMAGE_BASE_MISMATCH
fi
