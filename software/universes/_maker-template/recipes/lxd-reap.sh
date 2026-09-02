#!/usr/bin/env bash
# Intent: software/universes/_maker-template/INTENT.md
#
# End of life for one instance, on an LXD host. Destruction is a scheduled
# state, never a timer inside a robot: the governor decides the deadline has
# passed and asks for this. The recipe's job is to make it true, and to
# PROVE it — a reaping that is not verified is a promise, and Rule 31 asks
# for an end, not an intention.
#
# Argv, in order and by contract:
#   $1 rowId    the ledger row whose life ends
#   $2 klass    the class (informational)
#   $3 matrix   the matrix name (informational)
#   $4 digest   sha256:… (informational — the matrix outlives its instances)
#   $5 account  the account it belonged to (never used to build a command)
#   $6 env      dev | test | demo | prod
set -euo pipefail

ROW_ID="${1:?rowId}"; KLASS="${2:-}"; MATRIX="${3:-}"
DIGEST="${4:-}"; ACCOUNT="${5:-}"; ENV="${6:-}"

CLEAN_ROW="$(printf '%s' "$ROW_ID" | tr -cd 'a-z0-9-' | sed 's/^inst-//' | tail -c 43)"
INSTANCE="inst-$CLEAN_ROW"

say() { printf '[lxd-reap] %s\n' "$1"; }

# 1. Already gone is a success, not an error. A reaping asked twice must not
#    fail the second time, or a retry would leave the row DEGRADED forever.
if ! lxc info "$INSTANCE" > /dev/null 2>&1; then
  say "$INSTANCE is already gone"
  printf '{"instance":"%s","reaped":true,"wasPresent":false}\n' "$INSTANCE"
  exit 0
fi

# 2. A production universe is never reaped by a robot. Rule 10 destroys TEST
#    after proof, Rule 36 destroys DEV after promotion; a PROD instance ends
#    by a human decision, elsewhere.
if [[ "$ENV" == "prod" ]]; then
  echo "[lxd-reap] $INSTANCE is a production universe — a robot does not end one" >&2
  exit 4
fi

# 3. Take the evidence BEFORE destroying: what existed, and what it held.
BEFORE_STATE="$(lxc list "$INSTANCE" --format csv -c s | head -1)"
say "found $INSTANCE ($BEFORE_STATE), ending it"

# 4. Stop, then delete. Volumes and their contents go with the container:
#    total destruction is what the manifest declared (dataLifecycle).
lxc stop "$INSTANCE" --force > /dev/null 2>&1 || true
lxc delete "$INSTANCE" --force > /dev/null

# 5. PROVE the absence. A GC that says "done" without looking is exactly the
#    lie proof.sh was corrected for: verify, then report.
if lxc info "$INSTANCE" > /dev/null 2>&1; then
  echo "[lxd-reap] $INSTANCE still answers after deletion — the end is not proven" >&2
  exit 5
fi
say "absence verified"

printf '{"instance":"%s","reaped":true,"wasPresent":true,"stateBefore":"%s"}\n' \
  "$INSTANCE" "$BEFORE_STATE"
