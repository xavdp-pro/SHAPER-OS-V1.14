#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#private-mariadb
# Materialises univ-minimal — Vault, Logger, Queue and Maestro — inside the
# universe container: one container per unit, holding the application and its
# own MariaDB server (Rules 4 and 26, Turbinobash method).
#
#   podman-up.sh                      bring the universe up; keep what runs as declared
#   podman-up.sh --preflight          check and say what a run would do; write,
#                                     register and start nothing
#   podman-up.sh --recreate <slug>    also recreate that unit (repeatable);
#   podman-up.sh --recreate proof     renew the proof's identity;
#   podman-up.sh --recreate all       every unit and the proof's identity
#
# It does only what the manifest declares, in the order bootOrder states, from
# the images the lock (or an explicitly published tag) names. Each unit image
# births its own database through its own root path (runtime/unit-mariadb);
# this script prepares the unit's declared volumes, the Vault's key material
# and the universe identity, and waits for each unit's readiness, which is
# gated on its MariaDB.
#
# A unit is recreated only when it must be: no container, a container not
# running, another image or run specification (the digest it was created
# with, label org.shaper.run-spec), an identity Vault no longer holds live,
# or an explicit --recreate. A unit that runs as declared is kept, with its
# incarnation. A recreated unit that holds a credential gets a new random
# incarnation, <slug>-<16 hex> (DECISIONS-20261011 §B); preflight, a re-run
# that recreates nothing and the bootstrap renewal (renew-bootstraps.sh) keep
# it.
#
# It is also the parent that lets units hold Vault-signed credentials
# (pkg-vault INTENT.md#parent-registration), in this birth order:
#   1. pin Vault's signing public key, derived here from the master key and
#      the universe UUID, for every unit that verifies a credential;
#   2. register a new incarnation for each recreated unit that owes evidence
#      to Logger (vault, queue, maestro), with its declared grants (grants_of
#      in unit-probes.sh), and for the proof's identity when it has none live
#      (PROOF_GRANTS); each bootstrap is a new owner-only file;
#   3. start (or keep) Vault; once it is ready, root applies the registrations
#      to Vault's database through its socket, reads them back, delivers the
#      bootstraps and records each identity root-only (registration/records/,
#      what renew-bootstraps.sh checks Vault against);
#   4. start (or keep) Logger, Queue and Maestro, layer by layer.
# No bootstrap value, password, key or token reaches a command line, git or
# this script's output.
#
# Names follow docs/architecture/NAMING.md, prefixed by the instance slug:
#   <universe>-ctr-<slug>          the unit: its application and its MariaDB
# There is no <universe>-ctr-<slug>-mariadb any more; one found is refused.
set -euo pipefail

UNIV="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$UNIV/manifest.json"
LOCK="$UNIV/cfg-image-lock.json"

# ── 0. What this run is asked to do ────────────────────────────────────────
PREFLIGHT=0
RECREATE=" ${PODMAN_UP_RECREATE:-} "
while (( $# )); do
  case "$1" in
    --preflight) PREFLIGHT=1 ;;
    --recreate)
      [[ "${2:-}" =~ ^[a-z][a-z0-9_-]*$ ]] || { echo "[podman-up] --recreate takes a unit slug, proof or all" >&2; exit 2; }
      RECREATE+="$2 "; shift ;;
    *) echo "[podman-up] unknown argument $1 — podman-up.sh [--preflight] [--recreate <slug>|proof|all]…" >&2; exit 2 ;;
  esac
  shift
done
asked_to_recreate() { [[ "$RECREATE" == *" $1 "* || "$RECREATE" == *" all "* ]]; }

# ── 1. Configuration: a variables file is read, never executed ─────────────
shaper_env_file_is_variables_only() {
  local file="$1" bad status=0
  bad="$(grep -nvE '^[[:space:]]*(#|$)|^[A-Z][A-Z0-9_]*=("([^"`$]|\$[^(])*\$?"|'"'"'[^'"'"']*'"'"'|[^[:blank:];&|()<>`'"'"'"]*)$' "$file")" || status=$?
  if (( status == 1 )); then
    return 0
  elif (( status == 2 )); then
    echo "[podman-up] cannot read $file — a file that cannot be checked is not sourced" >&2
    return 1
  fi
  echo "[podman-up] $file is not a variables file — these lines would be EXECUTED by source, not exported:" >&2
  echo "$bad" | sed 's/^/[podman-up]   line /' >&2
  echo "[podman-up] only blank lines, # comments and KEY=value are allowed, the value quoted or a bare word without whitespace or shell operators; put a note for a human behind #" >&2
  return 1
}
shaper_source_env() {
  shaper_env_file_is_variables_only "$1" || exit 1
  set -a; source "$1"; set +a
}
if [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]]; then
  shaper_source_env "$ENV_FILE"
elif [[ -f "$UNIV/cfg-univ-minimal.env" ]]; then
  shaper_source_env "$UNIV/cfg-univ-minimal.env"
fi

for tool in podman jq openssl ss sha256sum flock; do
  command -v "$tool" >/dev/null || { echo "[podman-up] $tool is missing in the universe container — install it at first boot" >&2; exit 1; }
done

UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
[[ "$UNIVERSE" =~ ^univ-[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "[podman-up] SHAPER_UNIVERSE must be an instance slug (univ-…), got $UNIVERSE" >&2; exit 1; }
# Definitions shared with the proofs: who holds a credential and who pins
# Vault's key (HOLDS_CREDENTIAL, grants_of, PINNED, PROOF_GRANTS), where the
# proof keeps its state and identity (PROOF_DIR), the root path (rootsql).
# shellcheck source=/dev/null
source "$UNIV/deploy/unit-probes.sh"
halt() { echo "[podman-up] $*" >&2; exit 1; }
say() { echo "[podman-up] $*"; }
(( PREFLIGHT )) && say "preflight — nothing is written, registered or started"
# A new incarnation for a recreated unit: random, never a clock reading.
new_incarnation() { echo "$1-$(openssl rand -hex 8)"; }

# ── 2. Images: pinned, or explicitly published, never guessed ───────────────
# SHAPER_REGISTRY=localhost with SHAPER_IMAGE_TAG names images built on this
# machine with SHAPER_PUSH=0 — a DEV qualification only, never a TEST or PROD.
resolve_image() {
  local key="$1" pinned
  pinned="$(jq -r --arg k "$key" '.images[$k] // empty' "$LOCK")"
  if [[ -n "$pinned" ]]; then echo "$pinned"; return; fi
  if [[ -n "${SHAPER_REGISTRY:-}" && -n "${SHAPER_IMAGE_TAG:-}" ]]; then
    echo "${SHAPER_REGISTRY}/shaper/brick-${key#img-}:${SHAPER_IMAGE_TAG}"; return
  fi
  echo "[podman-up] $key is not pinned in cfg-image-lock.json and no SHAPER_REGISTRY/SHAPER_IMAGE_TAG is set." >&2
  echo "[podman-up] The registry is an infrastructure prerequisite, one per machine — ask the operator which one this machine uses." >&2
  exit 1
}

# ── 3. The declared ports are free, or held by this universe's own units ────
while read -r brick port; do
  slug="$(jq -r --arg b "$brick" '.bricks[$b].database.slug' "$MANIFEST")"
  if ss -ltnH "sport = :$port" | grep -q .; then
    if ! podman ps --format '{{.Names}}' | grep -qx "${UNIVERSE}-ctr-${slug}"; then
      echo "[podman-up] port $port declared by $brick is held by something that is not ${UNIVERSE}-ctr-${slug} — stop and disable it; no second port is invented" >&2
      ss -ltnpH "sport = :$port" >&2 || true
      exit 1
    fi
  fi
done < <(jq -r '.bricks | to_entries[] | "\(.key) \(.value.port)"' "$MANIFEST")

# ── 4. The shape: one container per unit, nothing beside it ─────────────────
while read -r slug; do
  if podman container exists "${UNIVERSE}-ctr-${slug}-mariadb"; then
    echo "[podman-up] ${UNIVERSE}-ctr-${slug}-mariadb exists: a separate database container, the shape Rule 4 forbids." >&2
    echo "[podman-up] Migrate it with a logical dump into the unit's fresh volume (INTENT.md#migration); this script never adopts it. Halt." >&2
    exit 1
  fi
done < <(jq -r '.bricks[].database.slug' "$MANIFEST")

# ── 5. Instance secrets and identity the construction path owns ─────────────
# The API token, the master key and the universe identity live under the
# Vault's etc/vault/, which is never mounted as a directory: the container
# receives the key file alone, read-only, and the token through its
# environment, by name.
VAULT_UID="$(jq -r '.bricks["brick-vault"].database.uid' "$MANIFEST")"
VAULT_ETC="$APPS_ROOT/vault/etc/vault"
TOKEN_FILE="$VAULT_ETC/api-token"
KEY_FILE="$VAULT_ETC/master.key"
if (( ! PREFLIGHT )); then
  install -d -m 0755 -o root -g root "$APPS_ROOT" "$APPS_ROOT/vault" "$APPS_ROOT/vault/etc"
  install -d -m 0700 -o root -g root "$VAULT_ETC"
  # One parent at a time: podman-up and the bootstrap renewal hold this lock
  # while they read or change Vault's identities and the parent's records.
  exec 9>"$VAULT_ETC/parent.lock"
  flock -w "${PARENT_LOCK_WAIT_SECONDS:-600}" 9 || halt "another parent run (podman-up.sh or renew-bootstraps.sh) holds $VAULT_ETC/parent.lock"
  # The lock is this script's alone: no container, conmon or podman process
  # may inherit it and hold it after the run.
  podman() { command podman "$@" 9>&-; }
  if [[ ! -s "$TOKEN_FILE" ]]; then
    ( umask 077; openssl rand -hex 32 > "$TOKEN_FILE" )
  fi
  chmod 0600 "$TOKEN_FILE"
elif [[ ! -s "$TOKEN_FILE" ]]; then
  say "would generate the Vault API token ($TOKEN_FILE)"
fi
VAULT_TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null || true)"

if [[ ! -s "$KEY_FILE" ]]; then
  if [[ -d "$APPS_ROOT/vault/sav/mariadb/vault" ]]; then
    echo "[podman-up] the Vault database exists but its master key $KEY_FILE does not." >&2
    echo "[podman-up] Restore the key from the operator's key material; a new key would orphan every secret. Halt." >&2
    exit 1
  fi
  if (( PREFLIGHT )); then
    say "would generate the Vault master key for a Vault being born ($KEY_FILE)"
  else
    ( umask 077; openssl rand -hex 32 > "$KEY_FILE" )
    echo "[podman-up] Vault master key generated for a Vault being born ($KEY_FILE)"
  fi
fi
if (( ! PREFLIGHT )); then
  # The key belongs to the account that reads it, and to nobody else.
  chown "$VAULT_UID:$VAULT_UID" "$KEY_FILE"; chmod 0400 "$KEY_FILE"
fi

# The universe identity: a UUID, generated once beside the master key. With
# the key it derives Vault's signing key — the public half every unit pins —
# and it is part of every Maestro occurrence id, so it never changes under an
# existing Vault or Maestro database. SHAPER_UNIVERSE_ID may name it at birth.
UUID_PATTERN='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
UNIVERSE_ID_FILE="$VAULT_ETC/universe-id"
if [[ -s "$UNIVERSE_ID_FILE" ]]; then
  UNIVERSE_ID="$(<"$UNIVERSE_ID_FILE")"
  if [[ -n "${SHAPER_UNIVERSE_ID:-}" && "$SHAPER_UNIVERSE_ID" != "$UNIVERSE_ID" ]]; then
    halt "SHAPER_UNIVERSE_ID is $SHAPER_UNIVERSE_ID but this universe is $UNIVERSE_ID ($UNIVERSE_ID_FILE). An identity is never replaced under its databases. Halt."
  fi
else
  for s in vault maestro; do
    if [[ -d "$APPS_ROOT/$s/sav/mariadb/$s" && -z "${SHAPER_UNIVERSE_ID:-}" ]]; then
      echo "[podman-up] the $s database exists but the universe identity $UNIVERSE_ID_FILE does not." >&2
      echo "[podman-up] If it was lost, name the known UUID in SHAPER_UNIVERSE_ID (it is recorded again); a new one would change Vault's signing key and every occurrence id." >&2
      halt "A universe born before unit identities (schema version 1) is not re-identified here: it is migrated (INTENT.md#migration, Rule 30). Halt."
    fi
  done
  UNIVERSE_ID="${SHAPER_UNIVERSE_ID:-$(cat /proc/sys/kernel/random/uuid)}"
  [[ "$UNIVERSE_ID" =~ $UUID_PATTERN ]] || halt "SHAPER_UNIVERSE_ID must be a lowercase UUID, got $UNIVERSE_ID"
  if (( PREFLIGHT )); then
    say "would record the universe identity ($UNIVERSE_ID_FILE)"
  else
    ( umask 022; printf '%s\n' "$UNIVERSE_ID" > "$UNIVERSE_ID_FILE" )
    echo "[podman-up] universe identity $UNIVERSE_ID recorded ($UNIVERSE_ID_FILE)"
  fi
fi
[[ "$UNIVERSE_ID" =~ $UUID_PATTERN ]] || halt "$UNIVERSE_ID_FILE holds no lowercase UUID. Halt."
export SHAPER_UNIVERSE_ID="$UNIVERSE_ID"

# ── 6. Every unit's image and volumes, checked before anything starts ───────
port_of() { jq -r --arg b "brick-$1" '.bricks[$b].port' "$MANIFEST"; }
VAULT_URL="http://127.0.0.1:$(port_of vault)"
LOGGER_URL="http://127.0.0.1:$(port_of logger)"
QUEUE_URL="http://127.0.0.1:$(port_of queue)"

# The unit's declared volumes (manifest database.volumes): its password
# (etc/mysql), its datadir and dumps (sav), and its log when it declares one.
# Single directories only — the unit's supervisor converges the rest from
# inside, and nothing here changes ownership recursively. etc/identity/ is the
# parent's delivery to the unit: root-owned, entered by the unit's group,
# mounted read-only.
prepare_volumes() {
  local slug="$1" uid="$2" engine="$3" volumes="$4" owner
  if (( ! PREFLIGHT )); then
    install -d -m 0755 -o root -g root "$APPS_ROOT/$slug" "$APPS_ROOT/$slug/etc" "$APPS_ROOT/$slug/etc/mysql" "$APPS_ROOT/$slug/sav"
    install -d -m 0750 -o root -g "$uid" "$APPS_ROOT/$slug/etc/identity"
    if [[ " $volumes " == *" log "* ]]; then
      install -d -m 0750 -o "$uid" -g "$uid" "$APPS_ROOT/$slug/log"
    fi
  fi
  if [[ -d "$APPS_ROOT/$slug/sav/mariadb" ]]; then
    owner="$(stat -c %u "$APPS_ROOT/$slug/sav/mariadb")"
    if [[ "$owner" != "$engine" ]]; then
      echo "[podman-up] $APPS_ROOT/$slug/sav/mariadb belongs to uid $owner; the $slug image's engine account is $engine." >&2
      echo "[podman-up] It is a datadir of another shape or image. Move it aside and restore its logical dump (INTENT.md#migration); no recursive chown is made. Halt." >&2
      exit 1
    fi
  fi
}

declare -A IMAGE_OF IMAGE_ID_OF UID_OF VOLUMES_OF PORT_OF
UNITS_IN_ORDER=()
for brick in $(jq -r '.bootOrder[][]' "$MANIFEST"); do
  db="$(jq -c --arg b "$brick" '.bricks[$b].database' "$MANIFEST")"
  slug="$(jq -r '.slug' <<<"$db")"; uid="$(jq -r '.uid' <<<"$db")"; engine="$(jq -r '.engineUid' <<<"$db")"
  version="$(jq -r '.schemaVersion' <<<"$db")"
  [[ "$(jq -r '.engine' <<<"$db")" == mariadb && "$(jq -r '.placement' <<<"$db")" == in-unit ]] \
    || halt "$brick declares no MariaDB inside its own container — Rules 4 and 26 forbid starting it"
  image="$(resolve_image "$(jq -r --arg b "$brick" '.bricks[$b].image' "$MANIFEST")")"
  if (( PREFLIGHT )); then
    # A pull could move a local tag: preflight only reads what is present.
    podman image exists "$image" || halt "image $image is not present (a run would try to pull it)"
  else
    podman pull -q "$image" >/dev/null 2>&1 || podman image exists "$image" \
      || halt "image $image is neither pullable nor present"
  fi
  label="$(podman image inspect -f '{{index .Labels "org.shaper.unit.slug"}}:{{index .Labels "org.shaper.unit.uid"}}:{{index .Labels "org.shaper.unit.engine-uid"}}:{{index .Labels "org.shaper.unit.schema-version"}}' "$image")"
  [[ "$label" == "$slug:$uid:$engine:$version" ]] \
    || halt "$image declares unit $label (slug:uid:engine-uid:schema-version); the manifest declares $slug:$uid:$engine:$version"
  IMAGE_OF[$slug]="$image"; UID_OF[$slug]="$uid"; UNITS_IN_ORDER+=("$slug")
  IMAGE_ID_OF[$slug]="$(podman image inspect -f '{{.Id}}' "$image")"
  PORT_OF[$slug]="$(jq -r --arg b "$brick" '.bricks[$b].port' "$MANIFEST")"
  VOLUMES_OF[$slug]="$(jq -r '(.volumes // ["etc/mysql", "sav", "log"]) | join(" ")' <<<"$db")"
  prepare_volumes "$slug" "$uid" "$engine" "${VOLUMES_OF[$slug]}"
done
[[ -n "${IMAGE_OF[vault]:-}" ]] || halt "the manifest declares no brick-vault: no unit could hold a credential"

# ── 7. Unit identities: the parent's two steps (pkg-vault/unit-registration.js) ─
# Who holds a Vault-signed credential (HOLDS_CREDENTIAL, each with grants_of:
# the units that owe evidence to Logger; Logger holds none, it verifies), who
# pins Vault's public key (PINNED) and what the proof's identity may do
# (PROOF_GRANTS) are declared once, in unit-probes.sh.

# The tool runs from the Vault image itself — the code that verifies what it
# registers — with no network and no capability.
REG_TOOL=/apps/vault/app/packages/pkg-vault/unit-registration.js
registration() { podman run --rm --network none --cap-drop=all --security-opt=no-new-privileges --entrypoint node "$@"; }

# 7a. Vault's signing public key, derived by the parent — never taken from a
# running Vault — as the vault account, the only one that reads the key.
PIN="$VAULT_ETC/vault-signing.pub"
if [[ -s "$KEY_FILE" ]]; then
  derived="$(mktemp)"
  registration --user "$VAULT_UID:$VAULT_UID" -e SHAPER_UNIVERSE_ID \
    -e VAULT_MASTER_KEY_FILE=/apps/vault/etc/vault/master.key -v "$KEY_FILE:/apps/vault/etc/vault/master.key:ro,Z" \
    "${IMAGE_OF[vault]}" "$REG_TOOL" public-key > "$derived"
  [[ "$(head -n1 "$derived")" == '-----BEGIN PUBLIC KEY-----' ]] || { rm -f "$derived"; halt "the Vault image did not derive a public key"; }
  if (( PREFLIGHT )); then
    if [[ -s "$PIN" ]] && ! cmp -s "$derived" "$PIN"; then rm -f "$derived"; halt "the pinned Vault public key is not the one the master key and the universe derive. Halt."; fi
    rm -f "$derived"
  else
    mv -f "$derived" "$PIN"; chmod 0644 "$PIN"
    for slug in $PINNED; do
      if [[ -n "${IMAGE_OF[$slug]:-}" ]]; then
        install -m 0644 -o root -g root "$PIN" "$APPS_ROOT/$slug/etc/identity/vault-signing.pub"
      fi
    done
    echo "[podman-up] Vault public key pinned for: $PINNED (sha256 $(sha256sum "$PIN" | cut -c1-16)…)"
  fi
fi

# 7b. Who is kept, who is recreated. Each unit's run specification is its
# image id, the fixed options below and its arguments — everything but its
# incarnation — as one digest, carried by the container (org.shaper.run-spec).
FIXED_ARGS=(--network host --restart=always --stop-timeout 90
  --cap-drop=all --cap-add=CHOWN,DAC_OVERRIDE,FOWNER,KILL,SETGID,SETUID
  --security-opt=no-new-privileges
  --health-cmd=/usr/local/bin/unit-ready --health-interval=15s --health-retries=3 --health-start-period=180s
  -e HOST=127.0.0.1)

# Each unit's podman arguments, one array element per argument: no path is
# ever split on whitespace.
RUN_ARGS=()
add() { RUN_ARGS+=("$@"); }

# What each unit needs beyond its database and its identity — declared once, here.
unit_args() {
  local slug="$1" port="$2"
  case "$slug" in
    vault)
      add -e "VAULT_PORT=$port" -e VAULT_MASTER_KEY_FILE=/apps/vault/etc/vault/master.key -e VAULT_TOKEN -e "LOGGER_URL=$LOGGER_URL"
      add -v "$KEY_FILE:/apps/vault/etc/vault/master.key:ro,Z"
      ;;
    logger)
      add -e "LOGGER_PORT=$port"
      ;;
    queue)
      add -e "QUEUE_PORT=$port" -e "LOGGER_URL=$LOGGER_URL" -e QUEUE_AUTO_DISPATCH=0
      ;;
    maestro)
      add -e "MAESTRO_PORT=$port" -e MAESTRO_AUTO_START=1 -e "LOGGER_URL=$LOGGER_URL" -e "MAESTRO_QUEUE_URL=$QUEUE_URL"
      add -e MAESTRO_TASKS_FILE=/apps/maestro/etc/task-schedule.json
      add -v "$UNIV/task-schedule.json:/apps/maestro/etc/task-schedule.json:ro,Z"
      ;;
    *) halt "no runtime wiring declared for unit $slug" ;;
  esac
}

# The identity inputs the unit's application reads (pkg-auth): the universe,
# its etc/identity/ read-only, and — as the unit holds or verifies a
# credential — its bootstrap, or Vault's address and the pin. Its incarnation
# is added when the container is created (start_unit), outside the digest.
identity_args() {
  local slug="$1"
  add -e "SHAPER_UNIVERSE_ID=$UNIVERSE_ID" -v "$APPS_ROOT/$slug/etc/identity:/apps/$slug/etc/identity:ro,Z"
  if holds_credential "$slug"; then
    add -e "UNIT_BOOTSTRAP_TOKEN_FILE=/apps/$slug/etc/identity/bootstrap"
  fi
  if [[ " $PINNED " == *" $slug "* ]]; then
    add -e "VAULT_URL=$VAULT_URL" -e "UNIT_AUTH_PUBLIC_KEY_FILE=/apps/$slug/etc/identity/vault-signing.pub"
  fi
}

volume_args() {
  local slug="$1" v
  for v in ${VOLUMES_OF[$slug]}; do add -v "$APPS_ROOT/$slug/$v:/apps/$slug/$v:Z"; done
}

spec_args() {  # fills RUN_ARGS for <slug>, without its incarnation
  local slug="$1" restore_var
  RUN_ARGS=()
  # A restore into a fresh volume: RESTORE_DUMP_<slug>=/apps/<slug>/sav/restore/<file>.sql
  # (a hyphen in the slug is an underscore in the variable's name: RESTORE_DUMP_brick_voice).
  restore_var="RESTORE_DUMP_${slug//-/_}"
  if [[ -n "${!restore_var:-}" ]]; then add -e "UNIT_RESTORE_DUMP=${!restore_var}"; fi
  volume_args "$slug"
  identity_args "$slug"
  unit_args "$slug" "${PORT_OF[$slug]}"
  add -e "UNIT_HEALTH_URL=http://127.0.0.1:${PORT_OF[$slug]}/api/health"
}

# What a unit reads only at its start, beyond its arguments, is part of its
# specification too: a changed value recreates the unit (Maestro's declared
# schedule; Vault's API token, by its digest, never its value).
content_of() {
  case "$1" in
    vault) if [[ -s "$TOKEN_FILE" ]]; then printf 'api-token:%s' "$(sha256sum < "$TOKEN_FILE" | cut -c1-64)"; else printf 'api-token:none'; fi ;;
    maestro) printf 'task-schedule:%s' "$(sha256sum < "$UNIV/task-schedule.json" | cut -c1-64)" ;;
  esac
}
declare -A SPEC_OF ACTION REASON INCARNATION
for slug in "${UNITS_IN_ORDER[@]}"; do
  spec_args "$slug"
  SPEC_OF[$slug]="$(printf '%s\0' "${IMAGE_ID_OF[$slug]}" "$(content_of "$slug")" "${FIXED_ARGS[@]}" "${RUN_ARGS[@]}" | sha256sum | cut -c1-64)"
done

RECORDS="$VAULT_ETC/registration/records"
STAGE="$VAULT_ETC/registration"

# A container is kept only when it runs as declared, under the incarnation the
# parent recorded for it.
decide_container() {
  local slug="$1" ctr="${UNIVERSE}-ctr-$1" inc
  recreate() { ACTION[$slug]=recreate; REASON[$slug]="$1"; }
  if asked_to_recreate "$slug"; then recreate "asked (--recreate)"; return; fi
  if ! podman container exists "$ctr"; then recreate "no container"; return; fi
  if [[ "$(podman inspect -f '{{.State.Running}}' "$ctr" 2>/dev/null)" != true ]]; then recreate "container not running"; return; fi
  if [[ "$(podman inspect -f '{{index .Config.Labels "org.shaper.run-spec"}}' "$ctr" 2>/dev/null)" != "${SPEC_OF[$slug]}" ]]; then
    recreate "another image or run specification"; return
  fi
  if holds_credential "$slug"; then
    inc="$(unit_env "$ctr" SHAPER_UNIT_INCARNATION)"
    if [[ -z "$inc" || "$inc" != "$(record_field "$slug" incarnation)" ]]; then recreate "its incarnation is not the one recorded"; return; fi
    INCARNATION[$slug]="$inc"
  fi
  ACTION[$slug]=keep; REASON[$slug]="runs as declared"
}

# A kept holder must also be live in Vault: its recorded incarnation, epoch,
# grants and bootstrap digest, not revoked, its bootstrap unexpired, and the
# bootstrap in place the one recorded. Read through Vault's root path.
check_identity() {  # <unit> <bootstrap-file>
  identity_live "$1" "$2" && return 0
  ACTION[$1]=recreate; REASON[$1]="its identity is not live in Vault"
  return 1
}

for slug in "${UNITS_IN_ORDER[@]}"; do decide_container "$slug"; done
# Vault's database answers only while its container runs. Vault's own identity
# is checked now — its registration, if any, comes before its start; the
# other holders' and the proof's once Vault is up (register_others).
VAULT_UP=0
[[ "$(podman inspect -f '{{.State.Running}}' "${UNIVERSE}-ctr-vault" 2>/dev/null)" == true ]] && VAULT_UP=1
if (( VAULT_UP )) && [[ "${ACTION[vault]}" == keep ]]; then
  check_identity vault "$APPS_ROOT/vault/etc/identity/bootstrap" || true
fi
PROOF_ACTION=keep; PROOF_REASON="its identity is live in Vault"
if asked_to_recreate proof; then PROOF_ACTION=register; PROOF_REASON="asked (--recreate)"; fi

if (( PREFLIGHT )); then
  if (( VAULT_UP )); then
    for slug in $HOLDS_CREDENTIAL; do
      [[ "$slug" != vault && "${ACTION[$slug]:-}" == keep ]] && { check_identity "$slug" "$APPS_ROOT/$slug/etc/identity/bootstrap" || true; }
    done
    if [[ "$PROOF_ACTION" == keep ]] && ! identity_live proof "$PROOF_DIR/identity/bootstrap"; then PROOF_ACTION=register; PROOF_REASON="no identity live in Vault"; fi
  else
    PROOF_REASON="checked once Vault runs"
  fi
  for slug in "${UNITS_IN_ORDER[@]}"; do
    printf '  %-8s %-9s %s%s\n' "$slug" "${ACTION[$slug]}" "${REASON[$slug]}" \
      "$( [[ "${ACTION[$slug]}" == keep && -n "${INCARNATION[$slug]:-}" ]] && echo " — incarnation ${INCARNATION[$slug]} kept" )"
  done
  (( VAULT_UP )) || say "Vault is not running: the holders' identities are checked once it is"
  printf '  %-8s %-9s %s\n' proof "$PROOF_ACTION" "$PROOF_REASON"
  say "preflight done: nothing was changed"
  exit 0
fi

# 7c. One new incarnation per recreated holder: its bootstrap (a new file,
# owner-only) and the one statement root applies to Vault's database — the
# bootstrap's SHA-256, never its value. The statements wait in a root-only
# file, and so do the bootstraps of Queue, Maestro and the proof: each
# replaces the one in use only once Vault holds its digest
# (apply_registrations), so a run that stops before leaves the running units
# and the proof with an identity that works. Vault's own goes in place now:
# its new container reads it at start.
install -d -m 0700 -o root -g root "$STAGE" "$RECORDS"
register() {  # <unit> <incarnation> <grant>...
  local unit="$1" inc="$2" g; shift 2
  local grants=()
  for g; do grants+=(--grant "$g"); done
  rm -f -- "${STAGE:?}/$unit.bootstrap"
  registration -e SHAPER_UNIVERSE_ID -v "$STAGE:/identity:Z" "${IMAGE_OF[vault]}" "$REG_TOOL" register \
    --unit "$unit" --incarnation "$inc" "${grants[@]}" --bootstrap-file "/identity/$unit.bootstrap" >> "$STAGE/registration.sql.next"
  [[ -s "$STAGE/$unit.bootstrap" ]] || halt "no bootstrap was written for $unit"
  REGISTERED+="${REGISTERED:+,}'$unit:$inc'"
  REGISTERED_UNITS+=("$unit")
  INCARNATION[$unit]="$inc"
}
REGISTERED=""; REGISTERED_UNITS=()
( umask 077; : > "$STAGE/registration.sql.next" )
if [[ "${ACTION[vault]}" == recreate ]]; then
  # shellcheck disable=SC2046
  register vault "$(new_incarnation vault)" $(grants_of vault)
  chown "${UID_OF[vault]}:${UID_OF[vault]}" "$STAGE/vault.bootstrap"; chmod 0600 "$STAGE/vault.bootstrap"
  mv -f "$STAGE/vault.bootstrap" "$APPS_ROOT/vault/etc/identity/bootstrap"
fi

# The other holders and the proof, once Vault runs: a kept holder whose
# identity Vault does not hold live is recreated; each recreated holder gets a
# new incarnation; the proof is registered when it holds none live.
register_others() {
  local slug
  for slug in $HOLDS_CREDENTIAL; do
    [[ "$slug" == vault || -z "${IMAGE_OF[$slug]:-}" ]] && continue
    if [[ "${ACTION[$slug]}" == keep ]]; then check_identity "$slug" "$APPS_ROOT/$slug/etc/identity/bootstrap" || true; fi
    [[ "${ACTION[$slug]}" == recreate ]] || continue
    # shellcheck disable=SC2046
    register "$slug" "$(new_incarnation "$slug")" $(grants_of "$slug")
    chown "${UID_OF[$slug]}:${UID_OF[$slug]}" "$STAGE/$slug.bootstrap"; chmod 0600 "$STAGE/$slug.bootstrap"
  done
  if [[ "$PROOF_ACTION" == register ]] || ! identity_live proof "$PROOF_DIR/identity/bootstrap"; then
    # shellcheck disable=SC2086
    register proof "$(new_incarnation proof)" $PROOF_GRANTS
    chmod 0600 "$STAGE/proof.bootstrap"
  fi
}

# Root applies the registrations through Vault's own socket and reads them
# back — every identity of this run live in Vault's database — and only then
# are the staged bootstraps delivered and each identity recorded root-only
# (what renew-bootstraps.sh compares Vault with).
apply_registrations() {
  local ctr="${UNIVERSE}-ctr-vault" want got unit file
  if [[ -z "$REGISTERED" ]]; then
    rm -f -- "$STAGE/registration.sql.next"
    echo "  OK   identities — nothing to register: every holder and the proof keep their live incarnation"
    return 0
  fi
  mv -f "$STAGE/registration.sql.next" "$STAGE/registration.sql"
  want="${#REGISTERED_UNITS[@]}"
  podman exec -i "$ctr" mariadb --no-defaults -S /run/vault/mysqld.sock -uroot -N -B vault < "$STAGE/registration.sql" \
    || halt "root could not apply the unit registrations to Vault's database"
  got="$(podman exec "$ctr" mariadb --no-defaults -S /run/vault/mysqld.sock -uroot -N -B vault -e \
    "SELECT COUNT(*) FROM unit_identities WHERE universe_id = '$UNIVERSE_ID' AND NOT revoked
       AND bootstrap_expires_at > UTC_TIMESTAMP(3) AND CONCAT(unit_id, ':', incarnation) IN ($REGISTERED)")"
  [[ "$got" == "$want" ]] || halt "Vault holds $got of the $want registrations just applied"
  for unit in "${REGISTERED_UNITS[@]}"; do
    case "$unit" in
      vault) file="$APPS_ROOT/vault/etc/identity/bootstrap" ;;
      proof)
        install -d -m 0700 -o root -g root "$PROOF_DIR" "$PROOF_DIR/identity"
        mv -f "$STAGE/proof.bootstrap" "$PROOF_DIR/identity/bootstrap"
        ( umask 077; printf '%s\n' "${INCARNATION[proof]}" > "$PROOF_DIR/identity/incarnation" )
        file="$PROOF_DIR/identity/bootstrap" ;;
      *) mv -f "$STAGE/$unit.bootstrap" "$APPS_ROOT/$unit/etc/identity/bootstrap"; file="$APPS_ROOT/$unit/etc/identity/bootstrap" ;;
    esac
    write_record "$unit" "${INCARNATION[$unit]}" "$file"
  done
  echo "  OK   identities — $got incarnations live in Vault's database, applied by root; bootstraps delivered: ${REGISTERED_UNITS[*]}"
}

# The parent's record of one identity, read back from Vault by the root path.
write_record() {  # <unit> <incarnation> <bootstrap-file>
  local unit="$1" inc="$2" file="$3" digest row epoch grants
  digest="$(sha256sum < "$file" | cut -c1-64)"
  row="$(rootsql vault vault -e "SELECT CONCAT(epoch, ' ', grants) FROM unit_identities WHERE universe_id = '$UNIVERSE_ID' AND unit_id = '$unit' AND incarnation = '$inc' AND bootstrap_digest = '$digest' AND NOT revoked")"
  epoch="${row%% *}"; grants="${row#* }"
  [[ "$epoch" =~ ^[0-9]+$ && "$grants" == '{'* ]] || halt "Vault does not hold $unit's registration ($inc) just applied"
  ( umask 077; printf '{"unit":"%s","incarnation":"%s","epoch":%s,"grants":%s,"bootstrapDigest":"%s","registeredAt":"%s"}\n' \
      "$unit" "$inc" "$epoch" "$grants" "$digest" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RECORDS/$unit.json.next" )
  mv -f "$RECORDS/$unit.json.next" "$RECORDS/$unit.json"
}

# ── 8. Units, layer by layer, in the declared bootOrder ─────────────────────
start_unit() {
  local slug="$1"
  spec_args "$slug"
  if [[ -n "${INCARNATION[$slug]:-}" ]]; then add -e "SHAPER_UNIT_INCARNATION=${INCARNATION[$slug]}"; fi
  podman run -d --name "${UNIVERSE}-ctr-${slug}" --replace "${FIXED_ARGS[@]}" \
    --label "org.shaper.run-spec=${SPEC_OF[$slug]}" \
    "${RUN_ARGS[@]}" \
    "${IMAGE_OF[$slug]}" >/dev/null
}

wait_ready() {
  local slug="$1" ctr="${UNIVERSE}-ctr-$1" tries=180 state
  while (( tries-- )); do
    if podman exec "$ctr" unit-ready >/dev/null 2>&1; then
      echo "  OK   $slug — $(podman exec "$ctr" unit-ready 2>/dev/null)"
      return 0
    fi
    state="$(podman inspect -f '{{.State.Status}}' "$ctr" 2>/dev/null || echo absent)"
    if [[ "$state" != running ]]; then
      echo "  FAIL $slug — container $state" >&2
      podman logs --tail 40 "$ctr" >&2 || true
      return 1
    fi
    sleep 1
  done
  echo "  FAIL $slug — not ready after 180s: $(podman exec "$ctr" unit-ready 2>&1)" >&2
  podman logs --tail 40 "$ctr" >&2 || true
  return 1
}

export VAULT_TOKEN
layer=0
while read -r bricks; do
  echo "[podman-up] layer $layer — $bricks"
  for brick in $bricks; do
    slug="$(jq -r --arg b "$brick" '.bricks[$b].database.slug' "$MANIFEST")"
    if [[ "${ACTION[$slug]}" == recreate ]]; then
      echo "  NEW  $slug — ${REASON[$slug]}${INCARNATION[$slug]:+; incarnation ${INCARNATION[$slug]}}"
      start_unit "$slug"
    else
      echo "  KEEP $slug — ${REASON[$slug]}${INCARNATION[$slug]:+; incarnation ${INCARNATION[$slug]}}"
    fi
  done
  for brick in $bricks; do
    wait_ready "$(jq -r --arg b "$brick" '.bricks[$b].database.slug' "$MANIFEST")"
  done
  # Vault is up: its database takes the registrations before any later layer
  # starts, so every unit after it finds its identity live.
  if [[ " $bricks " == *" brick-vault "* ]]; then register_others; apply_registrations; fi
  layer=$((layer + 1))
done < <(jq -r '.bootOrder[] | join(" ")' "$MANIFEST")

echo "[podman-up] $UNIVERSE ($UNIVERSE_ID) is up. Prove it: bash $UNIV/deploy/proof.sh — bootstraps renew daily once bash $UNIV/deploy/install-renewal-timer.sh has run"
