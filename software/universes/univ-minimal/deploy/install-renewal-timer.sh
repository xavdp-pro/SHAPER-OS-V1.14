#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#renewal
# Installs the parent's daily bootstrap renewal in the universe container:
# <universe>-bootstrap-renewal.service and .timer, rendered from ../systemd/,
# then enabled. Run once, as root, after deploy/podman-up.sh.
#
#   SYSTEMD_DIR (default /etc/systemd/system)   where the units are written
#   NO_SYSTEMCTL=1                              render only (tests)
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then set -a; source "$UNIV/cfg-univ-minimal.env"; set +a
fi
UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
[[ "$UNIVERSE" =~ ^univ-[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "[install-renewal-timer] SHAPER_UNIVERSE must be an instance slug, got $UNIVERSE" >&2; exit 1; }
[[ "$UNIV" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "[install-renewal-timer] the universe path $UNIV holds characters a unit file would misread" >&2; exit 1; }
DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
NAME="${UNIVERSE}-bootstrap-renewal"
for kind in service timer; do
  sed -e "s|@UNIVERSE@|$UNIVERSE|g" -e "s|@UNIV@|$UNIV|g" "$UNIV/systemd/bootstrap-renewal.$kind.in" > "$DIR/$NAME.$kind.next"
  chmod 0644 "$DIR/$NAME.$kind.next"
  mv -f "$DIR/$NAME.$kind.next" "$DIR/$NAME.$kind"
done
echo "[install-renewal-timer] $DIR/$NAME.service and .timer written"
if [[ "${NO_SYSTEMCTL:-0}" != 1 ]]; then
  systemctl daemon-reload
  systemctl enable --now "$NAME.timer"
  systemctl list-timers "$NAME.timer" --no-pager
fi
