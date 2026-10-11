#!/usr/bin/env bash
# Intent: software/universes/_template/INTENT.md#materialise
# Brings up a universe derived from the template, inside its universe container.
#
#   podman-up.sh                     bring the universe up; keep what runs as declared
#   podman-up.sh --preflight         check and say what a run would do; change nothing
#   podman-up.sh --recreate <slug>   also recreate that base unit (vault, logger, queue,
#                                    maestro), proof or all
# (the arguments are the base's: base/deploy/podman-up.sh checks them)
#
# Layers 0-3 are the base units — Vault, Logger, Queue and Maestro, each one
# functional Podman holding its application and its own MariaDB server (Rules 4
# and 26). They are born, kept or recreated by base/deploy/podman-up.sh:
# univ-minimal at the revision deploy/install-base.sh installed, with its birth
# order (Vault alone first; the pin of its public key; each recreated unit's new
# random incarnation registered by root through Vault's socket; then Logger,
# Queue and Maestro) — never by a copy of it here.
#
# Before the base runs, this script checks what only the universe knows: its
# settings file is variables only and names the manifest's universe; the
# universe is not of the earlier template's shape (file stores, an AI bridge);
# base/ is installed, with the universe's own schedule and lock; and the
# manifest declares the four base units exactly as that base births them.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
TAG="[podman-up]"
# shellcheck source=/dev/null
source "$UNIV/deploy/lib.sh"

refuse_the_mold
load_universe_env
refuse_earlier_template "$SHAPER_UNIVERSE"
check_base_layout
check_base_units_agree

echo "$TAG $SHAPER_UNIVERSE — layers 0-3, vault, logger, queue, maestro: univ-minimal at $(base_revision)"
bash "$BASE/deploy/podman-up.sh" "$@"

# The universe's own units start here, after the base layers and in the
# manifest's bootOrder: each one functional Podman holding its application and
# its own MariaDB server, born like the base units (one account = one MariaDB
# account = one database, a private socket, no TCP, readiness gated on the
# database), its image pinned in cfg-image-lock.json. The template has none.
