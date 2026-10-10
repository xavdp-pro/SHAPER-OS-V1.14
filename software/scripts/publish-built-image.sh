#!/usr/bin/env bash
# Intent: docs/architecture/ARTIFACT-BOUNDARY.md#build-context
# Called only after identity verification; a failed push never replaces a digest.
# SHAPER_PUSH=0 keeps the image local (a qualification build on the machine
# that runs it): nothing is pushed and no digest file is written or replaced.
set -euo pipefail
[[ $# -eq 3 ]] || { echo 'BUILD_IMAGE_PUBLICATION_INPUT_REQUIRED' >&2; exit 1; }
image="$1"
digest_file="$2"
tls_verify="$3"
[[ -n "$image" && -n "$digest_file" && "$tls_verify" =~ ^(true|false)$ ]] || { echo 'BUILD_IMAGE_PUBLICATION_INPUT_INVALID' >&2; exit 1; }
if [[ "${SHAPER_PUSH:-1}" == 0 ]]; then
  echo "[publish-built-image] SHAPER_PUSH=0 — $image stays local; not published, no digest recorded"
  exit 0
fi
temporary="$(mktemp "${digest_file}.XXXXXXXX")"
trap 'rm -f -- "$temporary"' EXIT
podman push --tls-verify="$tls_verify" --digestfile "$temporary" "$image"
digest="$(cat "$temporary")"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'BUILD_IMAGE_PUBLISHED_DIGEST_INVALID' >&2; exit 1; }
mv -f -- "$temporary" "$digest_file"
