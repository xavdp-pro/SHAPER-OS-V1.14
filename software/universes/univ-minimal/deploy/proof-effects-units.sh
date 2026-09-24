#!/usr/bin/env bash
# Intent: software/universes/univ-minimal/INTENT.md#proof
# Sourced by proof-effects.sh: the real effects of Logger, Queue and Maestro,
# each read back from the unit's own database through the root path. Every job
# this proof creates ends COMPLETED; it leaves nothing PENDING behind.

H='Content-Type: application/json'

# Called by proof-effects.sh when a previous run recorded its markers.
persisted_effects() {
  local job key
  job="$(last queue_job)"; key="$(last queue_key)"
  check "queue-persisted" "run's job $job still COMPLETED under its key in queue.jobs" \
    test "$(rootsql queue queue -e "SELECT CONCAT(status,'|',idempotency_key) FROM jobs WHERE id='$job'")" = "COMPLETED|$key"
  [[ "$(type -t persisted_logger)" == function ]] && persisted_logger
  [[ "$(type -t persisted_maestro)" == function ]] && persisted_maestro
}

# ── Queue ───────────────────────────────────────────────────────────────────
section "queue — one job per idempotency key, held in its own database"
Q="$(url queue)"; K="$RUN_ID"
body='{"type":"proof.ping","totalSteps":1,"payload":{"run":"'"$RUN_ID"'"},"idempotencyKey":"'"$K"'"}'
code="$(curl -s -o /tmp/proof-q1.json -w '%{http_code}' -X POST "$Q/api/jobs" -H "$H" -d "$body")"
job="$(jq -r '.job.id // empty' /tmp/proof-q1.json)"
check "queue-create" "POST /api/jobs → 201 ($job)" test "$code" = 201
check "queue-replay" "the same request again → 200, same job, duplicate:true" \
  test "$(curl -s -X POST "$Q/api/jobs" -H "$H" -d "$body" | jq -r '"\(.duplicate)|\(.job.id)"')" = "true|$job"
check "queue-conflict" "same key, other content → 409 IDEMPOTENCY_CONFLICT" \
  test "$(curl -s -o /tmp/proof-q2.json -w '%{http_code}' -X POST "$Q/api/jobs" -H "$H" \
          -d '{"type":"proof.ping","payload":{"other":1},"idempotencyKey":"'"$K"'"}')|$(jq -r .code /tmp/proof-q2.json)" = "409|IDEMPOTENCY_CONFLICT"

race="$RUN_ID-race"
for i in 1 2 3 4 5 6 7 8; do
  curl -s -o "/tmp/proof-race-$i.json" -X POST "$Q/api/jobs" -H "$H" \
    -d '{"type":"proof.ping","payload":{"race":true},"idempotencyKey":"'"$race"'"}' &
done; wait
check "queue-race" "8 simultaneous POSTs with one key → one row in queue.jobs" \
  test "$(rootsql queue queue -e "SELECT COUNT(*) FROM jobs WHERE idempotency_key='$race'")" = 1
racejob="$(jq -r '.job.id' /tmp/proof-race-1.json)"

for j in "$job" "$racejob"; do
  curl -s -o /dev/null -X PATCH "$Q/api/jobs/$j" -H "$H" -d '{"status":"COMPLETED","progress":100,"step":1,"result":{"run":"'"$RUN_ID"'"}}'
done
check "queue-settled-in-db" "both jobs COMPLETED in queue.jobs, each with its transition history" \
  test "$(rootsql queue queue -e "SELECT COUNT(*) FROM jobs j WHERE j.id IN ('$job','$racejob') AND j.status='COMPLETED'
          AND (SELECT COUNT(*) FROM job_transitions t WHERE t.job_id=j.id) >= 2")" = 2
check "queue-nothing-pending" "no job left PENDING by this proof" \
  test "$(rootsql queue queue -e "SELECT COUNT(*) FROM jobs WHERE status='PENDING' AND idempotency_key LIKE '$RUN_ID%'")" = 0
record queue_job "$job"; record queue_key "$K"
rm -f /tmp/proof-q1.json /tmp/proof-q2.json /tmp/proof-race-*.json

# ── Logger ──────────────────────────────────────────────────────────────────
persisted_logger() {
  local id digest
  id="$(last logger_event)"; digest="$(last logger_digest)"
  check "logger-persisted" "run's event $id unchanged in logger.events (stored digest)" \
    test "$(rootsql logger logger -e "SELECT digest FROM events WHERE id='$id'")" = "$digest"
}

section "logger — events accepted once, immutable, in the month's partition"
L="$(url logger)"; C="$RUN_ID"
once='{"pod":"proof","event":"PROOF_ONCE","correlationId":"'"$C"'","sourceEventId":"'"$C"'/once","data":{"run":"'"$RUN_ID"'"}}'
first="$(curl -s -X POST "$L/api/ingest" -H "$H" -d "$once")"
eid="$(jq -r '.record.id // empty' <<<"$first")"
check "logger-ingest" "POST /api/ingest with a source event id → record $eid" test -n "$eid"
check "logger-replay" "the same event again → the original record, replayed:true" \
  test "$(curl -s -X POST "$L/api/ingest" -H "$H" -d "$once" | jq -r '"\(.replayed)|\(.record.id)"')" = "true|$eid"
check "logger-conflict" "same source id, other content → 409 SOURCE_EVENT_CONFLICT" \
  test "$(curl -s -o /tmp/proof-l.json -w '%{http_code}' -X POST "$L/api/ingest" -H "$H" \
          -d '{"pod":"proof","event":"PROOF_ONCE","correlationId":"'"$C"'","sourceEventId":"'"$C"'/once","data":{"other":1}}')|$(jq -r .code /tmp/proof-l.json)" = "409|SOURCE_EVENT_CONFLICT"
rm -f /tmp/proof-l.json
check "logger-one-row" "one PROOF_ONCE row and one ingest key for this run (root path)" \
  test "$(rootsql logger logger -e "SELECT CONCAT((SELECT COUNT(*) FROM events WHERE correlation_id='$C' AND event='PROOF_ONCE'),'|',(SELECT COUNT(*) FROM ingest_keys WHERE source_event_id='$C/once'))")" = "1|1"
check "logger-conflict-recorded" "the refused claim is itself recorded as LOGGER_INGEST_CONFLICT" \
  test "$(rootsql logger logger -e "SELECT COUNT(*) FROM events WHERE correlation_id='$C' AND event='LOGGER_INGEST_CONFLICT'")" = 1
part="p$(date -u +%Y_%m)"
check "logger-partition" "the event landed in partition $part" \
  test "$(rootsql logger logger -e "SELECT COUNT(*) FROM events PARTITION ($part) WHERE id='$eid'")" = 1
check "logger-immutable" "UPDATE on events is refused, even through the root path" \
  bash -c "podman exec -i '${UNIVERSE}-ctr-logger-mariadb' mariadb -uroot logger -e \"UPDATE events SET level=level WHERE id='$eid'\" 2>&1 | grep -q 'immutable'"
# The digest recomputed here, from the event as the API lists it, by jq and
# sha256sum — no code of the Logger involved.
recomputed="$(curl -s "$L/api/events/last?correlationId=$C&event=PROOF_ONCE" | jq -cS '.events[0] | {kind:"shaper.logger.event",v:1,id,receivedAt:.at,pod,event,level,correlationId,executionId:.execution_id,durationMs:.duration_ms,sourceEventId,data}' | tr -d '\n' | sha256sum | cut -d' ' -f1)"
check "logger-digest-independent" "the stored digest equals SHA-256 of the canonical event, recomputed outside the Logger" \
  test "$(rootsql logger logger -e "SELECT digest FROM events WHERE id='$eid'")" = "$recomputed"
record logger_event "$eid"; record logger_digest "$(rootsql logger logger -e "SELECT digest FROM events WHERE id='$eid'")"

# ── Maestro ─────────────────────────────────────────────────────────────────
persisted_maestro() {
  local occ job
  occ="$(last maestro_occurrence)"; job="$(last maestro_job)"
  check "maestro-persisted" "run's occurrence $occ still ENQUEUED with job $job in maestro.occurrences" \
    test "$(rootsql maestro maestro -e "SELECT CONCAT(state,'|',queue_job_id) FROM occurrences WHERE occurrence_id='$occ'")" = "ENQUEUED|$job"
}

section "maestro — one idempotent occurrence per due instant, and idle otherwise"
M="$(url maestro)"; S="task-proof-maestro"
check "maestro-idle-declared" "the class declares no schedule: no enabled schedule before the proof" \
  test "$(rootsql maestro maestro -e "SELECT COUNT(*) FROM schedules WHERE enabled=1")" = 0
# A proof schedule whose first natural instant is in 2099: it fires only when
# ticked, and the task file (which declares none) retires it at the restart below.
check "maestro-register" "POST /api/tasks/register $S (anchored in 2099, never fires by itself)" \
  curl -sf -o /dev/null -X POST "$M/api/tasks/register" -H "$H" \
    -d '{"slug":"'"$S"'","kind":"queue","jobType":"maestro.proof","cadenceSeconds":86400,"anchorAt":"2099-01-01T00:00:00.000Z","missedPolicy":"skip","instruction":"Maestro proof occurrence; the universe proof completes this job itself."}'
tick="$(curl -s -X POST "$M/api/tasks/$S/tick")"
occ="$(jq -r '.result.occurrence.occurrenceId // empty' <<<"$tick")"
mjob="$(jq -r '.result.occurrence.queueJobId // empty' <<<"$tick")"
planned="$(jq -r '.result.occurrence.plannedAt // empty' <<<"$tick")"
rev="$(jq -r '.result.occurrence.revision // empty' <<<"$tick")"
check "maestro-tick-enqueued" "tick → occurrence ENQUEUED with a Queue job ($mjob)" \
  test "$(jq -r '.result.occurrence.state' <<<"$tick")" = ENQUEUED -a -n "$mjob"
check "maestro-occurrence-id" "occurrence id = occ-sha256(universe|schedule|revision|planned), recomputed outside Maestro" \
  test "occ-$(printf '%s' "$UNIVERSE|$S|$rev|$planned" | sha256sum | cut -d' ' -f1)" = "$occ"
check "maestro-in-db" "the occurrence row in maestro.occurrences (root path) names the same job" \
  test "$(rootsql maestro maestro -e "SELECT CONCAT(state,'|',queue_job_id) FROM occurrences WHERE occurrence_id='$occ'")" = "ENQUEUED|$mjob"
check "maestro-one-job" "Queue holds exactly one job under the occurrence id (queue.jobs, root path)" \
  test "$(rootsql queue queue -e "SELECT GROUP_CONCAT(id) FROM jobs WHERE idempotency_key='$occ'")" = "$mjob"
rootsql maestro maestro -r -e "SELECT request_json FROM occurrences WHERE occurrence_id='$occ'" > "$STATE_DIR/frozen-request.json"
check "maestro-replay-same-job" "the frozen request resent → 200, duplicate:true, the same job" \
  test "$(curl -s -X POST "$(url queue)/api/jobs" -H "$H" --data-binary @"$STATE_DIR/frozen-request.json" | jq -r '"\(.duplicate)|\(.job.id)"')" = "true|$mjob"
rm -f "$STATE_DIR/frozen-request.json"
curl -s -o /dev/null -X PATCH "$(url queue)/api/jobs/$mjob" -H "$H" -d '{"status":"COMPLETED","progress":100,"step":2,"result":{"run":"'"$RUN_ID"'"}}'

podman restart "${UNIVERSE}-ctr-maestro" >/dev/null
for _ in $(seq 1 60); do curl -sf "$M/api/health" >/dev/null && break; sleep 1; done
check "maestro-restart-no-duplicate" "after a restart: still one occurrence for that instant, one job under its key" \
  test "$(rootsql maestro maestro -e "SELECT COUNT(*) FROM occurrences WHERE schedule_id='$S' AND planned_at='${planned%Z}' ")|$(rootsql queue queue -e "SELECT COUNT(*) FROM jobs WHERE idempotency_key='$occ'")" = "1|1"
check "maestro-idle-again" "the undeclared proof schedule is retired at restart: Maestro is idle" \
  test "$(rootsql maestro maestro -e "SELECT COUNT(*) FROM schedules WHERE enabled=1")" = 0
check "maestro-job-settled" "the proof's Maestro job is COMPLETED in queue.jobs" \
  test "$(rootsql queue queue -e "SELECT status FROM jobs WHERE id='$mjob'")" = COMPLETED
record maestro_occurrence "$occ"; record maestro_job "$mjob"
