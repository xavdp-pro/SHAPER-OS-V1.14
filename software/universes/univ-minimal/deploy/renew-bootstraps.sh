#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#renewal
# The parent's daily bootstrap renewal (DECISIONS-20261011 §D), run by the
# universe container's timer (../systemd/, install-renewal-timer.sh) — never by
# Maestro, never inside a unit.
#
# A unit's bootstrap expires 30 days after its registration. For every
# identity the parent recorded (podman-up.sh: registration/records/<unit>.json —
# unit, incarnation, epoch, grants, bootstrap digest), it builds with
# pkg-vault/unit-registration.js renew, run from the running Vault's own image
# with no network and no capability, one transaction that root applies through
# Vault's socket:
#   - every record is checked against Vault — universe, unit, incarnation,
#     epoch, grants, recorded digest, not revoked, not expired;
#   - when all hold, each bootstrap expiring within 7 days is extended by 30
#     days, with its UNIT_BOOTSTRAP_RENEWED proof in the same transaction;
#   - when one does not, nothing changes and UNIT_BOOTSTRAP_RENEWAL_HALTED
#     (level ERROR) is committed for Logger, and this script exits 1 — the
#     timer's unit fails, visibly.
# It creates no identity, changes no incarnation, epoch or grant, never
# revives a revoked identity, restarts nothing, and prints no token: records
# and statements carry digests only.
#
#   RENEW_WITHIN_SECONDS (default 604800, 7 days)   renew what expires within this
#   RENEW_EXTEND_SECONDS (default 2592000, 30 days) by this much
# Overridden only to drill the renewal (lifecycle-drill.sh), never in the timer.
set -uo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$UNIV/manifest.json"
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then set -a; source "$UNIV/cfg-univ-minimal.env"; set +a
fi
UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
# shellcheck source=/dev/null
source "$UNIV/deploy/unit-probes.sh"
halt() { echo "[renew-bootstraps] HALTED: $*" >&2; exit 1; }

WITHIN="${RENEW_WITHIN_SECONDS:-604800}"
EXTEND="${RENEW_EXTEND_SECONDS:-2592000}"
[[ "$WITHIN" =~ ^[0-9]+$ && "$EXTEND" =~ ^[0-9]+$ ]] || halt "RENEW_WITHIN_SECONDS and RENEW_EXTEND_SECONDS are whole seconds"
UNIVERSE_ID="$(universe_uuid)"
[[ "$UNIVERSE_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
  || halt "no universe identity in $VAULT_ETC_DIR/universe-id"
export SHAPER_UNIVERSE_ID="$UNIVERSE_ID"

# One parent at a time (podman-up.sh holds the same lock).
[[ -d "$VAULT_ETC_DIR" ]] || halt "$VAULT_ETC_DIR is absent: no universe to renew"
exec 9>"$VAULT_ETC_DIR/parent.lock"
flock -w "${PARENT_LOCK_WAIT_SECONDS:-600}" 9 || halt "another parent run holds $VAULT_ETC_DIR/parent.lock"
podman() { command podman "$@" 9>&-; }  # no child inherits the lock

shopt -s nullglob
records=("$RECORDS_DIR"/*.json)
shopt -u nullglob
if (( ${#records[@]} == 0 )); then
  # A Vault born without the parent's records (before 11 October 2026) has
  # identities nobody renews: that is a halt, not a quiet success.
  if [[ -s "$VAULT_ETC_DIR/master.key" || -d "$APPS_ROOT/vault/sav/mariadb/vault" ]]; then
    halt "a Vault was born here but $RECORDS_DIR records no identity: run deploy/podman-up.sh, which records each identity it registers"
  fi
  echo "[renew-bootstraps] no Vault and no identity recorded: nothing to renew"
  exit 0
fi
CTR="${UNIVERSE}-ctr-vault"
[[ "$(podman inspect -f '{{.State.Running}}' "$CTR" 2>/dev/null)" == true ]] \
  || halt "$CTR is not running: no identity can be checked; nothing renewed"
IMAGE="$(podman inspect -f '{{.Image}}' "$CTR")"

RECORD_ARGS=()
for f in "${records[@]}"; do RECORD_ARGS+=(--record "/records/$(basename "$f")"); done
statement="$(mktemp)"
trap 'rm -f -- "$statement"' EXIT
podman run --rm --network none --cap-drop=all --security-opt=no-new-privileges --entrypoint node \
  -e SHAPER_UNIVERSE_ID -v "$RECORDS_DIR:/records:ro,Z" \
  "$IMAGE" /apps/vault/app/packages/pkg-vault/unit-registration.js renew "${RECORD_ARGS[@]}" \
  --within-seconds "$WITHIN" --extend-seconds "$EXTEND" > "$statement" \
  || halt "the Vault image did not build the renewal from the records"
answer="$(podman exec -i "$CTR" mariadb --no-defaults -S /run/vault/mysqld.sock -uroot -N -B vault < "$statement")" \
  || halt "root could not apply the renewal to Vault's database"

bad=0; held=0; answered=0
while IFS=$'\t' read -r unit state expiry; do
  [[ -n "$unit" ]] || continue
  answered=$((answered + 1))
  printf '  %-10s %-9s bootstrap expires %s\n' "$unit" "$state" "$expiry"
  case "$state" in
    renewed|current) ;;
    held) held=$((held + 1)) ;;
    *) bad=$((bad + 1)) ;;
  esac
done <<<"$answer"
(( answered == ${#records[@]} )) || halt "Vault answered for $answered of ${#records[@]} identities: nothing is known renewed"
(( bad == 0 && held == 0 )) || halt "$bad identity record(s) do not match what Vault holds: nothing was renewed ($held consistent one(s) held); UNIT_BOOTSTRAP_RENEWAL_HALTED is committed for Logger"
echo "[renew-bootstraps] $UNIVERSE ($UNIVERSE_ID): ${#records[@]} identities checked; renewed what expired within $((WITHIN / 86400)) day(s)"
