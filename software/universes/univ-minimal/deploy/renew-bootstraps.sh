#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#renewal
# The parent's daily selective bootstrap renewal (SOL decision L, which
# replaces the all-or-nothing halt of DECISIONS-20261011 §D), run by the
# universe container's timer (../systemd/, install-renewal-timer.sh) — never by
# Maestro, never inside a unit.
#
# A unit's bootstrap expires 30 days after its registration. The identities
# are inventoried from the composition — every credential holder the manifest
# declares (HOLDS_CREDENTIAL, unit-probes.sh) and the proof's identity — so a
# parent record that disappeared is reported `missing`, never skipped. With
# pkg-vault/unit-registration.js renew, run from the running Vault's own image
# with no network and no capability, it builds one transaction that root
# applies through Vault's socket:
#   - each identity is checked against Vault: universe, unit, incarnation,
#     epoch, grants, recorded digest, not revoked, not expired, its row locked;
#   - each consistent one expiring within 7 days gets 30 days more from its
#     current expiry, with its UNIT_BOOTSTRAP_RENEWED proof in the transaction;
#   - a missing, expired, revoked, inconsistent or unexpected one stays exactly
#     as it is, and UNIT_BOOTSTRAP_RENEWAL_PARTIAL (ERROR, the same run id) is
#     committed with the proofs;
#   - any SQL or proof failure rolls the whole transaction back.
# It creates no identity, changes no incarnation, epoch or grant, never
# revives a revoked identity, restarts nothing, and prints no token: records
# and statements carry digests only.
#
# One line per identity, then the summary; the outcome is also written,
# root-only and without a secret, to registration/renewal/last.json beside the
# records. Exit status — what the timer's unit, and so the watcher, sees:
#   0  complete   every identity renewed or current
#   1  halted     nothing was renewed by this run: the universe identity, an
#                 input or root's authority over Vault could not be verified,
#                 or the transaction failed and rolled back
#   2  partial    the consistent identities are renewed (listed); the blocked
#                 ones are unchanged and expire unless the operator acts
#   3  unknown    root's acknowledgement was lost: the proofs were re-read and
#                 say what was committed, or could not be read — then the next
#                 run re-reads them before it repeats anything
# Any non-zero status fails <universe>-bootstrap-renewal.service: the
# universe's watcher reports a failed unit on its declared human channel, and
# the unit's OnFailure= (install-renewal-timer.sh, RENEWAL_ALERT_UNIT) starts
# it at once. That alert depends neither on Vault's relay nor on Logger.
#
#   RENEWAL_EXTRA_IDENTITIES (default none)  identities the installing universe
#     registers beyond the base's (space-separated slugs), in its variables file
#   RENEW_WITHIN_SECONDS (default 604800, 7 days)   renew what expires within this
#   RENEW_EXTEND_SECONDS (default 2592000, 30 days) by this much
#     these two are overridden only to drill the renewal (lifecycle-drill.sh),
#     never in the timer.
set -uo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$UNIV/manifest.json"
# The settings file is read, never executed, and carries no secret
# (SOL-DECISIONS-2 §M): the timer's service runs this script directly, so the
# checks podman-up.sh makes are made here too, before anything is sourced. A
# refusal halts the run (exit 1), and the failed unit reaches the watcher.
# The same two functions as podman-up.sh, verbatim but for the tag.
shaper_env_file_is_variables_only() {
  local file="$1" bad status=0
  bad="$(grep -nvE '^[[:space:]]*(#|$)|^[A-Z][A-Z0-9_]*=("([^"`$]|\$[^(])*\$?"|'"'"'[^'"'"']*'"'"'|[^[:blank:];&|()<>`'"'"'"]*)$' "$file")" || status=$?
  if (( status == 1 )); then
    return 0
  elif (( status == 2 )); then
    echo "[renew-bootstraps] cannot read $file — a file that cannot be checked is not sourced" >&2
    return 1
  fi
  echo "[renew-bootstraps] $file is not a variables file — these lines would be EXECUTED by source, not exported:" >&2
  echo "$bad" | sed 's/^/[renew-bootstraps]   line /' >&2
  echo "[renew-bootstraps] only blank lines, # comments and KEY=value are allowed, the value quoted or a bare word without whitespace or shell operators; put a note for a human behind #" >&2
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
  echo "[renew-bootstraps] $file gives a secret a value: ${found[*]} — a settings file carries parameters and *_FILE references only." >&2
  echo "[renew-bootstraps] Put the secret in its root-only source file (the secrets store, deploy/unit-probes.sh secrets_of) and leave its line empty or remove it. Halt." >&2
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
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
# shellcheck source=/dev/null
source "$UNIV/deploy/unit-probes.sh"
RENEWAL_DIR="$VAULT_ETC_DIR/registration/renewal"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
SLUG_RE='^[a-z]([a-z0-9_-]{0,30}[a-z0-9_])?$'
RENEWAL_ID=""
LINES=()       # unit<TAB>state<TAB>expiry<TAB>detail, as Vault answered or the proofs say
RENEWED=0; BLOCKED=0

# The outcome, root-only, for the operator and the watcher: no secret in it
# (slugs, states, expiries, field names, run id). Written only where a Vault
# was born; never fails the run.
write_last() {  # <outcome> <exit> <message>
  [[ -d "$VAULT_ETC_DIR/registration" ]] || return 0
  install -d -m 0700 "$RENEWAL_DIR" 2>/dev/null || return 0
  local units="" line unit state expiry detail message
  for line in "${LINES[@]}"; do
    IFS=$'\t' read -r unit state expiry detail <<<"$line"
    units+="${units:+,}{\"unit\":\"$unit\",\"state\":\"$state\",\"expiry\":\"$expiry\",\"detail\":\"$detail\"}"
  done
  message="$(tr -d '"\\\000-\037' <<<"$3")"
  [[ "$RENEWED" =~ ^[0-9]+$ ]] || RENEWED=0
  [[ "$BLOCKED" =~ ^[0-9]+$ ]] || BLOCKED=0
  ( umask 077
    printf '{"renewalId":"%s","at":"%s","universe":"%s","outcome":"%s","exit":%s,"renewed":%s,"blocked":%s,"units":[%s],"message":"%s"}\n' \
      "$RENEWAL_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$UNIVERSE" "$1" "$2" "$RENEWED" "$BLOCKED" "$units" "$message" > "$RENEWAL_DIR/last.json.next" ) \
    && mv -f "$RENEWAL_DIR/last.json.next" "$RENEWAL_DIR/last.json"
}
finish() {  # <outcome> <exit> <message>
  if [[ "$2" == 0 ]]; then echo "[renew-bootstraps] $3"; else echo "[renew-bootstraps] ${1^^}: $3" >&2; fi
  write_last "$@"
  exit "$2"
}
halt() { finish halted 1 "$*"; }

WITHIN="${RENEW_WITHIN_SECONDS:-604800}"
EXTEND="${RENEW_EXTEND_SECONDS:-2592000}"
[[ "$WITHIN" =~ ^[0-9]+$ && "$EXTEND" =~ ^[0-9]+$ ]] || halt "RENEW_WITHIN_SECONDS and RENEW_EXTEND_SECONDS are whole seconds"
UNIVERSE_ID="$(universe_uuid)"
[[ "$UNIVERSE_ID" =~ $UUID_RE ]] || halt "no universe identity in $VAULT_ETC_DIR/universe-id: nothing can be verified, nothing renewed"
export SHAPER_UNIVERSE_ID="$UNIVERSE_ID"

# One parent at a time (podman-up.sh holds the same lock).
[[ -d "$VAULT_ETC_DIR" ]] || halt "$VAULT_ETC_DIR is absent: no universe to renew"
exec 9>"$VAULT_ETC_DIR/parent.lock"
flock -w "${PARENT_LOCK_WAIT_SECONDS:-600}" 9 || halt "another parent run holds $VAULT_ETC_DIR/parent.lock"
podman() { command podman "$@" 9>&-; }  # no child inherits the lock

# ── The identities: the composition's, then any record outside it ──────────
EXPECTED=()
while read -r slug; do
  holds_credential "$slug" && EXPECTED+=("$slug")
done < <(jq -r '.bricks[].database.slug' "$MANIFEST")
(( ${#EXPECTED[@]} )) || halt "the manifest declares no credential holder: the composition cannot be inventoried"
EXPECTED+=(proof)  # podman-up.sh registers the proof's identity with every birth
# A universe that installs this base and registers identities of its own
# (decision N: the Clinic units) declares them, so they are renewed and
# reported missing like the base's — never `unexpected`.
for slug in ${RENEWAL_EXTRA_IDENTITIES:-}; do
  [[ "$slug" =~ $SLUG_RE ]] || halt "RENEWAL_EXTRA_IDENTITIES holds $slug, not a functional slug: the composition cannot be inventoried"
  [[ " ${EXPECTED[*]} " == *" $slug "* ]] || EXPECTED+=("$slug")
done
shopt -s nullglob
records=("$RECORDS_DIR"/*.json)
shopt -u nullglob
if (( ${#records[@]} == 0 )) && [[ ! -s "$VAULT_ETC_DIR/master.key" && ! -d "$APPS_ROOT/vault/sav/mariadb/vault" ]]; then
  echo "[renew-bootstraps] no Vault and no identity recorded: nothing to renew"
  exit 0
fi
CTR="${UNIVERSE}-ctr-vault"
[[ "$(podman inspect -f '{{.State.Running}}' "$CTR" 2>/dev/null)" == true ]] \
  || halt "$CTR is not running: root's authority over Vault's database cannot be exercised; nothing renewed"
IMAGE="$(podman inspect -f '{{.Image}}' "$CTR")"
install -d -m 0700 "$RENEWAL_DIR" || halt "cannot keep the renewal's state in $RENEWAL_DIR"

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
# The tool, from the running Vault's image: no network, no capability. It
# reads the records read-only; with no records directory, an empty one (every
# identity then answers missing) — the parent's path is never created here.
RECORDS_MOUNT="$RECORDS_DIR"
[[ -d "$RECORDS_DIR" ]] || { RECORDS_MOUNT="$work/no-records"; install -d -m 0700 "$RECORDS_MOUNT"; }
tool() { podman run --rm --network none --cap-drop=all --security-opt=no-new-privileges --entrypoint node \
  -e SHAPER_UNIVERSE_ID -v "$RECORDS_MOUNT:/records:ro,Z" "$IMAGE" /apps/vault/app/packages/pkg-vault/unit-registration.js "$@"; }
# Root's path into Vault's database, its answer on stdout, its error in $work/sql.err.
rootapply() { podman exec -i "$CTR" mariadb --no-defaults -S /run/vault/mysqld.sock -uroot -N -B vault < "$1" 2> "$work/sql.err"; }

# What one run committed, from its proofs (unit-registration.js readback):
# fills LINES with its renewals and sets READ_OUTCOME (partial, halted or
# none). Fails when the proofs cannot be read.
readback() {  # <renewal id>
  local answer unit state expiry detail read_ok=0
  READ_OUTCOME=none; LINES=(); RENEWED=0; BLOCKED=0
  tool readback --renewal-id "$1" > "$work/readback.sql" || return 1
  answer="$(rootapply "$work/readback.sql")" || return 1
  while IFS=$'\t' read -r unit state expiry detail; do
    case "$unit|$state" in
      '#|read') read_ok=1 ;;
      '*|partial'|'*|halted') READ_OUTCOME="$state"; [[ "$detail" =~ ^[0-9]+$ ]] && BLOCKED="$detail" ;;
      *) [[ "$unit" =~ $SLUG_RE && "$state" == renewed && "$expiry" =~ ^[0-9T:.Z-]+$ ]] || return 1
         LINES+=("$unit"$'\t'renewed$'\t'"$expiry"$'\t'-); RENEWED=$((RENEWED + 1)) ;;
    esac
  done <<<"$answer"
  (( read_ok ))
}
print_lines() {
  local line unit state expiry detail
  for line in "${LINES[@]}"; do
    IFS=$'\t' read -r unit state expiry detail <<<"$line"
    printf '  %-10s %-12s bootstrap expires %s%s\n' "$unit" "$state" "$expiry" "$([[ "$detail" == - || -z "$detail" ]] || echo " ($detail)")"
  done
}
blocked_list() {
  local line unit state expiry detail out=""
  for line in "${LINES[@]}"; do
    IFS=$'\t' read -r unit state expiry detail <<<"$line"
    case "$state" in renewed|current) ;; *) out+="${out:+, }$unit $state${detail:+ ($detail)}" ;; esac
  done
  echo "$out"
}
# The acknowledgement was lost or unreadable: re-read the proofs before
# anything is repeated, and say exactly what they show.
settle() {  # <renewal id> <why>
  if ! readback "$1"; then
    finish unknown 3 "$2; the proofs of renewal $1 cannot be re-read: its outcome is unknown, and the next run re-reads them before it repeats anything ($RENEWAL_DIR/unsettled)"
  fi
  rm -f -- "$RENEWAL_DIR/unsettled"
  print_lines
  if (( RENEWED == 0 )) && [[ "$READ_OUTCOME" == none ]]; then
    halt "$2; the proofs of renewal $1 show nothing committed: the transaction rolled back, nothing was renewed by this run"
  fi
  local alert=""
  [[ "$READ_OUTCOME" == none ]] || alert=", with its $READ_OUTCOME alert (UNIT_BOOTSTRAP_RENEWAL_${READ_OUTCOME^^}, $BLOCKED blocked)"
  finish unknown 3 "$2; the proofs of renewal $1 show what was committed: $RENEWED renewed$alert"
}

# ── A run whose outcome is still unknown is settled first ─────────────────
if [[ -e "$RENEWAL_DIR/unsettled" ]]; then
  previous="$(cat "$RENEWAL_DIR/unsettled" 2>/dev/null)"
  [[ "$previous" =~ $UUID_RE ]] || halt "$RENEWAL_DIR/unsettled does not name a renewal: re-read Vault's outbox by hand, then remove it"
  if ! readback "$previous"; then
    halt "the outcome of renewal $previous is still unknown: its proofs cannot be re-read, so nothing is repeated"
  fi
  echo "[renew-bootstraps] the earlier renewal $previous, settled from its proofs: $RENEWED renewed$( [[ "$READ_OUTCOME" == none ]] || echo ", its $READ_OUTCOME alert committed")"
  print_lines
  rm -f -- "$RENEWAL_DIR/unsettled"
  LINES=(); RENEWED=0; BLOCKED=0
fi

# ── The run ─────────────────────────────────────────────────────────────────
RENEWAL_ID="$(cat /proc/sys/kernel/random/uuid)"
[[ "$RENEWAL_ID" =~ $UUID_RE ]] || halt "no run identifier could be drawn"
ARGS=()
for unit in "${EXPECTED[@]}"; do ARGS+=(--expect "$unit"); done
for f in "${records[@]}"; do ARGS+=(--record "/records/$(basename "$f")"); done
tool renew "${ARGS[@]}" --renewal-id "$RENEWAL_ID" --within-seconds "$WITHIN" --extend-seconds "$EXTEND" > "$work/renewal.sql" 2> "$work/tool.err" \
  || halt "the Vault image did not build the renewal: an input cannot be verified ($(grep -m 1 '\[unit-registration\]' "$work/tool.err" || head -n 1 "$work/tool.err")); nothing renewed"

# The run's id is kept before root applies it: an acknowledgement lost
# between the two is settled from the proofs, by this run or the next.
( umask 077; printf '%s\n' "$RENEWAL_ID" > "$RENEWAL_DIR/unsettled" )
if ! answer="$(rootapply "$work/renewal.sql")"; then
  settle "$RENEWAL_ID" "root's transaction did not complete ($(grep -m 1 '^ERROR' "$work/sql.err" || echo "the client failed without an error line"))"
fi

want=$(( ${#EXPECTED[@]} + 0 ))
for f in "${records[@]}"; do
  u="$(basename "$f" .json)"; [[ " ${EXPECTED[*]} " == *" $u "* ]] || want=$((want + 1))
done
summary=""
while IFS=$'\t' read -r unit state expiry detail; do
  [[ -n "$unit" ]] || continue
  if [[ "$unit" == '*' ]]; then summary="$state"; RENEWED="$expiry"; BLOCKED="$detail"; continue; fi
  [[ "$unit" =~ $SLUG_RE && " renewed current missing expired revoked inconsistent unexpected " == *" $state "* \
     && "$expiry" =~ ^([0-9T:.Z-]+|-)$ && "$detail" =~ ^[a-z,-]+$ ]] || { summary=garbled; break; }
  LINES+=("$unit"$'\t'"$state"$'\t'"$expiry"$'\t'"$detail")
done <<<"$answer"
if [[ "$summary" == halted ]]; then
  RENEWED=0; BLOCKED=0
  rm -f -- "$RENEWAL_DIR/unsettled"
  halt "Vault holds no identity of universe $UNIVERSE_ID: the universe identity cannot be verified, nothing was checked or renewed; UNIT_BOOTSTRAP_RENEWAL_HALTED committed (renewal $RENEWAL_ID)"
fi
if [[ ! "$summary" =~ ^(complete|partial)$ || ! "$RENEWED" =~ ^[0-9]+$ || ! "$BLOCKED" =~ ^[0-9]+$ ]] || (( ${#LINES[@]} != want )); then
  incomplete="Vault's answer is incomplete (${#LINES[@]} of $want identities${summary:+, summary $summary})"
  LINES=(); RENEWED=0; BLOCKED=0
  settle "$RENEWAL_ID" "$incomplete"
fi
rm -f -- "$RENEWAL_DIR/unsettled"
print_lines
if [[ "$summary" == partial ]]; then
  finish partial 2 "$UNIVERSE ($UNIVERSE_ID): $RENEWED renewed, $BLOCKED blocked and left unchanged — $(blocked_list). The renewed ones are committed; each blocked identity expires unless the operator acts. UNIT_BOOTSTRAP_RENEWAL_PARTIAL committed (renewal $RENEWAL_ID)"
fi
finish complete 0 "$UNIVERSE ($UNIVERSE_ID): ${#LINES[@]} identities checked, $RENEWED renewed (expiring within $((WITHIN / 86400)) day(s)), none blocked (renewal $RENEWAL_ID)"
