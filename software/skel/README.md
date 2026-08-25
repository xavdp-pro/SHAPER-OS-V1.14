# System Skeleton & Container Bootstrapping Template (skel/)

## Purpose
This directory contains the canonical system configuration skeleton (`/etc/bash.bashrc`, `/etc/inputrc`) injected into freshly created Debian 13 (Trixie) / Proxmox LXC containers and Podman environments.

## Deployment Rule (Rule 11)
Upon initial container boot:
```bash
apt-get update && apt-get dist-upgrade -y && apt-get clean
cp -r skel/etc/* /etc/
```

This guarantees:
1. Unified shell behavior, interactive autocompletion, and history synchronization across all nodes.
2. UTF-8 locale and inputrc keybindings standardized for CLI operations and AI agents.
