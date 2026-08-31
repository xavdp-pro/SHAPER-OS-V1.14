#!/usr/bin/env bash
# Intent: software/universes/_maker-template/INTENT.md
#
# Stamp one instance from a matrix, on an LXD host. Frozen recipe: it takes
# typed positional arguments and interpolates none of them into a composed
# command. Every value that came from a form reaches lxc as a separate argv
# entry, never as part of a string a shell will parse.
#
# Argv, in order and by contract:
#   $1 rowId    the ledger row this stamp realises
#   $2 klass    the class being stamped
#   $3 matrix   the matrix name (informational)
#   $4 digest   sha256:… — the matrix identity, and the file that must exist
#   $5 account  the account this instance belongs to (arbitrary text)
#   $6 env      dev | test | demo | prod
set -euo pipefail

ROW_ID="${1:?rowId}"; KLASS="${2:?klass}"; MATRIX="${3:?matrix}"
DIGEST="${4:?digest}"; ACCOUNT="${5:?account}"; ENV="${6:?env}"

MATRICES_DIR="${SHAPER_MATRICES_DIR:-/var/lib/shaper/matrices}"
BARE="${DIGEST#sha256:}"
FILE="$MATRICES_DIR/$BARE.tar.gz"

# The instance name comes from the LEDGER ROW, never from account text: the
# row id is ours and its shape is known, the account belongs to a stranger.
# (Anti-collision by construction — what varies goes in data, not in the id.)
CLEAN_ROW="$(printf '%s' "$ROW_ID" | tr -cd 'a-z0-9-' | sed 's/^inst-//' | tail -c 43)"
INSTANCE="inst-$CLEAN_ROW"
ALIAS="matrix-$BARE"

say() { printf '[lxd-stamp] %s\n' "$1"; }

# 1. The bytes must be here, and be the ones claimed. A matrix is its
#    content: verifying the name would verify nothing.
[[ -f "$FILE" ]] || { echo "[lxd-stamp] matrix $DIGEST is not on this host" >&2; exit 2; }
ACTUAL="$(sha256sum "$FILE" | cut -d' ' -f1)"
[[ "$ACTUAL" == "$BARE" ]] || {
  echo "[lxd-stamp] $FILE does not hash to its name — refusing to stamp unverified bytes" >&2
  exit 3
}
say "matrix verified ($DIGEST)"

# 2. Import once per digest; the alias is derived from the digest, so a
#    second stamp of the same matrix costs nothing.
#
#    Under a LOCK, because check-then-import is a race: two simultaneous
#    stamps of the same digest both saw the alias absent, both imported, and
#    the loser died mid-import — one visitor's demo was silently never born
#    (found on terrain, first two-instance birth, 2026-08-31). The lock is
#    per digest: stamps of different matrices never wait on each other.
LOCK_DIR="${SHAPER_LOCK_DIR:-/run/lock}"
exec 9> "$LOCK_DIR/shaper-import-$BARE.lock"
flock 9
if ! lxc image info "$ALIAS" > /dev/null 2>&1; then
  lxc image import "$FILE" --alias "$ALIAS" > /dev/null
  say "matrix imported as $ALIAS"
fi
exec 9>&-

# 3. Idempotent by construction: the row already has its container or it
#    does not. Re-running a stamp never births a twin.
if lxc info "$INSTANCE" > /dev/null 2>&1; then
  say "instance $INSTANCE already exists — nothing to stamp"
else
  lxc launch "$ALIAS" "$INSTANCE" --profile "${SHAPER_LXC_PROFILE:-podman-univ}" < /dev/null > /dev/null
  say "instance $INSTANCE launched"
fi

# 4. The instance learns who it is — through a file, written by us, never by
#    a command built from the account string.
lxc exec "$INSTANCE" -- mkdir -p /etc/shaper
printf 'row=%s\nclass=%s\nmatrix=%s\ndigest=%s\nenv=%s\n' \
  "$ROW_ID" "$KLASS" "$MATRIX" "$DIGEST" "$ENV" \
  | lxc exec "$INSTANCE" -- tee /etc/shaper/instance.id > /dev/null
printf '%s' "$ACCOUNT" | lxc exec "$INSTANCE" -- tee /etc/shaper/account > /dev/null

# 5. Report facts, not hopes: the caller records what the host observed.
#    Among them: does this child ship an acceptance spec? The governor
#    derives validation work from that fact and learns nothing else about
#    what the class is — the spec's content never crosses this boundary.
STATE="$(lxc list "$INSTANCE" --format csv -c s | head -1)"
ADDR="$(lxc list "$INSTANCE" --format csv -c 4 | head -1 | awk '{print $1}')"
if lxc exec "$INSTANCE" -- test -s /etc/shaper/checks.json 2> /dev/null; then
  CHECKS=true
else
  CHECKS=false
fi
say "state=$STATE address=${ADDR:-pending} checks=$CHECKS"
printf '{"instance":"%s","state":"%s","address":"%s","digest":"%s","checks":%s}\n' \
  "$INSTANCE" "$STATE" "${ADDR:-}" "$DIGEST" "$CHECKS"
