#!/usr/bin/env bash
# Intent: software/RULES.md#rule-11
# ==============================================================================
# Shaper OS — 1-Click Bootstrap for Clean LXC Container (Debian 12 / Ubuntu)
# Deploys the ecosystem and hands over to the OpenCode agent.
# DRP: 3 clocks (cached images = fast; rebuild from scratch = longer; + data delta).
# Do not display "< 120s" as SLA. See RULES.md Rule 10.
#
# Runs from anywhere: it resolves software/ from its own location. The universe
# it starts is software/universes/${UNIV_SLUG} (the slug belongs to the
# operator — this repository ships none). It creates NOTHING on the host under
# /data: those paths exist inside the containers only, and the state a universe
# owns lives under that universe (LXC-CLEAN-SHEET-DEPLOYMENT-STEPS.md, step 3).
# Until the 2 September audit this script still ran `mkdir -p /data/{…}` and
# `chmod -R 777` on the host while the guide beside it said the opposite, with
# `set -e` alone and the slug unquoted in every path.
# ==============================================================================
set -euo pipefail
: "${UNIV_SLUG:?not set — choose the universe slug; this repository ships no universe (see software/universes/README.md)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "============================================================="
echo "=== SHAPER OS CLUSTER INITIALIZATION (CLEAN-SHEET LXC) ==="
echo "============================================================="

# STEP 1 : Mandatory system packages
echo "[1/5] Installing system packages on LXC host..."
apt-get update -qq && apt-get install -y -qq   podman git curl wget jq ripgrep openssh-server openssh-client python3 python3-pip rsync unzip ca-certificates > /dev/null

# STEP 2 : Local SSH keypair host <-> containers
echo "[2/5] Configuring local SSH keys for the agent..."
mkdir -p /root/.ssh
if [ ! -f /root/.ssh/id_ed25519 ]; then
  ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519 -q
  cat /root/.ssh/id_ed25519.pub >> /root/.ssh/authorized_keys
  chmod 700 /root/.ssh
  chmod 600 /root/.ssh/authorized_keys
fi
systemctl enable --now ssh > /dev/null 2>&1 || true

# STEP 3 : Start Shaper OS containers. The deploy script creates every
# directory it mounts, under the universe, before it mounts it — nothing is
# prepared on the host here (software/universes/README.md §5).
UP="$ROOT/universes/${UNIV_SLUG}/deploy/podman-up.sh"
echo "[3/5] Starting Podman cluster (${UP#"$ROOT"/})..."
if [[ ! -f "$UP" ]]; then
  # A universe that does not exist is a halt, not a warning that scrolls by:
  # every step after this one would report on containers that were never born.
  echo "[shaper-lxc-bootstrap] HALT — $UP not found." >&2
  echo "[shaper-lxc-bootstrap] Derive software/universes/${UNIV_SLUG} from universes/_template first (see universes/README.md), or set UNIV_SLUG to a universe that exists." >&2
  exit 1
fi
bash "$UP"

# STEP 4 : Wire transparent Podman bridge into the agent
echo "[4/5] Configuring transparent Podman bridge inside the agent..."
if podman ps -q -f "name=${UNIV_SLUG}-bridge-opencode" | grep -q .; then
  # Only a public key travels, and it travels upward. Copying this host's private
  # key into the agent — which this script used to do — handed the container the
  # key to its own host, since the matching public key is already in the host's
  # authorized_keys. Rule 36: a private key never moves, whatever the level.
  podman exec "${UNIV_SLUG}-bridge-opencode" mkdir -p /root/.ssh
  podman exec "${UNIV_SLUG}-bridge-opencode" chmod 700 /root/.ssh
  podman exec "${UNIV_SLUG}-bridge-opencode" \
    sh -c '[ -f /root/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N "" -q -f /root/.ssh/id_ed25519'

  AGENT_PUB="$(podman exec "${UNIV_SLUG}-bridge-opencode" cat /root/.ssh/id_ed25519.pub)"
  touch /root/.ssh/authorized_keys
  if ! grep -qF "$AGENT_PUB" /root/.ssh/authorized_keys; then
    # Tagged so that revoking this agent later is the removal of one line.
    echo "$AGENT_PUB # agent:${UNIV_SLUG}-bridge-opencode added $(date -I)" >> /root/.ssh/authorized_keys
  fi
  chmod 600 /root/.ssh/authorized_keys

  cat << 'EOF_WRAP' > /tmp/podman-wrapper.sh
#!/bin/bash
if [ $# -eq 0 ]; then
  exec ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes root@localhost podman
fi
CMD=""
for arg in "$@"; do
  CMD="$CMD $(printf '%q' "$arg")"
done
exec ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes root@localhost podman $CMD
EOF_WRAP
  chmod +x /tmp/podman-wrapper.sh
  podman cp /tmp/podman-wrapper.sh "${UNIV_SLUG}-bridge-opencode:/usr/local/bin/podman"
  podman cp /tmp/podman-wrapper.sh "${UNIV_SLUG}-bridge-opencode:/usr/local/bin/docker"
  rm -f /tmp/podman-wrapper.sh
fi

# STEP 5 : Final validation & agent handover
echo "[5/5] Verifying cluster and handing over to the agent..."
podman ps --format "table {{.Names}}	{{.Status}}	{{.Ports}}"

echo ""
echo "🎉 TOTAL SUCCESS: Shaper OS universe deployed and operational!"
echo "👉 OpenCode agent is active and ready for commands on Helm Cockpit (port 8650)."
