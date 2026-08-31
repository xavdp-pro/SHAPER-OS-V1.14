#!/usr/bin/env bash
# Intent: software/universes/_maker-template/INTENT.md
#
# The governor looks at its child — through the maker's hands, because the
# governor touches no machine. The child carries its own acceptance spec
# (/etc/shaper/checks.json, baked by its class); this recipe pulls that spec
# OUT of the child and hands it to the verifier, a browser in a podman
# container whose whole input is that closed, declarative data. The spec is
# authored by a class and executed on this host: it must never be code, and
# the verifier refuses anything outside its vocabulary.
#
# Argv, same contract as every recipe:
#   $1 rowId  $2 klass  $3 matrix  $4 digest  $5 account  $6 env
#
# Exit 0 with the verdict JSON on the last line (VALIDATED), exit 1 when the
# child failed its own spec (VALIDATION_FAILED — the verdict still rides the
# event, naming the failing step), other codes when the harness broke.
set -euo pipefail

ROW_ID="${1:?rowId}"; KLASS="${2:-}"; MATRIX="${3:-}"
DIGEST="${4:-}"; ACCOUNT="${5:-}"; ENV="${6:-}"

VERIFIER_IMAGE="${SHAPER_VERIFIER_IMAGE:-xavdp-verifier:1}"
EVIDENCE_DIR="${SHAPER_EVIDENCE_DIR:-/var/lib/shaper/evidence}"

CLEAN_ROW="$(printf '%s' "$ROW_ID" | tr -cd 'a-z0-9-' | sed 's/^inst-//' | tail -c 43)"
INSTANCE="inst-$CLEAN_ROW"

say() { printf '[lxd-validate] %s\n' "$1" >&2; }

# 1. The child must exist and answer to its name.
lxc info "$INSTANCE" > /dev/null 2>&1 || { echo "[lxd-validate] $INSTANCE is not on this host" >&2; exit 2; }

# 2. Its address, waited for briefly — a child fresh from PURRING has one.
ADDR=""
for _ in $(seq 1 15); do
  ADDR="$(lxc list "$INSTANCE" --format csv -c 4 | head -1 | awk '{print $1}')"
  [[ -n "$ADDR" ]] && break
  sleep 2
done
[[ -n "$ADDR" ]] || { echo "[lxd-validate] $INSTANCE has no address" >&2; exit 2; }

# 3. The spec comes OUT of the child. No spec is not this recipe's case: the
#    stamp reported the fact and the governor only sends us children that
#    declared one. Finding none here means the facts changed — say so.
SPEC="$(mktemp /tmp/checks-XXXXXX.json)"
trap 'rm -f "$SPEC"' EXIT
lxc file pull "$INSTANCE/etc/shaper/checks.json" "$SPEC" 2> /dev/null \
  || { echo "[lxd-validate] $INSTANCE declared checks at stamp time but ships none now" >&2; exit 2; }

# 4. The verifier looks. Host network so the container reaches the child's
#    bridge address; the spec mounted read-only; evidence kept per row.
mkdir -p "$EVIDENCE_DIR"
say "verifying $INSTANCE at http://$ADDR/ against its own spec"
set +e
VERDICT="$(podman run --rm --network host \
  -v "$SPEC:/spec/checks.json:ro" \
  -v "$EVIDENCE_DIR:/evidence" \
  "$VERIFIER_IMAGE" \
  --url "http://$ADDR/" --checks /spec/checks.json \
  --evidence "/evidence/$INSTANCE.png")"
CODE=$?
set -e

# 5. The verdict is the last line, and it rides the event into the ledger —
#    the operator reads WHICH step failed without touching the host.
printf '%s\n' "$VERDICT"
case "$CODE" in
  0) say "verdict: PASS" ;;
  1) say "verdict: FAIL (evidence at $EVIDENCE_DIR/$INSTANCE.png)" ;;
  *) say "the harness itself broke (exit $CODE)" ;;
esac
exit "$CODE"
