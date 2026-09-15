#!/usr/bin/env bash
# Intent: software/universes/univ-base/INTENT.md#image-lock
# One-shot bootstrap for gbs-test LXC univ-os-v114-dev (DEV sandbox): registry lock,
# pinned deploy, partial proof. Full functional proof: gbs-test-run-full-proof.sh.
set -euo pipefail

ROOT="/root/SHAPER-OS-V1.14"
SOFTWARE="$ROOT/software"
UNIV="$SOFTWARE/universes/univ-base"
REV="${SHAPER_SOURCE_REVISION:-unknown}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq podman curl jq openssl ca-certificates git python3 \
  openssh-server openssh-client rsync

cd "$SOFTWARE"
BASE="localhost/shaper/base:dev"

if ! podman image exists "$BASE" 2>/dev/null; then
  echo "[gbs-v114] building base image (local tag only, no registry push)..."
  podman build \
    --build-arg "SHAPER_SOURCE_REVISION=${REV}" \
    -f "$SOFTWARE/registry/Containerfile.base" \
    -t "$BASE" \
    "$SOFTWARE"
fi

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

# Registry + lock (digests servable — see INTENT.md#image-lock)
podman rm -f shaper-registry 2>/dev/null || true
podman run -d -p 5000:5000 --replace --name shaper-registry docker.io/library/registry:2
sleep 2
mkdir -p /etc/containers/registries.conf.d
cat > /etc/containers/registries.conf.d/shaper-local.conf <<'EOF'
[[registry]]
location = "localhost:5000"
insecure = true
EOF

export SHAPER_REGISTRY=localhost:5000
export SHAPER_IMAGE_TAG=v114-gbs
export SHAPER_TLS_VERIFY=false
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
