#!/usr/bin/env bash
# End-to-end checks against a running opencode-bridge.
# Exercises the real CLI and a real model, so it needs the bridge up.
#
#   bash scripts/test-cli.sh [base-url]
set -uo pipefail

BASE="${1:-http://127.0.0.1:4340}"
TOKEN_FILE="${TOKEN_FILE:-$HOME/.config/opencode-bridge/token}"
CONV="${CONV:-cli-test-$$}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; pass=$((pass+1)); }
ko()   { printf '  \033[31mFAIL\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; fail=$((fail+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if [ ! -r "$TOKEN_FILE" ]; then
  echo "token illisible: $TOKEN_FILE" >&2
  exit 2
fi
T="$(cat "$TOKEN_FILE")"
api() { curl -s -m "${TIMEOUT:-20}" -H "Authorization: Bearer $T" "$@"; }
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d$1) if isinstance(d$1,(dict,list)) else d$1)" 2>/dev/null; }

head_ "1. Santé et authentification"

if curl -s -m 10 "$BASE/api/health" | grep -q '"service":"opencode-bridge"'; then
  ok "/api/health répond sans token"
else
  ko "/api/health" "le bridge ne répond pas sur $BASE"
  echo; echo "abandon: bridge injoignable"; exit 1
fi

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/status")
[ "$code" = "401" ] && ok "/api/status refuse un appel sans token (401)" \
                    || ko "/api/status sans token" "attendu 401, reçu $code"

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer mauvais" "$BASE/api/status")
[ "$code" = "401" ] && ok "un mauvais token est refusé (401)" \
                    || ko "mauvais token" "attendu 401, reçu $code"

status=$(api "$BASE/api/status")
ready=$(echo "$status" | jget "['ready']")
[ "$ready" = "True" ] && ok "le serve interne est prêt (ready=true)" \
                      || ko "ready" "ready=$ready — le opencode serve ne répond pas"
model=$(echo "$status" | jget "['model']")
ok "modèle configuré: $model"

head_ "2. Registre des conversations"

api "$BASE/api/conversations" | grep -q '"registered"' \
  && ok "/api/conversations renvoie un registre" \
  || ko "/api/conversations"

head_ "3. Run complet (outil + texte)"

api -N "$BASE/api/events?conversation=$CONV" > "$TMP/events.ndjson" &
SSE_PID=$!
sleep 2

inject=$(TIMEOUT=30 api -X POST -H 'Content-Type: application/json' \
  -d "{\"conversation\":\"$CONV\",\"message\":\"Execute la commande 'ls -la' puis donne une phrase de conclusion.\"}" \
  "$BASE/api/inject")

if echo "$inject" | grep -q '"ok":true'; then
  ok "/api/inject accepte le run"
else
  ko "/api/inject" "$inject"
fi

run_id=$(echo "$inject" | jget "['run_id']")
chat_id=$(echo "$inject" | jget "['chat_id']")
[ -n "$run_id" ] && ok "un run_id est retourné" || ko "run_id absent"
case "$chat_id" in ses_*) ok "une session opencode est ouverte ($chat_id)";; *) ko "chat_id" "attendu ses_*, reçu $chat_id";; esac

# Attendre run_complete, 120 s max.
for _ in $(seq 1 120); do
  grep -q '"type":"run_complete"' "$TMP/events.ndjson" && break
  sleep 1
done
kill $SSE_PID 2>/dev/null; wait $SSE_PID 2>/dev/null

python3 - "$TMP/events.ndjson" <<'PY' > "$TMP/summary.txt"
import json,sys,collections
c=collections.Counter(); texts=[]; tools=[]; runids=set(); seqs=[]
for l in open(sys.argv[1]):
    l=l.strip()
    if not l.startswith("data:"): continue
    try: e=json.loads(l[5:])
    except: continue
    c[e.get("type")]+=1
    if e.get("run_id"): runids.add(e["run_id"])
    if e.get("seq") is not None: seqs.append(e["seq"])
    if e.get("type")=="response_complete": texts.append(e.get("text",""))
    if e.get("type")=="tool_complete": tools.append(e.get("result",""))
print(json.dumps({
  "counts": dict(c),
  "final_text": texts[-1] if texts else "",
  "tool_result": tools[-1] if tools else "",
  "run_ids": len(runids),
  "seq_sorted": seqs == sorted(seqs),
}))
PY

S=$(cat "$TMP/summary.txt")
cnt() { echo "$S" | python3 -c "import sys,json;print(json.load(sys.stdin)['counts'].get('$1',0))"; }

[ "$(cnt inject)" -ge 1 ]            && ok "événement inject diffusé"        || ko "inject manquant"
[ "$(cnt response)" -ge 1 ]          && ok "réponse streamée ($(cnt response) deltas)" || ko "aucun événement response"
[ "$(cnt response_complete)" = "1" ] && ok "un seul response_complete"       || ko "response_complete" "reçu $(cnt response_complete)"
[ "$(cnt run_complete)" = "1" ]      && ok "un seul run_complete"            || ko "run_complete" "reçu $(cnt run_complete)"
[ "$(cnt tool)" -ge 1 ]              && ok "outil annoncé ($(cnt tool) événement(s) tool)" || ko "aucun événement tool"
[ "$(cnt tool_complete)" -ge 1 ]     && ok "outil clôturé (tool_complete)"   || ko "aucun tool_complete — outil laissé en cours"

[ "$(cnt response)" -gt 3 ] \
  && ok "le texte arrive au fil de l'eau, pas en un bloc" \
  || ko "streaming" "seulement $(cnt response) événements response"

echo "$S" | grep -q '"seq_sorted": true' && ok "les seq sont croissants" || ko "seq non ordonnés"
echo "$S" | grep -q '"run_ids": 1'       && ok "un seul run_id sur tout le run" || ko "run_id incohérent"

echo "$S" | python3 -c "
import sys,json; d=json.load(sys.stdin)
t=d['tool_result']
print('OK' if ('total' in t or '.' in t) and t.strip() else 'KO')" | grep -q OK \
  && ok "la sortie du shell est remontée dans tool_complete" \
  || ko "tool_complete vide" "l'exécution de ls n'a rien remonté"

echo "$S" | python3 -c "
import sys,json; print('OK' if len(json.load(sys.stdin)['final_text'].strip())>10 else 'KO')" | grep -q OK \
  && ok "response_complete porte le texte final" \
  || ko "texte final vide"

head_ "4. Continuité de session"

second=$(TIMEOUT=30 api -X POST -H 'Content-Type: application/json' \
  -d "{\"conversation\":\"$CONV\",\"message\":\"Redis simplement OK.\"}" "$BASE/api/inject")
chat2=$(echo "$second" | jget "['chat_id']")
[ "$chat2" = "$chat_id" ] \
  && ok "le second tour réutilise la même session" \
  || ko "session non réutilisée" "$chat_id -> $chat2"

sleep 2
stopped=$(TIMEOUT=25 api -X POST -H 'Content-Type: application/json' \
  -d "{\"conversation\":\"$CONV\"}" "$BASE/api/conversations/stop")
echo "$stopped" | grep -q '"ok":true' && ok "/stop répond ok" || ko "/stop" "$stopped"

head_ "5. Reset"

reset=$(api -X POST -H 'Content-Type: application/json' \
  -d "{\"conversation\":\"$CONV\"}" "$BASE/api/conversations/reset")
echo "$reset" | grep -q '"resumed":false' && ok "/reset oublie la session" || ko "/reset" "$reset"

after=$(api "$BASE/api/conversations" | python3 -c "
import sys,json
d=json.load(sys.stdin)
c=[x for x in d['registered'] if x['name']=='$CONV']
print(c[0]['chat_id'] if c else 'ABSENTE')")
[ "$after" = "None" ] && ok "chat_id remis à zéro après reset" || ko "reset incomplet" "chat_id=$after"

head_ "6. Garde-fous"

bad=$(api -X POST -H 'Content-Type: application/json' -d '{"message":"x"}' "$BASE/api/inject")
echo "$bad" | grep -q 'conversation requise' && ok "inject sans conversation est rejeté" || ko "validation conversation"

bad=$(api -X POST -H 'Content-Type: application/json' \
  -d "{\"conversation\":\"$CONV\",\"message\":\"  \"}" "$BASE/api/inject")
echo "$bad" | grep -q 'message vide' && ok "inject avec message vide est rejeté" || ko "validation message"

code=$(api -o /dev/null -w '%{http_code}' "$BASE/api/inconnue")
[ "$code" = "404" ] && ok "une route inconnue renvoie 404" || ko "404" "reçu $code"

api -X POST -H 'Content-Type: application/json' -d "{\"conversation\":\"$CONV\"}" \
  "$BASE/api/conversations/delete" > /dev/null && ok "conversation de test supprimée" || ko "delete"

printf '\n\033[1mRésultat : %d ok, %d échec(s)\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
