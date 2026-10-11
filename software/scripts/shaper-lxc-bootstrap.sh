#!/usr/bin/env bash
# Intent: software/RULES.md#rule-11
# Intent: software/universes/_template/INTENT.md#materialise
# ==============================================================================
# Shaper OS — 1-Click Bootstrap inside a clean universe container (LXC, Debian 13)
# Brings up a universe derived from software/universes/_template/ — the four base
# units of univ-minimal (Vault, Logger, Queue, Maestro), each one functional
# Podman holding its application and its own MariaDB server (Rules 4 and 26) —
# and proves it.
# DRP: 3 clocks (cached images = fast; rebuild from scratch = longer; + data delta).
# Do not display "< 120s" as SLA. See RULES.md Rule 10.
#
#   UNIV_SLUG=<univ_slug> bash software/scripts/shaper-lxc-bootstrap.sh
#
# The universe directory is UNIV_DIR, default <univ_slug> under the apps root
# (SHAPER_APPS_ROOT, default /apps): a copy of _template, outside this
# repository, with its manifest and cfg-universe.env written by the operator
# (the slug, the registry and tag, or the image lock, are theirs — this script
# chooses none of them). When the universe has no
# base/ yet, the base units are installed from THIS checkout at its HEAD
# (deploy/install-base.sh refuses a revision without the qualified release);
# an installed base/ is kept as it is.
#
# It creates NOTHING on the host under /data: each base unit's layout is
# <slug>/ under the apps root of the universe container, created by
# univ-minimal's podman-up.sh before it mounts it (LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md, step 3).
#
# What it no longer does, and why:
#   - Until the 2 September audit it ran `mkdir -p /data/{…}` and `chmod -R 777`
#     on the host, with `set -e` alone and the slug unquoted in every path.
#   - Until the base release (11 October 2026) it made an SSH key pair for the
#     OpenCode bridge, added the bridge's public key to root's authorized_keys
#     and copied into the bridge a `podman` wrapper running `ssh root@localhost
#     podman …`: an AI container holding root's podman over the universe
#     container that runs it. The base units run no engine and no bridge; a
#     cognition adapter joins a universe only as a unit meeting Rules 4 and 26,
#     and nothing grants it the universe's podman. Its SSH key step went with it.
# ==============================================================================
set -euo pipefail
: "${UNIV_SLUG:?not set — choose the universe slug; this repository ships no universe (see software/universes/README.md)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"     # software/
REPO="$(cd "$ROOT/.." && pwd)"               # the SHAPER OS checkout
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
UNIV="${UNIV_DIR:-${APPS_ROOT}/${UNIV_SLUG}}"
halt() { echo "[shaper-lxc-bootstrap] $*" >&2; exit 1; }

echo "============================================================="
echo "=== SHAPER OS UNIVERSE INITIALIZATION (CLEAN-SHEET LXC) ==="
echo "============================================================="

# STEP 1 : What the universe container must provide (univ-minimal INTENT.md#host):
# podman, nftables (Rule 11: podman's nested network dies without it), jq,
# openssl, curl, iproute2 (ss), git and python3 for the template's scripts —
# and podman-restart.service, so the --restart=always units come back when the
# universe container restarts.
echo "[1/5] Installing system packages in the universe container..."
apt-get update -qq && apt-get install -y -qq podman nftables jq openssl curl iproute2 git python3 ca-certificates > /dev/null
systemctl enable podman-restart.service > /dev/null 2>&1 \
  || echo "[shaper-lxc-bootstrap] WARN — podman-restart.service could not be enabled: the units will not come back after a restart of this container" >&2

# STEP 2 : The universe, derived from the template, with its own settings file.
echo "[2/5] Checking the universe at ${UNIV}..."
if [[ ! -f "${UNIV}/deploy/install-base.sh" || ! -f "${UNIV}/deploy/podman-up.sh" ]]; then
  # A universe that does not exist is a halt, not a warning that scrolls by:
  # every step after this one would report on units that were never born.
  echo "[shaper-lxc-bootstrap] HALT — ${UNIV} not found, or not derived from the template (no deploy/install-base.sh)." >&2
  echo "[shaper-lxc-bootstrap] Copy software/universes/_template to ${UNIV}, write its manifest and cfg-universe.env (software/universes/_template/AGENT-DEPLOY.md), or set UNIV_DIR to a universe that exists." >&2
  exit 1
fi
[[ -f "${UNIV}/cfg-universe.env" ]] \
  || halt "HALT — ${UNIV}/cfg-universe.env not found: copy cfg-universe.env.example to it and set SHAPER_UNIVERSE, and the registry and tag or the image lock. Nothing was started."

# STEP 3 : The base units, univ-minimal at one revision — installed once.
if [[ -s "${UNIV}/base/.shaper-revision" ]]; then
  echo "[3/5] Base units already installed at $(cut -c1-12 "${UNIV}/base/.shaper-revision") — kept"
else
  REV="$(git -C "$REPO" rev-parse --verify HEAD)" || halt "HALT — ${REPO} is not a git checkout: the base is installed from one revision of it."
  echo "[3/5] Installing the base units from ${REPO} at ${REV:0:12}..."
  bash "${UNIV}/deploy/install-base.sh" --shaper-repo "$REPO" --shaper-commit "$REV"
fi

# STEP 4 : Birth, in bootOrder — the preflight first: it says what a run would
# keep or recreate and changes nothing; a red preflight stops here.
echo "[4/5] Bringing the universe up..."
bash "${UNIV}/deploy/podman-up.sh" --preflight
bash "${UNIV}/deploy/podman-up.sh"
bash "${UNIV}/deploy/base.sh" install-renewal-timer.sh

# STEP 5 : The proof — the Rule 26 inventory of every unit and one real effect
# each. A green health endpoint is not a proof.
echo "[5/5] Proving the universe..."
bash "${UNIV}/deploy/proof.sh"

echo ""
echo "Universe ${UNIV_SLUG} materialised and proven (deploy/proof.sh exit 0)."
echo "Next: deploy/base.sh lifecycle-drill.sh and deploy/base.sh restore-drill.sh in ${UNIV}."
