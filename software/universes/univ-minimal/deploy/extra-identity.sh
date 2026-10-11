#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#extra-identities
# The parent's registration of identities an installing universe adds to the
# base's (SOL decision N: brick-ipbx, brick-voice, brick-tools for the Clinic
# kit), with the same tool, root path and records as podman-up.sh uses for the
# base's own holders. Shared interface: software/packages/pkg-auth/PROFILES.md.
#
#   extra-identity.sh pin      --to <file>
#       installs Vault's signing public key — the parent's derivation that
#       podman-up.sh pinned — at <file>, root's, mode 0644: what a receiver
#       mounts read-only as UNIT_AUTH_PUBLIC_KEY_FILE.
#   extra-identity.sh live     --unit <slug> --bootstrap <file>
#       exit 0 and the recorded incarnation on standard output when Vault holds
#       the identity exactly as recorded (incarnation, epoch, grants, bootstrap
#       digest, not revoked, unexpired) and <file> is the recorded bootstrap;
#       exit 1 otherwise. A kit keeps a unit only when this succeeds.
#   extra-identity.sh register --unit <slug> --bootstrap <file> --owner <uid> \
#                              (--profile <audience>/<profile>=<scope> | --grant <audience>=<scope>)…
#       a new incarnation <slug>-<16 hex> with exactly these rights profiles: a
#       fresh bootstrap, its digest applied by root through Vault's socket and
#       read back, then the bootstrap delivered to <file> (owner <uid>, 0600,
#       in a directory only root may change) and the identity recorded
#       root-only. Standard output: the new incarnation, nothing else. The
#       epoch moves: the previous incarnation's credentials stop at once.
#   extra-identity.sh revoke   --unit <slug>
#       revokes the identity in one transaction with its UNIT_IDENTITY_REVOKED
#       evidence. Only a new `register` brings the unit back; until then the
#       daily renewal reports it `revoked`.
#
# The unit must be named in RENEWAL_EXTRA_IDENTITIES (the settings file):
# what the daily renewal inventories is exactly what may be registered here.
# A base unit or `proof` is refused — podman-up.sh owns those. One parent at
# a time (Vault's parent.lock). No bootstrap, token or key reaches a command
# line, a log or this script's output.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$UNIV/manifest.json"
# shellcheck source=/dev/null
source "$UNIV/deploy/settings.sh"
shaper_settings_load "[extra-identity]" || exit 1
UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
# shellcheck source=/dev/null
source "$UNIV/deploy/unit-probes.sh"
halt() { echo "[extra-identity] $*" >&2; exit 1; }
say() { echo "[extra-identity] $*" >&2; }
usage() { halt "usage: extra-identity.sh pin --to <file> | live --unit <slug> --bootstrap <file> | register --unit <slug> --bootstrap <file> --owner <uid> (--profile <audience>/<profile>=<scope> | --grant <audience>=<scope>)… | revoke --unit <slug>"; }

SLUG_RE='^[a-z]([a-z0-9_-]{0,30}[a-z0-9_])?$'
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
REG_TOOL=/apps/vault/app/packages/pkg-vault/unit-registration.js
CTR="${UNIVERSE}-ctr-vault"

(( $# )) || usage
COMMAND="$1"; shift
UNIT=""; BOOTSTRAP=""; OWNER=""; TO=""; GRANTS=()
while (( $# )); do
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --unit) UNIT="$2" ;;
    --bootstrap) BOOTSTRAP="$2" ;;
    --owner) OWNER="$2" ;;
    --to) TO="$2" ;;
    --profile|--grant) GRANTS+=("$1" "$2") ;;
    *) usage ;;
  esac
  shift 2
done

# A file the parent writes for a unit: absolute, in an existing directory only
# root can change (unit-probes.sh path_protected).
target_ok() {  # <file> <what>
  local fault
  [[ "$1" == /* && "$1" != */ ]] || halt "$2 must be an absolute file path"
  [[ -d "$(dirname -- "$1")" ]] || halt "$2's directory $(dirname -- "$1") does not exist"
  fault="$(path_protected "$(dirname -- "$1")")" || halt "$2's directory is not protected: $fault"
}

# The unit: a declared extra identity, never one of the base's.
unit_ok() {
  [[ "$UNIT" =~ $SLUG_RE ]] || halt "--unit takes a functional slug"
  [[ " $(jq -r '.bricks[].database.slug' "$MANIFEST" | tr '\n' ' ') proof " != *" $UNIT "* ]] \
    || halt "$UNIT belongs to the base: podman-up.sh registers it"
  [[ " ${RENEWAL_EXTRA_IDENTITIES:-} " == *" $UNIT "* ]] \
    || halt "$UNIT is not declared in RENEWAL_EXTRA_IDENTITIES (${RENEWAL_EXTRA_IDENTITIES:-none}): the daily renewal would not know it. Declare it in the settings file first."
}

UNIVERSE_ID="$(universe_uuid)"
[[ "$UNIVERSE_ID" =~ $UUID_RE ]] || halt "no universe identity in $VAULT_ETC_DIR/universe-id: run podman-up.sh first"

vault_running() { [[ "$(podman inspect -f '{{.State.Running}}' "$CTR" 2>/dev/null)" == true ]]; }

case "$COMMAND" in
  pin)
    [[ -n "$TO" && -z "$UNIT$BOOTSTRAP$OWNER" && ${#GRANTS[@]} == 0 ]] || usage
    PIN="$VAULT_ETC_DIR/vault-signing.pub"
    [[ -s "$PIN" && "$(head -n1 "$PIN")" == '-----BEGIN PUBLIC KEY-----' ]] || halt "no pinned Vault key at $PIN: run podman-up.sh first"
    target_ok "$TO" "--to"
    install -m 0644 -o root -g root "$PIN" "$TO.next"
    mv -f -- "$TO.next" "$TO"
    say "Vault public key pinned at $TO (sha256 $(sha256sum < "$TO" | cut -c1-16)…)"
    exit 0
    ;;
  live)
    [[ -n "$UNIT" && -n "$BOOTSTRAP" && -z "$OWNER$TO" && ${#GRANTS[@]} == 0 ]] || usage
    unit_ok
    vault_running || halt "$CTR is not running: the identity cannot be checked"
    if identity_live "$UNIT" "$BOOTSTRAP"; then
      record_field "$UNIT" incarnation
      exit 0
    fi
    say "$UNIT holds no live identity matching its record and $BOOTSTRAP"
    exit 1
    ;;
  register|revoke) ;;
  *) usage ;;
esac

if [[ "$COMMAND" == register ]]; then
  [[ -n "$UNIT" && -n "$BOOTSTRAP" && -n "$OWNER" && -z "$TO" && ${#GRANTS[@]} -gt 0 ]] || usage
  [[ "$OWNER" =~ ^[1-9][0-9]{0,9}$ ]] || halt "--owner takes the unit's numeric uid (not root)"
  target_ok "$BOOTSTRAP" "--bootstrap"
else
  [[ -n "$UNIT" && -z "$BOOTSTRAP$OWNER$TO" && ${#GRANTS[@]} == 0 ]] || usage
fi
unit_ok

# One parent at a time (podman-up.sh and renew-bootstraps.sh hold the same lock).
exec 9>"$VAULT_ETC_DIR/parent.lock"
flock -w "${PARENT_LOCK_WAIT_SECONDS:-600}" 9 || halt "another parent run holds $VAULT_ETC_DIR/parent.lock"
podman() { command podman "$@" 9>&-; }  # no child inherits the lock
vault_running || halt "$CTR is not running: root's authority over Vault's database cannot be exercised"
IMAGE="$(podman inspect -f '{{.Image}}' "$CTR")"
STAGE="$VAULT_ETC_DIR/registration/extra"
install -d -m 0700 -o root -g root "$VAULT_ETC_DIR/registration" "$STAGE" "$RECORDS_DIR"
# The tool, from the running Vault's image: no network, no capability.
tool() { podman run --rm --network none --cap-drop=all --security-opt=no-new-privileges --entrypoint node \
  -e "SHAPER_UNIVERSE_ID=$UNIVERSE_ID" -v "$STAGE:/identity:Z" "$IMAGE" "$REG_TOOL" "$@"; }
rootapply() { podman exec -i "$CTR" mariadb --no-defaults -S /run/vault/mysqld.sock -uroot -N -B vault < "$1"; }

if [[ "$COMMAND" == revoke ]]; then
  stmt="$STAGE/$UNIT.revoke.sql"
  ( umask 077; tool revoke --unit "$UNIT" > "$stmt" ) || halt "the Vault image did not build the revocation of $UNIT"
  answer="$(rootapply "$stmt" 2>&1)" || { rm -f -- "$stmt"; halt "root's revocation of $UNIT did not complete (nothing changed): $(grep -m1 '^ERROR' <<<"$answer" || echo "$answer" | head -n1)"; }
  rm -f -- "$stmt"
  [[ "$answer" == "$UNIT"$'\t'revoked$'\t'* && "${answer##*$'\t'}" =~ ^[0-9]+$ ]] || halt "Vault's answer to the revocation of $UNIT is unexpected: re-read unit_identities before acting"
  say "$UNIT revoked (epoch ${answer##*$'\t'}); its credentials and issuance stop now. Only a new register brings it back."
  exit 0
fi

# ── register ─────────────────────────────────────────────────────────────────
INC="$UNIT-$(openssl rand -hex 8)"
staged="$STAGE/$UNIT.bootstrap"
stmt="$STAGE/$UNIT.sql"
rm -f -- "$staged" "$stmt"
trap 'rm -f -- "$staged" "$stmt" "$BOOTSTRAP.next"' EXIT
( umask 077; tool register --unit "$UNIT" --incarnation "$INC" "${GRANTS[@]}" --bootstrap-file "/identity/$UNIT.bootstrap" > "$stmt" ) \
  || halt "the Vault image refused the registration of $UNIT (its grants are checked before any bootstrap exists)"
[[ -s "$staged" ]] || halt "no bootstrap was written for $UNIT"
rootapply "$stmt" >/dev/null || halt "root could not apply the registration of $UNIT to Vault's database; the bootstrap in place is unchanged"
digest="$(sha256sum < "$staged" | cut -c1-64)"
row="$(rootsql vault vault -e "SELECT CONCAT(epoch, ' ', grants) FROM unit_identities WHERE universe_id = '$UNIVERSE_ID' AND unit_id = '$UNIT' AND incarnation = '$INC' AND bootstrap_digest = '$digest' AND NOT revoked AND bootstrap_expires_at > UTC_TIMESTAMP(3)")"
epoch="${row%% *}"; grants="${row#* }"
[[ "$epoch" =~ ^[0-9]+$ && "$grants" == '{'* ]] || halt "Vault does not hold $UNIT's registration ($INC) just applied; the bootstrap in place is unchanged"
# Delivered only now that Vault holds its digest: a run stopped before leaves
# the previous file in place.
install -m 0600 -o "$OWNER" -g "$OWNER" "$staged" "$BOOTSTRAP.next"
chown "$OWNER:$OWNER" "$BOOTSTRAP.next"; chmod 0600 "$BOOTSTRAP.next"
mv -f -- "$BOOTSTRAP.next" "$BOOTSTRAP"
( umask 077; printf '{"unit":"%s","incarnation":"%s","epoch":%s,"grants":%s,"bootstrapDigest":"%s","registeredAt":"%s"}\n' \
    "$UNIT" "$INC" "$epoch" "$grants" "$digest" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RECORDS_DIR/$UNIT.json.next" )
mv -f -- "$RECORDS_DIR/$UNIT.json.next" "$RECORDS_DIR/$UNIT.json"
say "$UNIT registered: incarnation $INC, epoch $epoch, grants $grants; bootstrap delivered to $BOOTSTRAP (owner $OWNER, 0600)"
echo "$INC"
