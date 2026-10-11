#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#renewal
# Installs the parent's daily bootstrap renewal in the universe container:
# <universe>-bootstrap-renewal.service and .timer, rendered from ../systemd/,
# then enabled. Run once, as root, after deploy/podman-up.sh.
#
#   SYSTEMD_DIR (default /etc/systemd/system)   where the units are written
#   RENEWAL_ALERT_UNIT (e.g. <universe>-watch.service)
#                                               the unit that carries a failed
#                                               renewal to the universe's human
#                                               channel, started at once by
#                                               OnFailure= (decision L); unset,
#                                               the failed unit waits for the
#                                               watcher's next run
#   NO_SYSTEMCTL=1                              render only (tests)
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
# The settings the service will read are checked as podman-up.sh checks them
# — read, never executed, only the base's parameters, no secret
# (deploy/settings.sh, INTENT.md#settings) — before anything is rendered.
# shellcheck source=/dev/null
source "$UNIV/deploy/settings.sh"
shaper_settings_load "[install-renewal-timer]" || exit 1
UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
[[ "$UNIVERSE" =~ ^univ-[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "[install-renewal-timer] SHAPER_UNIVERSE must be an instance slug, got $UNIVERSE" >&2; exit 1; }
[[ "$UNIV" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "[install-renewal-timer] the universe path $UNIV holds characters a unit file would misread" >&2; exit 1; }
DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
NAME="${UNIVERSE}-bootstrap-renewal"
# The service renews the universe this run was configured for: the same
# variables file, named in its environment (none: the universe's own
# cfg-univ-minimal.env, read by the script itself).
# The service reads only its settings file: a setting this run took from its
# own environment would not reach it, so it is named here and refused
# (RENEWAL_ALERT_UNIT excepted: it is rendered into the unit, not read by it).
for name in $(compgen -v); do
  entry="$(shaper_settings_entry "$name")" || continue
  [[ "$name" != RENEWAL_ALERT_UNIT && "${entry%% *}" == setting && -n "${!name:-}" && -z "${SHAPER_SETTINGS_FILE_LINE[$name]:-}" ]] || continue
  echo "[install-renewal-timer] $name is set in this run's environment, not in the settings file the service will read: put it in ${SHAPER_SETTINGS_FILE:-the settings file (ENV_FILE)}. Halt." >&2
  exit 1
done
ENV_LINE="# ENV_FILE: the universe's own cfg-univ-minimal.env"
if [[ -n "${ENV_FILE:-}" ]]; then
  [[ "$ENV_FILE" == /dev/null ]] || ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
  [[ "$ENV_FILE" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "[install-renewal-timer] $ENV_FILE holds characters a unit file would misread" >&2; exit 1; }
  ENV_LINE="Environment=ENV_FILE=$ENV_FILE"
fi
ALERT_LINE="# OnFailure: none declared (RENEWAL_ALERT_UNIT); the watcher reads the failed unit at its next run"
if [[ -n "${RENEWAL_ALERT_UNIT:-}" ]]; then
  [[ "$RENEWAL_ALERT_UNIT" =~ ^[A-Za-z0-9@._:-]+\.service$ ]] || { echo "[install-renewal-timer] RENEWAL_ALERT_UNIT must name one systemd service, got $RENEWAL_ALERT_UNIT" >&2; exit 1; }
  ALERT_LINE="OnFailure=$RENEWAL_ALERT_UNIT"
fi
for kind in service timer; do
  sed -e "s|@UNIVERSE@|$UNIVERSE|g" -e "s|@UNIV@|$UNIV|g" -e "s|@ENV_LINE@|$ENV_LINE|g" -e "s|@ALERT_LINE@|$ALERT_LINE|g" \
    "$UNIV/systemd/bootstrap-renewal.$kind.in" > "$DIR/$NAME.$kind.next"
  chmod 0644 "$DIR/$NAME.$kind.next"
  mv -f "$DIR/$NAME.$kind.next" "$DIR/$NAME.$kind"
done
echo "[install-renewal-timer] $DIR/$NAME.service and .timer written"
if [[ "${NO_SYSTEMCTL:-0}" != 1 ]]; then
  systemctl daemon-reload
  systemctl enable --now "$NAME.timer"
  systemctl list-timers "$NAME.timer" --no-pager
fi
