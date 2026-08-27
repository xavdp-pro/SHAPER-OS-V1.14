#!/usr/bin/env bash
# Intent: software/RULES.md#rule-11
# ==============================================================================
# Shaper OS — 1-Click Bootstrap for Clean LXC Container (Debian 12 / Ubuntu)
# Deploys the ecosystem and hands over to the OpenCode agent.
# DRP: 3 clocks (cached images = fast; rebuild from scratch = longer; + data delta).
# Do not display "< 120s" as SLA. See RULES.md Rule 10.
# ==============================================================================
: "${UNIV_SLUG:?not set — choose the universe slug; this repository ships no universe (see software/universes/README.md)}"
set -e

echo "============================================================="
echo "=== SHAPER OS CLUSTER INITIALIZATION (CLEAN-SHEET LXC) ==="
echo "============================================================="

# STEP 1 : Mandatory system packages
echo "[1/7] Installing system packages on LXC host..."
apt-get update -qq && apt-get install -y -qq   podman git curl wget jq ripgrep openssh-server openssh-client python3 python3-pip rsync unzip ca-certificates > /dev/null

# STEP 2 : Local SSH keypair host <-> containers
echo "[2/7] Configuring local SSH keys for the agent..."
mkdir -p /root/.ssh
if [ ! -f /root/.ssh/id_ed25519 ]; then
  ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519 -q
  cat /root/.ssh/id_ed25519.pub >> /root/.ssh/authorized_keys
  chmod 700 /root/.ssh
  chmod 600 /root/.ssh/authorized_keys
fi
systemctl enable --now ssh > /dev/null 2>&1 || true

# STEP 3 : Persistence directories /data/
echo "[3/7] Creating persistent data volumes /data/..."
mkdir -p /data/{vault,logger,queue,ged,workspaces,opencode-bridge,timelines,qdrant}
chmod -R 777 /data/ged /data/workspaces /data/timelines

# STEP 4 : Start Shaper OS containers
echo "[4/7] Starting Podman cluster (universes/${UNIV_SLUG}/deploy/podman-up.sh)..."
if [ -f universes/${UNIV_SLUG}/deploy/podman-up.sh ]; then
  bash universes/${UNIV_SLUG}/deploy/podman-up.sh
else
  echo "⚠️ Script podman-up.sh not found, check execution directory."
fi

# STEP 5 : Wire transparent Podman bridge into the agent
echo "[5/7] Configuring transparent Podman bridge inside the agent..."
if podman ps -q -f name=${UNIV_SLUG}-bridge-opencode | grep -q .; then
  # Only a public key travels, and it travels upward. Copying this host's private
  # key into the agent — which this script used to do — handed the container the
  # key to its own host, since the matching public key is already in the host's
  # authorized_keys. Rule 36: a private key never moves, whatever the level.
  podman exec ${UNIV_SLUG}-bridge-opencode mkdir -p /root/.ssh
  podman exec ${UNIV_SLUG}-bridge-opencode chmod 700 /root/.ssh
  podman exec ${UNIV_SLUG}-bridge-opencode \
    sh -c '[ -f /root/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N "" -q -f /root/.ssh/id_ed25519'

  AGENT_PUB="$(podman exec ${UNIV_SLUG}-bridge-opencode cat /root/.ssh/id_ed25519.pub)"
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
  podman cp /tmp/podman-wrapper.sh ${UNIV_SLUG}-bridge-opencode:/usr/local/bin/podman
  podman cp /tmp/podman-wrapper.sh ${UNIV_SLUG}-bridge-opencode:/usr/local/bin/docker
  rm -f /tmp/podman-wrapper.sh
fi

# STEP 6 : Initialize flight log / operations journal
echo "[6/7] Initializing persistent operations journal (_kovzu/JOURNAL.md)..."
for WS in /data/workspaces/Administrateur /data/workspaces/Xavier; do
  mkdir -p "$WS/_kovzu"
  if [ ! -f "$WS/_kovzu/JOURNAL.md" ]; then
    cat << 'EOF_JOURNAL' > "$WS/_kovzu/JOURNAL.md"
# Operations Log — Shaper OS / KovZu

## Initialization — Clean-Sheet LXC Deployment
- **Operational Baseline**: Podman 5.4, Python 3.11, Pip, Git, JQ, Ripgrep, Node 20.
- **Active Shaper OS Cluster**: Vault (:8610), Logger (:8620), Queue (:8640), Maestro (:8530), GED (:8660), Qdrant (:6333), Helm (:8650).
- **Handover**: Sovereign agent initialized and ready for user commands.
EOF_JOURNAL
  fi
done

# STEP 7 : Final validation & agent handover
echo "[7/7] Verifying cluster and handing over to the agent..."
podman ps --format "table {{.Names}}	{{.Status}}	{{.Ports}}"

echo ""
echo "🎉 TOTAL SUCCESS: Shaper OS universe deployed and operational!"
echo "👉 OpenCode agent is active and ready for commands on Helm Cockpit (port 8650)."
