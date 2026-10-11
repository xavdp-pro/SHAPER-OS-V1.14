#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#proof
# Sourced by proof.sh. One real effect per unit, requested through the unit's
# own API and read back from the unit's own database through the root path —
# and, for the units that owe evidence to Logger, that evidence read back from
# both the unit's outbox and Logger's database.
#
# Persistence is proven across runs: each run records the markers it wrote in
# a root-only state file, and the next run first checks that they are still in
# the databases — whatever happened in between (containers recreated, universe
# rebooted, restore drill). The first run has nothing to compare and says so.

STATE_DIR="$PROOF_DIR"
install -d -m 0700 "$STATE_DIR"
LAST="$STATE_DIR/last-run.json"
NEXT="$STATE_DIR/next-run.json"
printf '{"run":"%s"}\n' "$RUN_ID" > "$NEXT"
record() { jq --arg k "$1" --arg v "$2" '.[$k] = $v' "$NEXT" > "$NEXT.tmp" && mv "$NEXT.tmp" "$NEXT"; }
last() { [[ -f "$LAST" ]] && jq -r --arg k "$1" '.[$k] // empty' "$LAST"; }

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
since="$(rootsql vault -e 'SELECT UTC_TIMESTAMP(3)')"
check "vault-write" "POST /api/secret/proof/last-run" \
  vault_curl -sf -o /dev/null -X POST -H 'Content-Type: application/json' \
    -d "{\"data\":\"$value\"}" "$(url vault)/api/secret/proof/last-run"
check "vault-read-back" "the API returns the value just written" \
  test "$(vault_curl -sf "$(url vault)/api/secret/proof/last-run" | jq -r .data)" = "$value"
row="$(rootsql vault vault -e "SELECT ciphertext, key_version, secret_version FROM secrets WHERE secret_key='proof/last-run'")"
check "vault-row-in-db" "the row exists in vault.secrets (root path)" test -n "$row"
check "vault-encrypted-at-rest" "the stored ciphertext does not contain the value" \
  bash -c '! grep -q "$1" <<<"$2" && ! grep -q "$(printf %s "$1" | od -An -tx1 | tr -d " \n")" <<<"$2"' _ "$value" "$row"
check "vault-identity" "vault_identity holds one key-check digest" \
  test "$(rootsql vault vault -e "SELECT COUNT(*) FROM vault_identity WHERE id=1 AND CHAR_LENGTH(key_check)=64")" = 1
refusal_since="$(rootsql vault -e 'SELECT UTC_TIMESTAMP(3)')"
check "vault-token-enforced" "an unauthenticated read is refused (401)" \
  test "$(curl -s -o /dev/null -w '%{http_code}' "$(url vault)/api/secret/proof/last-run")" = 401
# DECISIONS-20261011 §H: the read-back above left its proof before the value
# left — an opaque resource id, never the path or the value.
check "vault-read-evidence" "SECRET_READ committed for the read-back, naming an opaque resource, receipted by Logger (both databases)" \
  evidence_delivered vault "JSON_VALUE(body, '\$.event') = 'SECRET_READ' AND JSON_VALUE(body, '\$.data.result') = 'returned' AND JSON_VALUE(body, '\$.data.identity') = 'vault:admin' AND created_at >= '$since'"
check "vault-read-evidence-opaque" "no read evidence names the secret's path or carries its value" \
  test "$(rootsql vault vault -e "SELECT COUNT(*) FROM event_outbox WHERE created_at >= '$since' AND JSON_VALUE(body, '\$.event') = 'SECRET_READ' AND (body LIKE '%proof/last-run%' OR body LIKE '%$value%')")" = 0
check "vault-evidence" "SECRET_STORED committed with the write, receipted by Logger and held there as vault's (both databases, root path)" \
  evidence_delivered vault "JSON_VALUE(body, '\$.event') = 'SECRET_STORED' AND JSON_VALUE(body, '\$.data.secretRef') = 'proof/last-run' AND created_at >= '$since'"
check "vault-evidence-no-value" "the evidence carries the secret's name, never its value" \
  test "$(rootsql vault vault -e "SELECT COUNT(*) FROM event_outbox WHERE created_at >= '$since' AND body LIKE '%$value%'")" = 0
record vault_digest "$(rootsql vault vault -e "SELECT SHA2(CONCAT(secret_key,iv,auth_tag,ciphertext),256) FROM secrets WHERE secret_key='proof/last-run'")"

# ── Logger, Queue, Maestro ──────────────────────────────────────────────────
unit_effects

# ── Each holder's credential, obtained because it had evidence to deliver ──
# A unit asks Vault for a credential only when its outbox owes a row
# (DECISIONS-20261011 §C); every holder delivered evidence above, so each now
# holds one issued to its current incarnation.
section "identity — each holder's credential for its current incarnation, once it owed evidence"
for s in $HOLDS_CREDENTIAL; do
  inc="$(unit_env "${UNIVERSE}-ctr-$s" SHAPER_UNIT_INCARNATION)"
  check "$s-credential" "Vault issued a logger credential to $s's current incarnation ${inc:-?} (vault.unit_credentials, root path)" \
    test -n "$inc" -a "$(rootsql vault vault -e "SELECT COUNT(*) FROM unit_credentials c JOIN unit_identities i ON i.universe_id = c.universe_id AND i.unit_id = c.unit_id AND i.incarnation = c.incarnation AND i.epoch = c.epoch WHERE c.universe_id = '$UNIVERSE_ID' AND c.unit_id = '$s' AND c.incarnation = '$inc' AND c.audience = 'logger' AND NOT i.revoked" 2>/dev/null || echo 0)" -ge 1
done

# The unauthenticated read refused above is counted, not written per attempt:
# its aggregate is committed when the window closes (one minute).
check "vault-refusal-aggregated" "the refused anonymous read counted in a VAULT_REFUSALS_AGGREGATED row (admin, VAULT_TOKEN_MISSING), receipted by Logger" \
  evidence_delivered vault "JSON_VALUE(body, '\$.event') = 'VAULT_REFUSALS_AGGREGATED' AND JSON_VALUE(body, '\$.data.action') = 'admin' AND JSON_VALUE(body, '\$.data.reason') = 'VAULT_TOKEN_MISSING' AND created_at >= '$refusal_since'" 120

if (( FAILS == 0 )); then mv "$NEXT" "$LAST"; else rm -f "$NEXT"; fi
