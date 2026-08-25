#!/usr/bin/env bash
# ==============================================================================
# SHAPER OS — Quick 4-Step LXC & Podman Bootstrap Script
# ==============================================================================
set -euo pipefail

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <vmid> <hostname> [template_path]"
    echo "Example: $0 130 univ-node-01"
    exit 1
fi

VMID="$1"
HOSTNAME="$2"
TEMPLATE="${3:-local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKEL_DIR="$(cd "${SCRIPT_DIR}/../skel" && pwd)"

echo "------------------------------------------------------------------------------"
echo "SHAPER OS — Bootstrapping LXC Node: ${HOSTNAME} (VMID ${VMID})"
echo "------------------------------------------------------------------------------"

# 1. Create LXC Container with Podman & WireGuard Capabilities
echo "[1/4] Creating container ${VMID} (${HOSTNAME})..."
pct create "${VMID}" "${TEMPLATE}" \
  --hostname "${HOSTNAME}" \
  --memory 2048 \
  --cores 2 \
  --rootfs local-lvm:16 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1,keyctl=1 \
  --unprivileged 1 \
  --start 0

if [ -f "/etc/pve/lxc/${VMID}.conf" ]; then
    cat <<EOF >> "/etc/pve/lxc/${VMID}.conf"
lxc.apparmor.profile: unconfined
lxc.cgroup2.devices.allow: a
lxc.cap.drop: 
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file 0 0
lxc.cgroup2.devices.allow: c 10:229 rwm
lxc.mount.entry: /dev/fuse dev/fuse none bind,create=file 0 0
EOF
fi

pct start "${VMID}"
echo "Waiting for container initialization..."
sleep 3

# 2. Inject Skeleton Configuration Files
echo "[2/4] Injecting skel files (/etc/bash.bashrc, /etc/inputrc)..."
if [ -d "${SKEL_DIR}/etc" ]; then
    pct push "${VMID}" "${SKEL_DIR}/etc/bash.bashrc" /etc/bash.bashrc
    pct push "${VMID}" "${SKEL_DIR}/etc/inputrc" /etc/inputrc
fi

# 3. Upgrade and Install Podman Runtime Engines
echo "[3/4] Performing dist-upgrade and installing Podman runtime..."
pct exec "${VMID}" -- bash -c 'apt-get update && apt-get dist-upgrade -y && apt-get install -y podman crun fuse-overlayfs wireguard wireguard-tools curl git'

# 4. Inject Host SSH Public Key
echo "[4/4] Injecting host SSH public key..."
pct exec "${VMID}" -- mkdir -p /root/.ssh
SSH_PUB_KEY=""
for key in "$HOME/.ssh/id_ed25519.pub" "$HOME/.ssh/id_rsa.pub"; do
    if [ -f "$key" ]; then
        SSH_PUB_KEY="$key"
        break
    fi
done

if [ -n "$SSH_PUB_KEY" ]; then
    pct push "${VMID}" "$SSH_PUB_KEY" /root/.ssh/authorized_keys
    pct exec "${VMID}" -- chmod 700 /root/.ssh
    pct exec "${VMID}" -- chmod 600 /root/.ssh/authorized_keys
    echo "SSH public key ($SSH_PUB_KEY) successfully installed."
else
    echo "Warning: No host SSH public key found in ~/.ssh/ (id_ed25519.pub or id_rsa.pub)."
fi

echo "------------------------------------------------------------------------------"
echo "SUCCESS: LXC Container ${VMID} (${HOSTNAME}) is ready with Podman & SSH access!"
echo "------------------------------------------------------------------------------"
