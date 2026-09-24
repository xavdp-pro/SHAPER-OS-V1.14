#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#proof
# Sourced by proof.sh. One real effect per unit, requested through the unit's
# own API and read back from the unit's own database through the root path.
#
# Persistence is proven across runs: each run records the markers it wrote in
# a root-only state file, and the next run first checks that they are still in
# the databases — whatever happened in between (containers recreated, universe
# rebooted, restore drill). The first run has nothing to compare and says so.

STATE_DIR="${PROOF_STATE_DIR:-/var/lib/univ-proof/$UNIVERSE}"
install -d -m 0700 "$STATE_DIR"
LAST="$STATE_DIR/last-run.json"
NEXT="$STATE_DIR/next-run.json"
printf '{"run":"%s"}\n' "$RUN_ID" > "$NEXT"
record() { jq --arg k "$1" --arg v "$2" '.[$k] = $v' "$NEXT" > "$NEXT.tmp" && mv "$NEXT.tmp" "$NEXT"; }
last() { [[ -f "$LAST" ]] && jq -r --arg k "$1" '.[$k] // empty' "$LAST"; }

VAULT_TOKEN="$(cat "$APPS_ROOT/vault/etc/vault/api-token" 2>/dev/null || true)"
# The other units' checks are functions; they must exist before persistence is read.
# shellcheck source=/dev/null
source "$UNIV/deploy/proof-effects-units.sh"
url() { echo "http://127.0.0.1:${PORT_OF[$1]}"; }

# ── Persistence of the previous run's markers ───────────────────────────────
section "persistence — the previous run's effects are still in the databases"
if [[ ! -f "$LAST" ]]; then
  ok "persistence" "first run on this universe: nothing recorded yet to compare"
else
  prev="$(jq -r '.run' "$LAST")"
  digest="$(last vault_digest)"
  check "vault-persisted" "run $prev's secret row unchanged in vault.secrets" \
    test -n "$digest" -a "$(rootsql vault vault -e "SELECT SHA2(CONCAT(secret_key,iv,auth_tag,ciphertext),256) FROM secrets WHERE secret_key='proof/last-run'")" = "$digest"
  persisted_effects
fi

# ── Vault ───────────────────────────────────────────────────────────────────
section "vault — a secret stored encrypted in its own database"
value="value-$RUN_ID"
check "vault-write" "POST /api/secret/proof/last-run" \
  curl -sf -o /dev/null -X POST -H "Authorization: Bearer $VAULT_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"data\":\"$value\"}" "$(url vault)/api/secret/proof/last-run"
check "vault-read-back" "the API returns the value just written" \
  test "$(curl -sf -H "Authorization: Bearer $VAULT_TOKEN" "$(url vault)/api/secret/proof/last-run" | jq -r .data)" = "$value"
row="$(rootsql vault vault -e "SELECT ciphertext, key_version, secret_version FROM secrets WHERE secret_key='proof/last-run'")"
check "vault-row-in-db" "the row exists in vault.secrets (root path)" test -n "$row"
check "vault-encrypted-at-rest" "the stored ciphertext does not contain the value" \
  bash -c '! grep -q "$1" <<<"$2" && ! grep -q "$(printf %s "$1" | od -An -tx1 | tr -d " \n")" <<<"$2"' _ "$value" "$row"
check "vault-identity" "vault_identity holds one key-check digest" \
  test "$(rootsql vault vault -e "SELECT COUNT(*) FROM vault_identity WHERE id=1 AND CHAR_LENGTH(key_check)=64")" = 1
check "vault-token-enforced" "an unauthenticated read is refused (401)" \
  test "$(curl -s -o /dev/null -w '%{http_code}' "$(url vault)/api/secret/proof/last-run")" = 401
record vault_digest "$(rootsql vault vault -e "SELECT SHA2(CONCAT(secret_key,iv,auth_tag,ciphertext),256) FROM secrets WHERE secret_key='proof/last-run'")"

# ── Logger, Queue, Maestro ──────────────────────────────────────────────────
unit_effects

if (( FAILS == 0 )); then mv "$NEXT" "$LAST"; else rm -f "$NEXT"; fi
