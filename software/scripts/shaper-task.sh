#!/usr/bin/env bash
# ==============================================================================
# shaper-task.sh — Asynchronous Task Delegation & Retrieval CLI
# Interacts with the Shaper OS Queue server (:8640 locally or via proxy).
#
# Usage:
#   bash scripts/shaper-task.sh enqueue --type <type> --payload '<json>'
#   bash scripts/shaper-task.sh status --id <jobId>
#   bash scripts/shaper-task.sh wait --id <jobId> [--timeout <sec>]
#   bash scripts/shaper-task.sh list [--status <PENDING|RUNNING|COMPLETED|FAILED>]
#
# Examples:
#   bash scripts/shaper-task.sh enqueue --type "batch_ocr" --payload '{"count":500,"target":"/data/ged"}'
#   bash scripts/shaper-task.sh wait --id job-1787137500-1 --timeout 30
# ==============================================================================
set -euo pipefail

QUEUE_URL="${SHAPER_QUEUE_URL:-http://127.0.0.1:8640}"
CMD="${1:-help}"
shift || true

case "$CMD" in
  enqueue)
    TYPE="generic"
    PAYLOAD="{}"
    TOTAL_STEPS=1

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --type)
          TYPE="$2"
          shift 2
          ;;
        --payload)
          PAYLOAD="$2"
          shift 2
          ;;
        --steps)
          TOTAL_STEPS="$2"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done

    BODY="$(node -e "console.log(JSON.stringify({ type: process.argv[1], payload: JSON.parse(process.argv[2]), totalSteps: parseInt(process.argv[3], 10) }))" "$TYPE" "$PAYLOAD" "$TOTAL_STEPS")"
    RES="$(curl -s -X POST "${QUEUE_URL}/api/jobs" -H "Content-Type: application/json" -d "$BODY")"
    echo "$RES"
    ;;

  status)
    JOB_ID=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --id)
          JOB_ID="$2"
          shift 2
          ;;
        *)
          if [[ -z "$JOB_ID" ]]; then JOB_ID="$1"; fi
          shift
          ;;
      esac
    done

    if [[ -z "$JOB_ID" ]]; then
      echo "Error: --id <jobId> required"
      exit 1
    fi

    curl -s "${QUEUE_URL}/api/jobs/${JOB_ID}"
    ;;

  wait)
    JOB_ID=""
    TIMEOUT=60
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --id)
          JOB_ID="$2"
          shift 2
          ;;
        --timeout)
          TIMEOUT="$2"
          shift 2
          ;;
        *)
          if [[ -z "$JOB_ID" ]]; then JOB_ID="$1"; fi
          shift
          ;;
      esac
    done

    if [[ -z "$JOB_ID" ]]; then
      echo "Error: --id <jobId> required"
      exit 1
    fi

    START_TIME="$(date +%s)"
    while true; do
      RES="$(curl -s "${QUEUE_URL}/api/jobs/${JOB_ID}")"
      STATUS="$(node -e "try { const d = JSON.parse(process.argv[1]); console.log(d.job ? d.job.status : (d.status || 'UNKNOWN')); } catch { console.log('UNKNOWN'); }" "$RES")"
      
      if [[ "$STATUS" == "COMPLETED" || "$STATUS" == "FAILED" ]]; then
        echo "$RES"
        exit 0
      fi

      NOW="$(date +%s)"
      ELAPSED=$((NOW - START_TIME))
      if [[ $ELAPSED -ge $TIMEOUT ]]; then
        echo "{\"ok\":false,\"error\":\"Timeout ($TIMEOUT s) reached waiting for job $JOB_ID\",\"lastStatus\":\"$STATUS\"}"
        exit 1
      fi

      sleep 1
    done
    ;;

  list)
    STATUS=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --status)
          STATUS="$2"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done

    URL="${QUEUE_URL}/api/jobs"
    if [[ -n "$STATUS" ]]; then
      URL="${URL}?status=${STATUS}"
    fi
    curl -s "$URL"
    ;;

  *)
    echo "Shaper OS — Task Delegation CLI"
    echo "Usage:"
    echo "  bash scripts/shaper-task.sh enqueue --type <type> --payload '<json>'"
    echo "  bash scripts/shaper-task.sh status --id <jobId>"
    echo "  bash scripts/shaper-task.sh wait --id <jobId> [--timeout <sec>]"
    echo "  bash scripts/shaper-task.sh list [--status <status>]"
    ;;
esac
