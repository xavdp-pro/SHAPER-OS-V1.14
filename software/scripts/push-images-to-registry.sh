#!/usr/bin/env bash
# Intent: docs/architecture/ARTIFACT-BOUNDARY.md#registry-contract
set -euo pipefail

# The registry, its account and its password come from the environment and
# from nowhere else. Until V1.13 the three lines below carried a mesh IP, an
# account and a real password as ${VAR:-fallback} defaults — and a fallback is
# exactly the value that runs on everyone else's machine, so the password was
# published with the repository (Boot Contract 10b). A value that is missing
# is a halt that says what to supply, never a default that points at the
# author's network. REGISTRY_HOST is the name this script has always read;
# SHAPER_REGISTRY is the name the registry contract documents — either works.
#
# Accepting SHAPER_REGISTRY does not make this the registry contract. This
# script publishes a flat namespace, ${REGISTRY}/shaper-<brick>:latest and
# :<timestamp>; the contract (ARTIFACT-BOUNDARY.md#registry-contract) and
# deploy-image-resolve.sh read ${SHAPER_REGISTRY}/shaper/brick-<component>:
# ${SHAPER_IMAGE_TAG}, and hold that `latest` is not a deployable reference.
# What this script pushes is therefore not what a TEST or PROD lockfile
# resolves — aligning the two is a change of its own, not a side effect of
# removing a password.
REGISTRY="${REGISTRY_HOST:-${SHAPER_REGISTRY:-}}"
: "${REGISTRY:?set REGISTRY_HOST (or SHAPER_REGISTRY) to the private OCI registry as host:port — this repository ships none}"
: "${REGISTRY_USER:?set REGISTRY_USER to the registry account — this repository ships none}"
: "${REGISTRY_PASS:?set REGISTRY_PASS to the registry password — this repository ships none}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "========================================================"
echo " [SHAPER-OS] Pushing images to registry: ${REGISTRY}"
echo "========================================================"

# 1. Login to registry. The password goes to podman on stdin: passed as
# `-p <password>` it sat on the command line, readable by every process on
# the host through `ps` for as long as the login took.
echo "-> 1. Authenticating to ${REGISTRY}..."
printf '%s' "${REGISTRY_PASS}" | podman login -u "${REGISTRY_USER}" --password-stdin --tls-verify=false "${REGISTRY}"

# 2. The bricks to push are the bricks this checkout carries — every
# bricks/*/Containerfile. The list used to be written out by hand and still
# named brick-ged and brick-helm after both had moved to the catalogue, so the
# script failed on the fifth build of eight and pushed nothing after it.
shopt -s nullglob
CONTAINERFILES=(bricks/*/Containerfile)
shopt -u nullglob
if [[ ${#CONTAINERFILES[@]} -eq 0 ]]; then
  echo "[push-images] no bricks/*/Containerfile under ${ROOT} — nothing to push, and that is a defect, not a success" >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

for CFILE in "${CONTAINERFILES[@]}"; do
  BRICK_DIR="$(dirname "${CFILE}")"
  NAME="$(basename "${BRICK_DIR}")"
  NAME="${NAME#brick-}"
  LOCAL_TAG="shaper-${NAME}:latest"
  REMOTE_TAG="${REGISTRY}/shaper-${NAME}:latest"
  REMOTE_VER_TAG="${REGISTRY}/shaper-${NAME}:${TIMESTAMP}"

  echo "--------------------------------------------------------"
  echo "-> Building ${LOCAL_TAG} via ${CFILE}..."
  podman build -f "${CFILE}" -t "${LOCAL_TAG}" .

  echo "-> Tagging ${REMOTE_TAG}..."
  podman tag "${LOCAL_TAG}" "${REMOTE_TAG}"
  podman tag "${LOCAL_TAG}" "${REMOTE_VER_TAG}"

  echo "-> Pushing ${REMOTE_TAG}..."
  podman push --tls-verify=false "${REMOTE_TAG}"
  podman push --tls-verify=false "${REMOTE_VER_TAG}"
  echo "✓ ${LOCAL_TAG} -> ${REMOTE_TAG} (OK)"
done

echo "========================================================"
echo " [SHAPER-OS] All ${#CONTAINERFILES[@]} images successfully pushed to ${REGISTRY} !"
echo "========================================================"
