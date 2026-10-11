#!/usr/bin/env bash
# Intent: software/universes/_template/INTENT.md#base-units
# Runs one of the base's own operations on this universe, after the same
# checks as podman-up.sh, with the universe's settings file named in ENV_FILE:
#
#   deploy/base.sh lifecycle-drill.sh          the restart and recreation drill
#   deploy/base.sh restore-drill.sh            the restore into fresh volumes
#   deploy/base.sh install-renewal-timer.sh    the daily bootstrap renewal (once, as root);
#                                              its service names the same ENV_FILE
#   deploy/base.sh renew-bootstraps.sh         one renewal run, by hand
#
# The base's drills source their settings file without the variables-only and
# no-secret guards (its renewal scripts make both checks themselves, since the
# timer runs them directly); here the file has passed them first, and the
# universe is the manifest's. Run them this way rather than from base/deploy/
# directly.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
TAG="[base]"
# shellcheck source=/dev/null
source "$UNIV/deploy/lib.sh"

script="${1:-}"
case "$script" in
  lifecycle-drill.sh|restore-drill.sh|install-renewal-timer.sh|renew-bootstraps.sh) shift ;;
  *) halt "deploy/base.sh <lifecycle-drill.sh|restore-drill.sh|install-renewal-timer.sh|renew-bootstraps.sh> [arguments]" ;;
esac

refuse_the_mold
load_universe_env
refuse_earlier_template "$SHAPER_UNIVERSE"
check_base_layout
check_base_units_agree

echo "$TAG $SHAPER_UNIVERSE — $script of univ-minimal at $(base_revision)"
bash "$BASE/deploy/$script" "$@"
