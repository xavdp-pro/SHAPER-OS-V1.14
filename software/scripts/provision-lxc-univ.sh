#!/usr/bin/env bash
# ==============================================================================
# SHAPER OS — Universal Parametric LXC & WireGuard Mesh Provisioning Engine
# Rule 0B Compliant: 100% Infrastructure Agnostic & Parametric
# ==============================================================================
set -euo pipefail

# ------------------------------------------------------------------------------
# 1. Parameter Resolution & Defaults
# ------------------------------------------------------------------------------
usage() {
    cat <<EOF
Usage: $0 [options]

Required Options:
  --vmid <id>               Container ID (e.g. 130)
  --hostname <name>         Container hostname (e.g. univ-node-01)
  --mesh-ip <ip>            Assigned IP on the private WireGuard mesh (e.g. 10.87.78.40)
  --gateway-ssh <user@host> SSH connection string to the central WireGuard Gateway

Optional Environmental Overrides:
  --gateway-pubkey <key>    Public key of the central WireGuard gateway (or set WG_GATEWAY_PUBKEY)
  --gateway-endpoint <ep>   Public host:port of the gateway (or set WG_GATEWAY_ENDPOINT)
  --mesh-subnet <cidr>      Allowed mesh CIDR (default: 10.87.78.0/24 or set WG_MESH_SUBNET)
  --dns <servers>           DNS servers (default: 1.1.1.1,8.8.8.8 or set WG_DNS)
  --cores <num>             Allocated CPU cores (default: 2 or set CONTAINER_CORES)
  --memory <mb>             Allocated RAM in MB (default: 2048 or set CONTAINER_RAM)
  --disk <gb>               Rootfs disk size in GB (default: 16 or set CONTAINER_DISK)
  --bridge <iface>          Host bridge network device (default: vmbr0 or set BRIDGE_DEV)
  --storage <pool>          Storage pool name (default: local-lvm or set STORAGE_POOL)
  --template <path>         OS template path (default: local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst)

Example:
  $0 --vmid 130 --hostname univ-immo-dev --mesh-ip 10.87.78.40 --gateway-ssh root@10.51.15.1
EOF
    exit 1
}

VMID=""
HOSTNAME=""
CLIENT_MESH_IP=""
GATEWAY_SSH_HOST=""

GATEWAY_PUBKEY="${WG_GATEWAY_PUBKEY:-}"
GATEWAY_ENDPOINT="${WG_GATEWAY_ENDPOINT:-}"
MESH_SUBNET="${WG_MESH_SUBNET:-10.87.78.0/24}"
DNS_SERVERS="${WG_DNS:-1.1.1.1, 8.8.8.8}"
CORES="${CONTAINER_CORES:-2}"
MEMORY="${CONTAINER_RAM:-2048}"
DISK="${CONTAINER_DISK:-16}"
BRIDGE="${BRIDGE_DEV:-vmbr0}"
STORAGE="${STORAGE_POOL:-local-lvm}"
TEMPLATE="${TEMPLATE_PATH:-local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --vmid) VMID="$2"; shift 2 ;;
        --hostname) HOSTNAME="$2"; shift 2 ;;
        --mesh-ip) CLIENT_MESH_IP="$2"; shift 2 ;;
        --gateway-ssh) GATEWAY_SSH_HOST="$2"; shift 2 ;;
        --gateway-pubkey) GATEWAY_PUBKEY="$2"; shift 2 ;;
        --gateway-endpoint) GATEWAY_ENDPOINT="$2"; shift 2 ;;
        --mesh-subnet) MESH_SUBNET="$2"; shift 2 ;;
        --dns) DNS_SERVERS="$2"; shift 2 ;;
        --cores) CORES="$2"; shift 2 ;;
        --memory) MEMORY="$2"; shift 2 ;;
        --disk) DISK="$2"; shift 2 ;;
        --bridge) BRIDGE="$2"; shift 2 ;;
        --storage) STORAGE="$2"; shift 2 ;;
        --template) TEMPLATE="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

if [[ -z "$VMID" || -z "$HOSTNAME" || -z "$CLIENT_MESH_IP" || -z "$GATEWAY_SSH_HOST" ]]; then
    echo "Error: Missing mandatory parameters."
    usage
fi

SKEL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../skel" && pwd)"

echo "=============================================================================="
echo "SHAPER OS — Generic Parametric Provisioning Engine"
echo "=============================================================================="
echo "Target Container : ${HOSTNAME} (VMID: ${VMID})"
echo "Mesh IP Address  : ${CLIENT_MESH_IP}"
echo "Gateway Host     : ${GATEWAY_SSH_HOST}"
echo "Resource Allocation: ${CORES} cores / ${MEMORY}MB RAM / ${DISK}GB Disk"
echo "=============================================================================="

# ------------------------------------------------------------------------------
# 2. Container Instantiation (Hypervisor Abstraction)
# ------------------------------------------------------------------------------
echo -e "\n[1/5] Creating LXC container with nested virtualization & Linux capabilities..."
pct create "${VMID}" "${TEMPLATE}" \
  --hostname "${HOSTNAME}" \
  --memory "${MEMORY}" \
  --cores "${CORES}" \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 name=eth0,bridge="${BRIDGE}",ip=dhcp \
  --features nesting=1,keyctl=1 \
  --unprivileged 1 \
  --start 0

# Inject Linux Capabilities, AppArmor uncontainment, and device nodes for Nested Podman & WireGuard
if [[ -f "/etc/pve/lxc/${VMID}.conf" ]]; then
    cat <<EOF >> "/etc/pve/lxc/${VMID}.conf"

# --- SHAPER OS Nested Podman & WireGuard Capabilities ---
lxc.apparmor.profile: unconfined
lxc.cgroup2.devices.allow: a
lxc.cap.drop: 

# Device Passthroughs for FUSE (overlay) and TUN (WireGuard)
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file 0 0
lxc.cgroup2.devices.allow: c 10:229 rwm
lxc.mount.entry: /dev/fuse dev/fuse none bind,create=file 0 0
EOF
fi

pct start "${VMID}"
echo "Waiting for guest OS initialization..."
sleep 4

# ------------------------------------------------------------------------------
# 3. System Dist-Upgrade & Runtime Packages
# ------------------------------------------------------------------------------
echo -e "\n[2/5] Upgrading guest system and installing runtime engines..."
pct exec "${VMID}" -- bash -c 'apt-get update && apt-get dist-upgrade -y && apt-get install -y podman crun fuse-overlayfs wireguard wireguard-tools iproute2 curl git'

# ------------------------------------------------------------------------------
# 4. Injection of Standard Skeleton (Rule 11)
# ------------------------------------------------------------------------------
echo -e "\n[3/5] Injecting canonical skel (/etc/bash.bashrc, /etc/inputrc)..."
if [[ -d "${SKEL_DIR}/etc" ]]; then
    pct push "${VMID}" "${SKEL_DIR}/etc/bash.bashrc" /etc/bash.bashrc
    pct push "${VMID}" "${SKEL_DIR}/etc/inputrc" /etc/inputrc
fi

# ------------------------------------------------------------------------------
# 5. WireGuard Key Generation
# ------------------------------------------------------------------------------
echo -e "\n[4/5] Generating client WireGuard keypair..."
pct exec "${VMID}" -- bash -c '
  mkdir -p /etc/wireguard
  cd /etc/wireguard
  umask 077
  wg genkey | tee client_private.key | wg pubkey > client_public.key
'
CLIENT_PUBKEY=$(pct exec "${VMID}" -- cat /etc/wireguard/client_public.key)

# Retrieve Gateway Public Key and Endpoint if not supplied
if [[ -z "$GATEWAY_PUBKEY" ]]; then
    echo "Querying Gateway public key from ${GATEWAY_SSH_HOST}..."
    GATEWAY_PUBKEY=$(ssh "${GATEWAY_SSH_HOST}" "cat /etc/wireguard/server_public.key || wg show wg0 public-key")
fi

if [[ -z "$GATEWAY_ENDPOINT" ]]; then
    echo "Resolving Gateway endpoint from ${GATEWAY_SSH_HOST}..."
    GATEWAY_IP=$(ssh "${GATEWAY_SSH_HOST}" "curl -s ifconfig.me || hostname -I | awk '{print \$1}'")
    GATEWAY_ENDPOINT="${GATEWAY_IP}:51820"
fi

# ------------------------------------------------------------------------------
# 6. Bidirectional WireGuard Registration
# ------------------------------------------------------------------------------
echo -e "\n[5/5] Registering peer dynamically on WireGuard Gateway (${GATEWAY_SSH_HOST})..."
ssh "${GATEWAY_SSH_HOST}" "wg set wg0 peer '${CLIENT_PUBKEY}' allowed-ips '${CLIENT_MESH_IP}/32'"
ssh "${GATEWAY_SSH_HOST}" "cat <<EOF >> /etc/wireguard/wg0.conf

# Peer: ${HOSTNAME} (VMID ${VMID})
[Peer]
PublicKey = ${CLIENT_PUBKEY}
AllowedIPs = ${CLIENT_MESH_IP}/32
EOF"

pct exec "${VMID}" -- bash -c "cat <<EOF > /etc/wireguard/wg0.conf
[Interface]
PrivateKey = \$(cat /etc/wireguard/client_private.key)
Address = ${CLIENT_MESH_IP}/32
DNS = ${DNS_SERVERS}

[Peer]
PublicKey = ${GATEWAY_PUBKEY}
Endpoint = ${GATEWAY_ENDPOINT}
AllowedIPs = ${MESH_SUBNET}
PersistentKeepalive = 25
EOF"

pct exec "${VMID}" -- systemctl enable --now wg-quick@wg0

echo -e "\n=============================================================================="
echo "SUCCESS: LXC Container ${VMID} (${HOSTNAME}) is fully operational on Mesh IP ${CLIENT_MESH_IP}"
echo "=============================================================================="
