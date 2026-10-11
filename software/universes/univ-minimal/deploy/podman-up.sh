#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#private-mariadb
# Materialises univ-minimal — Vault, Logger, Queue and Maestro — inside the
# universe container: one container per unit, holding the application and its
# own MariaDB server (Rules 4 and 26, Turbinobash method).
#
# It does only what the manifest declares, in the order bootOrder states, from
# the images the lock (or an explicitly published tag) names. Each unit image
# births its own database through its own root path (runtime/unit-mariadb);
# this script prepares the unit's declared volumes, the Vault's key material
# and the universe identity, and waits for each unit's readiness, which is
# gated on its MariaDB.
#
# It is also the parent that lets units hold Vault-signed credentials
# (pkg-vault INTENT.md#parent-registration), in this birth order:
#   1. pin Vault's signing public key, derived here from the master key and
#      the universe UUID, for every unit that verifies a credential;
#   2. register a fresh incarnation of each unit that owes evidence to Logger
#      (vault, queue, maestro: logger=logger:ingest) and of the proof's reader
#      (logger:ingest, logger:read:own); each bootstrap is a new owner-only file;
#   3. start Vault; once it is ready, root applies the registrations to Vault's
#      database through its socket and reads them back;
#   4. start Logger, Queue and Maestro, layer by layer.
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

for tool in podman jq openssl ss sha256sum; do
  command -v "$tool" >/dev/null || { echo "[podman-up] $tool is missing in the universe container — install it at first boot" >&2; exit 1; }
done

UNIVERSE="${SHAPER_UNIVERSE:-univ-minimal}"
APPS_ROOT="${SHAPER_APPS_ROOT:-/apps}"
[[ "$UNIVERSE" =~ ^univ-[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "[podman-up] SHAPER_UNIVERSE must be an instance slug (univ-…), got $UNIVERSE" >&2; exit 1; }
# Definitions shared with the proofs: who holds a credential and who pins
# Vault's key (HOLDS_CREDENTIAL, HOLDER_GRANT, PINNED, PROOF_GRANTS), and where
# the proof keeps its state and reader identity (PROOF_DIR).
# shellcheck source=/dev/null
source "$UNIV/deploy/unit-probes.sh"
# One incarnation per unit per run: a recreated universe is a new incarnation,
# and the credentials of the one before stop being current at once.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
halt() { echo "[podman-up] $*" >&2; exit 1; }

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
install -d -m 0755 -o root -g root "$APPS_ROOT" "$APPS_ROOT/vault" "$APPS_ROOT/vault/etc"
install -d -m 0700 -o root -g root "$VAULT_ETC"
TOKEN_FILE="$VAULT_ETC/api-token"
if [[ ! -s "$TOKEN_FILE" ]]; then
  ( umask 077; openssl rand -hex 32 > "$TOKEN_FILE" )
fi
chmod 0600 "$TOKEN_FILE"
VAULT_TOKEN="$(<"$TOKEN_FILE")"

KEY_FILE="$VAULT_ETC/master.key"
if [[ ! -s "$KEY_FILE" ]]; then
  if [[ -d "$APPS_ROOT/vault/sav/mariadb/vault" ]]; then
    echo "[podman-up] the Vault database exists but its master key $KEY_FILE does not." >&2
    echo "[podman-up] Restore the key from the operator's key material; a new key would orphan every secret. Halt." >&2
    exit 1
  fi
  ( umask 077; openssl rand -hex 32 > "$KEY_FILE" )
  echo "[podman-up] Vault master key generated for a Vault being born ($KEY_FILE)"
fi
# The key belongs to the account that reads it, and to nobody else.
chown "$VAULT_UID:$VAULT_UID" "$KEY_FILE"; chmod 0400 "$KEY_FILE"

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
  ( umask 022; printf '%s\n' "$UNIVERSE_ID" > "$UNIVERSE_ID_FILE" )
  echo "[podman-up] universe identity $UNIVERSE_ID recorded ($UNIVERSE_ID_FILE)"
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
  install -d -m 0755 -o root -g root "$APPS_ROOT/$slug" "$APPS_ROOT/$slug/etc" "$APPS_ROOT/$slug/etc/mysql" "$APPS_ROOT/$slug/sav"
  install -d -m 0750 -o root -g "$uid" "$APPS_ROOT/$slug/etc/identity"
  if [[ " $volumes " == *" log "* ]]; then
    install -d -m 0750 -o "$uid" -g "$uid" "$APPS_ROOT/$slug/log"
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

declare -A IMAGE_OF UID_OF VOLUMES_OF
for brick in $(jq -r '.bootOrder[][]' "$MANIFEST"); do
  db="$(jq -c --arg b "$brick" '.bricks[$b].database' "$MANIFEST")"
  slug="$(jq -r '.slug' <<<"$db")"; uid="$(jq -r '.uid' <<<"$db")"; engine="$(jq -r '.engineUid' <<<"$db")"
  version="$(jq -r '.schemaVersion' <<<"$db")"
  [[ "$(jq -r '.engine' <<<"$db")" == mariadb && "$(jq -r '.placement' <<<"$db")" == in-unit ]] \
    || halt "$brick declares no MariaDB inside its own container — Rules 4 and 26 forbid starting it"
  image="$(resolve_image "$(jq -r --arg b "$brick" '.bricks[$b].image' "$MANIFEST")")"
  podman pull -q "$image" >/dev/null 2>&1 || podman image exists "$image" \
    || halt "image $image is neither pullable nor present"
  label="$(podman image inspect -f '{{index .Labels "org.shaper.unit.slug"}}:{{index .Labels "org.shaper.unit.uid"}}:{{index .Labels "org.shaper.unit.engine-uid"}}:{{index .Labels "org.shaper.unit.schema-version"}}' "$image")"
  [[ "$label" == "$slug:$uid:$engine:$version" ]] \
    || halt "$image declares unit $label (slug:uid:engine-uid:schema-version); the manifest declares $slug:$uid:$engine:$version"
  IMAGE_OF[$slug]="$image"; UID_OF[$slug]="$uid"
  VOLUMES_OF[$slug]="$(jq -r '(.volumes // ["etc/mysql", "sav", "log"]) | join(" ")' <<<"$db")"
  prepare_volumes "$slug" "$uid" "$engine" "${VOLUMES_OF[$slug]}"
done
[[ -n "${IMAGE_OF[vault]:-}" ]] || halt "the manifest declares no brick-vault: no unit could hold a credential"

# ── 7. Unit identities: the parent's two steps (pkg-vault/unit-registration.js) ─
# Who holds a Vault-signed credential (HOLDS_CREDENTIAL, each granted
# HOLDER_GRANT: the units that owe evidence to Logger; Logger holds none, it
# verifies), who pins Vault's public key (PINNED) and what the proof's reader
# may do (PROOF_GRANTS) are declared once, in unit-probes.sh.

# The tool runs from the Vault image itself — the code that verifies what it
# registers — with no network and no capability.
REG_TOOL=/apps/vault/app/packages/pkg-vault/unit-registration.js
registration() { podman run --rm --network none --cap-drop=all --security-opt=no-new-privileges --entrypoint node "$@"; }

# 7a. Vault's signing public key, derived by the parent — never taken from a
# running Vault — as the vault account, the only one that reads the key.
PIN="$VAULT_ETC/vault-signing.pub"
registration --user "$VAULT_UID:$VAULT_UID" -e SHAPER_UNIVERSE_ID \
  -e VAULT_MASTER_KEY_FILE=/apps/vault/etc/vault/master.key -v "$KEY_FILE:/apps/vault/etc/vault/master.key:ro,Z" \
  "${IMAGE_OF[vault]}" "$REG_TOOL" public-key > "$PIN.next"
[[ "$(head -n1 "$PIN.next")" == '-----BEGIN PUBLIC KEY-----' ]] || halt "the Vault image did not derive a public key"
mv -f "$PIN.next" "$PIN"; chmod 0644 "$PIN"
for slug in $PINNED; do
  if [[ -n "${IMAGE_OF[$slug]:-}" ]]; then
    install -m 0644 -o root -g root "$PIN" "$APPS_ROOT/$slug/etc/identity/vault-signing.pub"
  fi
done
echo "[podman-up] Vault public key pinned for: $PINNED (sha256 $(sha256sum "$PIN" | cut -c1-16)…)"

# 7b. One fresh incarnation per unit: its bootstrap (a new file, owner-only)
# and the one statement root applies to Vault's database — the bootstrap's
# SHA-256, never its value. The statements wait in a root-only file, and so do
# the bootstraps of Queue, Maestro and the proof: each replaces the one in use
# only once Vault holds its digest (apply_registrations), so a run that stops
# before leaves the running units and the proof with an identity that works.
# Vault's own goes in place now: its new container reads it at start.
STAGE="$VAULT_ETC/registration"
install -d -m 0700 -o root -g root "$STAGE"
declare -A INCARNATION
register() {  # <unit> <incarnation> <grant>...
  local unit="$1" inc="$2" g; shift 2
  local grants=()
  for g; do grants+=(--grant "$g"); done
  rm -f -- "${STAGE:?}/$unit.bootstrap"
  registration -e SHAPER_UNIVERSE_ID -v "$STAGE:/identity:Z" "${IMAGE_OF[vault]}" "$REG_TOOL" register \
    --unit "$unit" --incarnation "$inc" "${grants[@]}" --bootstrap-file "/identity/$unit.bootstrap" >> "$STAGE/registration.sql.next"
  [[ -s "$STAGE/$unit.bootstrap" ]] || halt "no bootstrap was written for $unit"
  REGISTERED+="${REGISTERED:+,}'$unit:$inc'"
}
REGISTERED=""
( umask 077; : > "$STAGE/registration.sql.next" )
for slug in $HOLDS_CREDENTIAL; do
  [[ -n "${IMAGE_OF[$slug]:-}" ]] || continue
  INCARNATION[$slug]="$slug-$STAMP"
  register "$slug" "${INCARNATION[$slug]}" "$HOLDER_GRANT"
  chown "${UID_OF[$slug]}:${UID_OF[$slug]}" "$STAGE/$slug.bootstrap"; chmod 0600 "$STAGE/$slug.bootstrap"
done
mv -f "$STAGE/vault.bootstrap" "$APPS_ROOT/vault/etc/identity/bootstrap"
# shellcheck disable=SC2086
register proof "proof-$STAMP" $PROOF_GRANTS
chmod 0600 "$STAGE/proof.bootstrap"
mv -f "$STAGE/registration.sql.next" "$STAGE/registration.sql"
echo "[podman-up] incarnations *-$STAMP registered for: ${!INCARNATION[*]} proof (bootstraps owner-only; Vault holds them once applied)"

# Root applies the registrations through Vault's own socket and reads them
# back — every identity of this run live in Vault's database — and only then
# are the staged bootstraps delivered, and the proof's incarnation recorded.
apply_registrations() {
  local ctr="${UNIVERSE}-ctr-vault" want got slug
  want="$(( ${#INCARNATION[@]} + 1 ))"
  podman exec -i "$ctr" mariadb --no-defaults -S /run/vault/mysqld.sock -uroot -N -B vault < "$STAGE/registration.sql" \
    || halt "root could not apply the unit registrations to Vault's database"
  got="$(podman exec "$ctr" mariadb --no-defaults -S /run/vault/mysqld.sock -uroot -N -B vault -e \
    "SELECT COUNT(*) FROM unit_identities WHERE universe_id = '$UNIVERSE_ID' AND NOT revoked
       AND bootstrap_expires_at > UTC_TIMESTAMP(3) AND CONCAT(unit_id, ':', incarnation) IN ($REGISTERED)")"
  [[ "$got" == "$want" ]] || halt "Vault holds $got of the $want registrations just applied"
  for slug in "${!INCARNATION[@]}"; do
    if [[ "$slug" != vault ]]; then mv -f "$STAGE/$slug.bootstrap" "$APPS_ROOT/$slug/etc/identity/bootstrap"; fi
  done
  install -d -m 0700 -o root -g root "$PROOF_DIR" "$PROOF_DIR/identity"
  mv -f "$STAGE/proof.bootstrap" "$PROOF_DIR/identity/bootstrap"
  ( umask 077; printf '%s\n' "proof-$STAMP" > "$PROOF_DIR/identity/incarnation" )
  echo "  OK   identities — $got incarnations live in Vault's database, applied by root; bootstraps delivered"
}

# ── 8. Units, layer by layer, in the declared bootOrder ─────────────────────
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
# credential — its incarnation and bootstrap, or Vault's address and the pin.
identity_args() {
  local slug="$1"
  add -e "SHAPER_UNIVERSE_ID=$UNIVERSE_ID" -v "$APPS_ROOT/$slug/etc/identity:/apps/$slug/etc/identity:ro,Z"
  if [[ -n "${INCARNATION[$slug]:-}" ]]; then
    add -e "SHAPER_UNIT_INCARNATION=${INCARNATION[$slug]}" -e "UNIT_BOOTSTRAP_TOKEN_FILE=/apps/$slug/etc/identity/bootstrap"
  fi
  if [[ " $PINNED " == *" $slug "* ]]; then
    add -e "VAULT_URL=$VAULT_URL" -e "UNIT_AUTH_PUBLIC_KEY_FILE=/apps/$slug/etc/identity/vault-signing.pub"
  fi
}

volume_args() {
  local slug="$1" v
  for v in ${VOLUMES_OF[$slug]}; do add -v "$APPS_ROOT/$slug/$v:/apps/$slug/$v:Z"; done
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
    port="$(jq -r --arg b "$brick" '.bricks[$b].port' "$MANIFEST")"

    RUN_ARGS=()
    # A restore into a fresh volume: RESTORE_DUMP_<slug>=/apps/<slug>/sav/restore/<file>.sql
    restore_var="RESTORE_DUMP_${slug}"
    if [[ -n "${!restore_var:-}" ]]; then add -e "UNIT_RESTORE_DUMP=${!restore_var}"; fi
    volume_args "$slug"
    identity_args "$slug"
    unit_args "$slug" "$port"

    podman run -d --name "${UNIVERSE}-ctr-${slug}" --replace --network host --restart=always \
      --stop-timeout 90 \
      --cap-drop=all --cap-add=CHOWN,DAC_OVERRIDE,FOWNER,KILL,SETGID,SETUID \
      --security-opt=no-new-privileges \
      --health-cmd=/usr/local/bin/unit-ready --health-interval=15s --health-retries=3 --health-start-period=180s \
      -e HOST=127.0.0.1 \
      -e UNIT_HEALTH_URL="http://127.0.0.1:$port/api/health" \
      "${RUN_ARGS[@]}" \
      "${IMAGE_OF[$slug]}" >/dev/null
  done
  for brick in $bricks; do
    wait_ready "$(jq -r --arg b "$brick" '.bricks[$b].database.slug' "$MANIFEST")"
  done
  # Vault is up: its database takes the registrations before any later layer
  # starts, so every unit after it finds its identity live.
  if [[ " $bricks " == *" brick-vault "* ]]; then apply_registrations; fi
  layer=$((layer + 1))
done < <(jq -r '.bootOrder[] | join(" ")' "$MANIFEST")

echo "[podman-up] $UNIVERSE ($UNIVERSE_ID) is up. Prove it: bash $UNIV/deploy/proof.sh"
