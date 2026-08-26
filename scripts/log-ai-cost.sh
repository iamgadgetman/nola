#!/usr/bin/env bash
# log-ai-cost.sh — Write Claude/VAPI token usage to InfluxDB line protocol
#
# Usage (call from n8n Code node via exec, or from shell):
#   ./log-ai-cost.sh <workflow_name> <input_tokens> <output_tokens> [model] \
#                     [cache_read_tokens] [cache_write_tokens]
#
# The two cache arguments are optional and default to 0, so existing three- and
# four-argument callers are unaffected. Pass them when the API response reports
# cache_read_input_tokens / cache_creation_input_tokens — without them, anything
# using prompt caching is undercounted.
#
# Or pipe InfluxDB line protocol directly:
#   echo "ai_cost,workflow=proactive-monitor,model=claude-haiku-4-5 input_tokens=120i,output_tokens=480i" \
#     | ./log-ai-cost.sh
#
# Required env vars:
#   INFLUXDB_URL    — e.g. http://10.0.3.100:8086
#   INFLUXDB_TOKEN  — write token
#   INFLUXDB_ORG    — org name
#   INFLUXDB_BUCKET — bucket name (e.g. nola)

set -euo pipefail

INFLUXDB_URL="${INFLUXDB_URL:?INFLUXDB_URL not set}"
INFLUXDB_TOKEN="${INFLUXDB_TOKEN:?INFLUXDB_TOKEN not set}"
INFLUXDB_ORG="${INFLUXDB_ORG:-galaxy}"
INFLUXDB_BUCKET="${INFLUXDB_BUCKET:-nola}"

WORKFLOW="${1:-unknown}"
INPUT_TOKENS="${2:-0}"
OUTPUT_TOKENS="${3:-0}"
MODEL="${4:-claude-haiku-4-5}"
CACHE_READ_TOKENS="${5:-0}"
CACHE_WRITE_TOKENS="${6:-0}"

# Anthropic first-party API list prices, USD per 1M tokens. Verified 2026-08-20.
# Costs are priced at the moment the event is logged, so the Sonnet 5 intro
# window below resolves against today's date and lapses on its own.
# Note: cache reads/writes are not modelled — this script only receives plain
# input/output counts, so anything using prompt caching is undercounted.
case "$MODEL" in
  *haiku*)    INPUT_CPM="1.00";  OUTPUT_CPM="5.00"  ;;
  # Sonnet 5 introductory pricing is $2/$10 through 2026-08-31, list is $3/$15.
  # Must precede the generic *sonnet* arm; Sonnet 4.6 is not covered by it.
  *sonnet-5*)
    if [ "$(date +%Y%m%d)" -le 20260831 ]; then
      INPUT_CPM="2.00";  OUTPUT_CPM="10.00"
    else
      INPUT_CPM="3.00";  OUTPUT_CPM="15.00"
    fi
    ;;
  *sonnet*)   INPUT_CPM="3.00";  OUTPUT_CPM="15.00" ;;
  *opus*)     INPUT_CPM="5.00";  OUTPUT_CPM="25.00" ;;
  *fable*)    INPUT_CPM="10.00"; OUTPUT_CPM="50.00" ;;
  *)          INPUT_CPM="1.00";  OUTPUT_CPM="5.00"  ;;
esac

# Cache tokens are billed as a multiplier on the model's input rate: reads at
# 0.1x, writes at 1.25x for the default 5-minute TTL. (A 1-hour-TTL write is 2x;
# the callers here do not distinguish TTL, so the cheaper 5m rate is assumed and
# 1h-heavy workloads will read slightly low.)
CACHE_READ_CPM=$(echo "scale=6; $INPUT_CPM * 0.10" | bc)
CACHE_WRITE_CPM=$(echo "scale=6; $INPUT_CPM * 1.25" | bc)

# Calculate cost in micro-dollars (integer) to avoid float issues in InfluxDB
INPUT_COST=$(echo "scale=6; $INPUT_TOKENS * $INPUT_CPM / 1000000 * 1000000" | bc | cut -d. -f1)
OUTPUT_COST=$(echo "scale=6; $OUTPUT_TOKENS * $OUTPUT_CPM / 1000000 * 1000000" | bc | cut -d. -f1)
CACHE_READ_COST=$(echo "scale=6; $CACHE_READ_TOKENS * $CACHE_READ_CPM / 1000000 * 1000000" | bc | cut -d. -f1)
CACHE_WRITE_COST=$(echo "scale=6; $CACHE_WRITE_TOKENS * $CACHE_WRITE_CPM / 1000000 * 1000000" | bc | cut -d. -f1)
TOTAL_COST=$(( INPUT_COST + OUTPUT_COST + CACHE_READ_COST + CACHE_WRITE_COST ))

TIMESTAMP=$(date +%s%N)

LINE="ai_cost,workflow=${WORKFLOW},model=${MODEL} input_tokens=${INPUT_TOKENS}i,output_tokens=${OUTPUT_TOKENS}i,cache_read_tokens=${CACHE_READ_TOKENS}i,cache_write_tokens=${CACHE_WRITE_TOKENS}i,cost_microdollars=${TOTAL_COST}i ${TIMESTAMP}"

curl -sf \
  "${INFLUXDB_URL}/api/v2/write?org=${INFLUXDB_ORG}&bucket=${INFLUXDB_BUCKET}&precision=ns" \
  -H "Authorization: Token ${INFLUXDB_TOKEN}" \
  -H "Content-Type: text/plain; charset=utf-8" \
  --data-binary "$LINE"

echo "Logged: $LINE"
