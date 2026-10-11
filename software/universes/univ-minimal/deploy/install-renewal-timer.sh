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
# The settings file the service will name is checked as podman-up.sh checks
# it — read, never executed, no secret in it (SOL-DECISIONS-2 §M) — before it
# is sourced here or rendered into a unit. The same two functions, verbatim
# but for the tag.
shaper_env_file_is_variables_only() {
  local file="$1" bad status=0
  bad="$(grep -nvE '^[[:space:]]*(#|$)|^[A-Z][A-Z0-9_]*=("([^"`$]|\$[^(])*\$?"|'"'"'[^'"'"']*'"'"'|[^[:blank:];&|()<>`'"'"'"]*)$' "$file")" || status=$?
  if (( status == 1 )); then
    return 0
  elif (( status == 2 )); then
    echo "[install-renewal-timer] cannot read $file — a file that cannot be checked is not sourced" >&2
    return 1
  fi
  echo "[install-renewal-timer] $file is not a variables file — these lines would be EXECUTED by source, not exported:" >&2
  echo "$bad" | sed 's/^/[install-renewal-timer]   line /' >&2
  echo "[install-renewal-timer] only blank lines, # comments and KEY=value are allowed, the value quoted or a bare word without whitespace or shell operators; put a note for a human behind #" >&2
  return 1
}
SECRET_NAME_RE='(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|PWD|PASSPHRASE|API_KEY|MASTER_KEY|PRIVATE_KEY|ENCRYPTION_KEY|SECRET_KEY|ACCESS_KEY)$'
shaper_env_file_carries_no_secret() {
  local file="$1" line name value found=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*([A-Z][A-Z0-9_]*)=(.*)$ ]] || continue
    name="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    [[ "$name" == PWD || "$name" == OLDPWD ]] && continue
    [[ "$name" =~ $SECRET_NAME_RE ]] || continue
    [[ -z "$value" || "$value" == '""' || "$value" == "''" ]] && continue
    found+=("$name")
  done < "$file"
  (( ${#found[@]} == 0 )) && return 0
  echo "[install-renewal-timer] $file gives a secret a value: ${found[*]} — a settings file carries parameters and *_FILE references only." >&2
  echo "[install-renewal-timer] Put the secret in its root-only source file (the secrets store, deploy/unit-probes.sh secrets_of) and leave its line empty or remove it. Halt." >&2
  return 1
}
shaper_source_env() {
  shaper_env_file_is_variables_only "$1" || exit 1
  shaper_env_file_carries_no_secret "$1" || exit 1
  set -a; source "$1"; set +a
}
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
  shaper_source_env "$ENV_FILE"
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then
  shaper_source_env "$UNIV/cfg-univ-minimal.env"
fi
UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
[[ "$UNIVERSE" =~ ^univ-[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "[install-renewal-timer] SHAPER_UNIVERSE must be an instance slug, got $UNIVERSE" >&2; exit 1; }
[[ "$UNIV" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "[install-renewal-timer] the universe path $UNIV holds characters a unit file would misread" >&2; exit 1; }
DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
NAME="${UNIVERSE}-bootstrap-renewal"
# The service renews the universe this run was configured for: the same
# variables file, named in its environment (none: the universe's own
# cfg-univ-minimal.env, read by the script itself).
ENV_LINE="# ENV_FILE: the universe's own cfg-univ-minimal.env"
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
  ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
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
