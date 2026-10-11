#!/usr/bin/env bash
# Intent: software/universes/univ-base/INTENT.md#image-lock
# One-shot bootstrap for gbs-test LXC univ-os-v114-dev (DEV sandbox): registry lock,
# pinned deploy, partial proof. Full functional proof: gbs-test-run-full-proof.sh.
#
# It reproduces univ-base's earlier release (INTENT.md#earlier-shape) from an
# earlier checkout — SHAPER_CHECKOUT, default /root/SHAPER-OS-V1.14 — and must
# itself be this tree's copy of the script: the copy inside such a checkout
# (958e0b7 and before) replaces the registry container and pushes over a
# published tag. Before anything is built, tagged or pushed it refuses:
#   - a checkout that is not at or before 958e0b7 (V1.14 main), or, outside
#     git, whose bricks are not the earlier file-store ones;
#   - a registry that does not answer, and a tag it already serves (a published
#     tag is never moved), and any answer it cannot read.
# The registry container is never replaced: its images live in it. The deploy
# that ends the run is this tree's podman-up.sh — with its image guard — over
# the checkout's univ-base directory and the lock just recorded there.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${SHAPER_CHECKOUT:-/root/SHAPER-OS-V1.14}"
SOFTWARE="$ROOT/software"
UNIV="$SOFTWARE/universes/univ-base"
REV="${SHAPER_SOURCE_REVISION:-unknown}"
EARLIER=958e0b7
halt() { echo "[gbs-v114] $*" >&2; exit 1; }

# ── The checkout holds the earlier file-store bricks ─────────────────────────
earlier_checkout() {
  if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --verify --quiet HEAD >/dev/null 2>&1 \
     && git -C "$ROOT" cat-file -e "$EARLIER^{commit}" 2>/dev/null; then
    git -C "$ROOT" merge-base --is-ancestor HEAD "$EARLIER"
    return
  fi
  # No git history to ask: the bricks themselves must be the earlier ones.
  local b
  for b in vault logger queue maestro; do
    [[ -f "$SOFTWARE/bricks/brick-$b/Containerfile" ]] || return 1
    ! grep -qE 'org\.shaper\.unit\.|_STORE=mariadb|SHAPER_UNIT_SLUG|^USER ' "$SOFTWARE/bricks/brick-$b/Containerfile" || return 1
  done
}
if ! earlier_checkout; then
  echo "[gbs-v114] $ROOT is not an earlier checkout (at or before $EARLIER): its bricks are not the file-store images univ-base runs." >&2
  halt "Run this script — $HERE/gbs-test-bootstrap-v114.sh, not the copy inside the checkout — with SHAPER_CHECKOUT=<a checkout at or before $EARLIER>; the images already published under the tag stay as they are. Halt."
fi
[[ "$HERE" != "$UNIV/deploy" ]] \
  || halt "this is the checkout's own copy of the script; run this tree's copy with SHAPER_CHECKOUT=$ROOT. Halt."

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq podman curl jq openssl ca-certificates git python3 \
  openssh-server openssh-client rsync
cd "$SOFTWARE"

# ── Registry: kept, never replaced; the tag checked before any build ─────────
# The registry keeps its images inside its container: replacing the container
# would delete every image this host ever published. An existing one is kept,
# and started again if it stopped.
if podman container exists shaper-registry; then
  [[ "$(podman inspect -f '{{.State.Running}}' shaper-registry)" == true ]] || podman start shaper-registry >/dev/null
else
  podman run -d -p 5000:5000 --name shaper-registry docker.io/library/registry:2
fi
export SHAPER_REGISTRY=localhost:5000
export SHAPER_IMAGE_TAG="${SHAPER_IMAGE_TAG:-v114-gbs}"
export SHAPER_TLS_VERIFY=false
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null || true; }
ready=0
for _ in $(seq 1 "${REGISTRY_WAIT_SECONDS:-30}"); do
  [[ "$(http_code "http://$SHAPER_REGISTRY/v2/")" == 200 ]] && { ready=1; break; }
  sleep 1
done
(( ready )) || halt "the registry at $SHAPER_REGISTRY does not answer /v2/ with 200: whether a tag is published cannot be told. Nothing was built or pushed. Halt."
# A published tag is never moved: the lock of every universe that pinned it
# names its digests. 404 is the only answer that lets the run publish.
for repo in base brick-vault brick-logger brick-queue brick-maestro brick-bridge-opencode; do
  code="$(http_code "http://$SHAPER_REGISTRY/v2/shaper/$repo/manifests/$SHAPER_IMAGE_TAG" \
    -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
    -H 'Accept: application/vnd.docker.distribution.manifest.v2+json')"
  case "$code" in
    404) ;;
    200) halt "$SHAPER_REGISTRY/shaper/$repo:$SHAPER_IMAGE_TAG is already published: a published tag is never moved. Deploy from the lock that names it, or publish under a new SHAPER_IMAGE_TAG. Halt." ;;
    *) halt "$SHAPER_REGISTRY answered HTTP ${code:-none} for shaper/$repo:$SHAPER_IMAGE_TAG: whether it is published cannot be told. Nothing was built or pushed. Halt." ;;
  esac
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
# This tree's scripts, over the checkout's univ-base directory and its lock.
export SHAPER_UNIVERSE_DIR="$UNIV"
bash "$HERE/podman-up.sh"
sleep 20
bash "$HERE/proof.sh"
echo "[gbs-v114] partial proof done. For runbook step 6 (artefact + live model):"
echo "  SHAPER_UNIVERSE_DIR=$UNIV bash $HERE/gbs-test-measure-opencode.sh && SHAPER_UNIVERSE_DIR=$UNIV bash $HERE/podman-up.sh"
echo "  SHAPER_UNIVERSE_DIR=$UNIV bash $HERE/gbs-test-run-full-proof.sh"
