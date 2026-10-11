#!/usr/bin/env bash
# Intent: software/universes/_template/INTENT.md#proof
# Proves a universe derived from the template from outside its units, and
# repairs nothing. The base units' proof is the base's own — base/deploy/proof.sh
# at the revision installed: the Rule 26 inventory of each unit (application and
# MariaDB in one container, identities, grants, refusals, no TCP, non-writable
# paths), its identity in Vault, and one real effect per unit read back from its
# database. The template has no unit of its own to prove.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
TAG="[proof]"
# shellcheck source=/dev/null
source "$UNIV/deploy/lib.sh"

refuse_the_mold
load_universe_env
check_base_layout
check_base_units_agree

echo "$TAG $SHAPER_UNIVERSE — base units: univ-minimal at $(base_revision)"
status=0
base_script proof.sh "$@" || status=$?

# A universe that adds units proves them here, each with the same inventory
# and one real effect read back from its own database, before it declares them.

exit "$status"
