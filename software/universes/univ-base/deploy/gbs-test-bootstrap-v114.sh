#!/usr/bin/env bash
# Intent: software/universes/univ-base/INTENT.md#image-lock
# One-shot bootstrap for gbs-test LXC univ-os-v114-dev (DEV sandbox): registry lock,
# pinned deploy, partial proof. Full functional proof: gbs-test-run-full-proof.sh.
#
# It reproduces univ-base's earlier release (INTENT.md#earlier-shape) from the
# checkout it runs in, so it refuses a checkout whose bricks are the
# one-container units, and it never moves a published tag: a registry that
# already serves a tag keeps it, and the registry container is never replaced
# (its images live in it).
set -euo pipefail

ROOT="${SHAPER_CHECKOUT:-/root/SHAPER-OS-V1.14}"
SOFTWARE="$ROOT/software"
UNIV="$SOFTWARE/universes/univ-base"
REV="${SHAPER_SOURCE_REVISION:-unknown}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq podman curl jq openssl ca-certificates git python3 \
  openssh-server openssh-client rsync

cd "$SOFTWARE"
# The checkout must hold the earlier file-store bricks (V1.14 main at or before
# 958e0b7). From the base release on, brick-vault is a unit image of the
# one-container shape, which univ-base's podman-up.sh refuses.
if grep -q 'org.shaper.unit.' "$SOFTWARE/bricks/brick-vault/Containerfile"; then
  echo "[gbs-v114] $ROOT holds the one-container unit bricks (org.shaper.unit.* labels): univ-base cannot run them." >&2
  echo "[gbs-v114] Run this script from a checkout at or before 958e0b7; the images already published under its tag stay as they are. Halt." >&2
  exit 1
fi
# Registry + lock (digests servable — see INTENT.md#image-lock), checked before
# anything is built: a tag it already serves stops the run here.
# The registry keeps its images inside its container: replacing the container
# would delete every image this host ever published. An existing one is kept,
# and started again if it stopped.
if podman container exists shaper-registry; then
  [[ "$(podman inspect -f '{{.State.Running}}' shaper-registry)" == true ]] || podman start shaper-registry >/dev/null
else
  podman run -d -p 5000:5000 --name shaper-registry docker.io/library/registry:2
fi
sleep 2
export SHAPER_REGISTRY=localhost:5000
export SHAPER_IMAGE_TAG="${SHAPER_IMAGE_TAG:-v114-gbs}"
export SHAPER_TLS_VERIFY=false
# A published tag is never moved: the lock of every universe that pinned it
# names its digests. A tag the registry already serves halts the publication.
published() {
  curl -sf --max-time 10 "http://$SHAPER_REGISTRY/v2/shaper/$1/manifests/$SHAPER_IMAGE_TAG" \
    -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
    -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' >/dev/null 2>&1
}
for repo in base brick-vault brick-logger brick-queue brick-maestro brick-bridge-opencode; do
  if published "$repo"; then
    echo "[gbs-v114] $SHAPER_REGISTRY/shaper/$repo:$SHAPER_IMAGE_TAG is already published: a published tag is never moved." >&2
    echo "[gbs-v114] Deploy from the lock that names it (bash deploy/podman-up.sh), or publish under a new SHAPER_IMAGE_TAG. Halt." >&2
    exit 1
  fi
done
mkdir -p /etc/containers/registries.conf.d
cat > /etc/containers/registries.conf.d/shaper-local.conf <<'EOF'
[[registry]]
location = "localhost:5000"
insecure = true
EOF

BASE="localhost/shaper/base:dev"

# Always from this checkout: a local base:dev left by a build of another
# revision would put its packages under this checkout's Containerfiles.
echo "[gbs-v114] building base image (local tag only, no registry push)..."
podman build \
  --build-arg "SHAPER_SOURCE_REVISION=${REV}" \
  -f "$SOFTWARE/registry/Containerfile.base" \
  -t "$BASE" \
  "$SOFTWARE"

echo "[gbs-v114] building five univ-base bricks (local tags)..."
for brick in vault logger queue maestro bridge-opencode; do
  tag="localhost/shaper/brick-${brick}:dev"
  podman build \
    --build-arg "SHAPER_BASE_IMAGE=${BASE}" \
    --build-arg "SHAPER_SOURCE_REVISION=${REV}" \
    -f "bricks/brick-${brick}/Containerfile" \
    -t "$tag" \
    "bricks/brick-${brick}"
done

CFG="$UNIV/cfg-univ-base.env"
if [[ ! -f "$CFG" ]]; then
  KEY="$(openssl rand -hex 32)"
  printf 'VAULT_MASTER_KEY=%s\nVAULT_TOKEN=\nBRIDGE_AUTH_TOKEN=\nOPENCODE_MODEL=\nBRIDGE_OPENCODE_STUB=1\n' "$KEY" > "$CFG"
  chmod 600 "$CFG"
fi

mkdir -p "$SOFTWARE/.release"
podman tag "$BASE" "$SHAPER_REGISTRY/shaper/base:$SHAPER_IMAGE_TAG"
podman push --tls-verify=false --digestfile "$SOFTWARE/.release/base-image.digest" \
  "$SHAPER_REGISTRY/shaper/base:$SHAPER_IMAGE_TAG"
export SHAPER_BASE_IMAGE="$SHAPER_REGISTRY/shaper/base:$SHAPER_IMAGE_TAG"

for brick in vault logger queue maestro bridge-opencode; do
  remote="$SHAPER_REGISTRY/shaper/brick-${brick}:$SHAPER_IMAGE_TAG"
  podman tag "localhost/shaper/brick-${brick}:dev" "$remote"
  podman push --tls-verify=false --digestfile "$SOFTWARE/.release/brick-${brick}.digest" "$remote"
done
python3 "$SOFTWARE/scripts/record-image-lock.py" "$UNIV" --registry=localhost:5000 --insecure

unset SHAPER_ALLOW_UNPINNED
cd "$UNIV"
bash deploy/podman-up.sh
sleep 20
bash deploy/proof.sh
echo "[gbs-v114] partial proof done. For runbook step 6 (artefact + live model):"
echo "  bash deploy/gbs-test-measure-opencode.sh && bash deploy/podman-up.sh"
echo "  bash deploy/gbs-test-run-full-proof.sh"
