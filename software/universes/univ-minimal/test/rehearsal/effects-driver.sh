#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#rehearsal
# Rehearsal-only: proof.sh's effects section (proof-effects.sh and
# proof-effects-units.sh), sourced exactly as proof.sh sources it, without the
# container inventory that only a real podman can answer.
set -uo pipefail
UNIV="$REHEARSAL_SOFTWARE/universes/univ-minimal"
MANIFEST="$UNIV/manifest.json"
UNIVERSE=univ-minimal
APPS_ROOT="$SHAPER_APPS_ROOT"
RUN_ID="proof-$(date -u +%Y%m%dT%H%M%SZ)-$$"
source "$UNIV/deploy/unit-probes.sh"
PASS=0; FAILS=0
ok()   { PASS=$((PASS + 1)); printf '  OK     %-24s %s\n' "$1" "$2"; }
fail() { FAILS=$((FAILS + 1)); printf '  FAIL   %-24s %s\n' "$1" "$2"; }
check() { local name="$1" detail="$2"; shift 2; if "$@"; then ok "$name" "$detail"; else fail "$name" "$detail"; fi; }
section() { printf '\n── %s\n' "$1"; }
declare -A PORT_OF=([vault]=8610 [logger]=8620 [queue]=8640 [maestro]=8630)
UNIVERSE_ID="$(universe_uuid)"
source "$UNIV/deploy/proof-effects.sh"
printf '\nEFFECTS %d passed, %d failed\n' "$PASS" "$FAILS"
(( FAILS == 0 ))
