#!/usr/bin/env bash
# End-to-end checks against a running opencode-bridge.
# Exercises the real CLI and a real model, so it needs the bridge up.
#
#   bash scripts/test-cli.sh [base-url]
set -uo pipefail

BASE="${1:-http://127.0.0.1:4440}"
TOKEN_FILE="${TOKEN_FILE:-$HOME/.config/opencode-bridge/token}"
CONV="${CONV:-cli-test-$$}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; pass=$((pass+1)); }
ko()   { printf '  \033[31mFAIL\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; fail=$((fail+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if [ ! -r "$TOKEN_FILE" ]; then
  echo "token unreadable: $TOKEN_FILE" >&2
  exit 2
fi
T="$(cat "$TOKEN_FILE")"
api() { curl -s -m "${TIMEOUT:-20}" -H "Authorization: Bearer $T" "$@"; }
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d$1) if isinstance(d$1,(dict,list)) else d$1)" 2>/dev/null; }

head_ "1. Health and authentication"

# The service name is the one server.mjs answers; a guard test holds the two together.
if curl -s -m 10 "$BASE/api/health" | grep -q '"service":"brick-bridge-opencode"'; then
  ok "/api/health answers without a token"
else
  ko "/api/health" "the bridge does not answer on $BASE"
  echo; echo "aborting: bridge unreachable"; exit 1
fi

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/status")
[ "$code" = "401" ] && ok "/api/status refuses a call without a token (401)" \
                    || ko "/api/status without a token" "expected 401, got $code"

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer wrong" "$BASE/api/status")
[ "$code" = "401" ] && ok "a wrong token is refused (401)" \
                    || ko "wrong token" "expected 401, got $code"

status=$(api "$BASE/api/status")
ready=$(echo "$status" | jget "['ready']")
[ "$ready" = "True" ] && ok "the internal serve is ready (ready=true)" \
                      || ko "ready" "ready=$ready — opencode serve does not answer"
model=$(echo "$status" | jget "['model']")
ok "configured model: $model"

head_ "2. Conversation registry"

api "$BASE/api/conversations" | grep -q '"registered"' \
  && ok "/api/conversations returns a registry" \
  || ko "/api/conversations"

head_ "3. Full run (tool + text)"

api -N "$BASE/api/events?conversation=$CONV" > "$TMP/events.ndjson" &
SSE_PID=$!
sleep 2

inject=$(TIMEOUT=30 api -X POST -H 'Content-Type: application/json' \
  -d "{\"conversation\":\"$CONV\",\"message\":\"Run the command 'ls -la' then give a one-sentence conclusion.\"}" \
  "$BASE/api/inject")

if echo "$inject" | grep -q '"ok":true'; then
  ok "/api/inject accepts the run"
else
  ko "/api/inject" "$inject"
fi

run_id=$(echo "$inject" | jget "['run_id']")
chat_id=$(echo "$inject" | jget "['chat_id']")
[ -n "$run_id" ] && ok "a run_id is returned" || ko "run_id missing"
case "$chat_id" in ses_*) ok "an opencode session is open ($chat_id)";; *) ko "chat_id" "expected ses_*, got $chat_id";; esac

# Wait for run_complete, 120 s at most.
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

[ "$(cnt inject)" -ge 1 ]            && ok "inject event broadcast"             || ko "inject missing"
[ "$(cnt response)" -ge 1 ]          && ok "response streamed ($(cnt response) deltas)" || ko "no response event"
[ "$(cnt response_complete)" = "1" ] && ok "a single response_complete"        || ko "response_complete" "got $(cnt response_complete)"
[ "$(cnt run_complete)" = "1" ]      && ok "a single run_complete"             || ko "run_complete" "got $(cnt run_complete)"
[ "$(cnt tool)" -ge 1 ]              && ok "tool announced ($(cnt tool) tool event(s))" || ko "no tool event"
[ "$(cnt tool_complete)" -ge 1 ]     && ok "tool closed (tool_complete)"       || ko "no tool_complete — tool left running"

[ "$(cnt response)" -gt 3 ] \
  && ok "the text arrives as it flows, not in one block" \
  || ko "streaming" "only $(cnt response) response events"

echo "$S" | grep -q '"seq_sorted": true' && ok "the seq values are increasing" || ko "seq out of order"
echo "$S" | grep -q '"run_ids": 1'       && ok "a single run_id across the whole run" || ko "inconsistent run_id"

echo "$S" | python3 -c "
import sys,json; d=json.load(sys.stdin)
t=d['tool_result']
print('OK' if ('total' in t or '.' in t) and t.strip() else 'KO')" | grep -q OK \
  && ok "the shell output came back in tool_complete" \
  || ko "empty tool_complete" "running ls reported nothing"

echo "$S" | python3 -c "
import sys,json; print('OK' if len(json.load(sys.stdin)['final_text'].strip())>10 else 'KO')" | grep -q OK \
  && ok "response_complete carries the final text" \
  || ko "empty final text"

head_ "4. Session continuity"

second=$(TIMEOUT=30 api -X POST -H 'Content-Type: application/json' \
  -d "{\"conversation\":\"$CONV\",\"message\":\"Simply say OK.\"}" "$BASE/api/inject")
chat2=$(echo "$second" | jget "['chat_id']")
[ "$chat2" = "$chat_id" ] \
  && ok "the second turn reuses the same session" \
  || ko "session not reused" "$chat_id -> $chat2"

sleep 2
stopped=$(TIMEOUT=25 api -X POST -H 'Content-Type: application/json' \
  -d "{\"conversation\":\"$CONV\"}" "$BASE/api/conversations/stop")
echo "$stopped" | grep -q '"ok":true' && ok "/stop answers ok" || ko "/stop" "$stopped"

head_ "5. Reset"

reset=$(api -X POST -H 'Content-Type: application/json' \
  -d "{\"conversation\":\"$CONV\"}" "$BASE/api/conversations/reset")
echo "$reset" | grep -q '"resumed":false' && ok "/reset forgets the session" || ko "/reset" "$reset"

after=$(api "$BASE/api/conversations" | python3 -c "
import sys,json
d=json.load(sys.stdin)
c=[x for x in d['registered'] if x['name']=='$CONV']
print(c[0]['chat_id'] if c else 'ABSENT')")
[ "$after" = "None" ] && ok "chat_id cleared after reset" || ko "incomplete reset" "chat_id=$after"

head_ "6. Guards"

# The error strings below are the ones server.mjs sends, grepped verbatim.
bad=$(api -X POST -H 'Content-Type: application/json' -d '{"message":"x"}' "$BASE/api/inject")
echo "$bad" | grep -q 'conversation requise' && ok "inject without a conversation is rejected" || ko "conversation validation"

bad=$(api -X POST -H 'Content-Type: application/json' \
  -d "{\"conversation\":\"$CONV\",\"message\":\"  \"}" "$BASE/api/inject")
echo "$bad" | grep -q 'message vide' && ok "inject with an empty message is rejected" || ko "message validation"

code=$(api -o /dev/null -w '%{http_code}' "$BASE/api/unknown")
[ "$code" = "404" ] && ok "an unknown route returns 404" || ko "404" "got $code"

api -X POST -H 'Content-Type: application/json' -d "{\"conversation\":\"$CONV\"}" \
  "$BASE/api/conversations/delete" > /dev/null && ok "test conversation deleted" || ko "delete"

printf '\n\033[1mResult: %d ok, %d failure(s)\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
