#!/usr/bin/env bash
# log-ai-cost.sh — Write Claude/VAPI token usage to InfluxDB line protocol
#
# Usage (call from n8n Code node via exec, or from shell):
#   ./log-ai-cost.sh <workflow_name> <input_tokens> <output_tokens> [model]
#
# Or pipe InfluxDB line protocol directly:
#   echo "ai_cost,workflow=proactive-monitor,model=claude-haiku-4-5 input_tokens=120i,output_tokens=480i" \
#     | ./log-ai-cost.sh
#
# Required env vars:
#   INFLUXDB_URL    — e.g. http://10.0.11.100:8086
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

# Rough cost estimates (USD per 1M tokens) — update as pricing changes
case "$MODEL" in
  *haiku*)    INPUT_CPM="0.80";  OUTPUT_CPM="4.00"  ;;
  *sonnet*)   INPUT_CPM="3.00";  OUTPUT_CPM="15.00" ;;
  *opus*)     INPUT_CPM="15.00"; OUTPUT_CPM="75.00" ;;
  *)          INPUT_CPM="1.00";  OUTPUT_CPM="5.00"  ;;
esac

# Calculate cost in micro-dollars (integer) to avoid float issues in InfluxDB
INPUT_COST=$(echo "scale=6; $INPUT_TOKENS * $INPUT_CPM / 1000000 * 1000000" | bc | cut -d. -f1)
OUTPUT_COST=$(echo "scale=6; $OUTPUT_TOKENS * $OUTPUT_CPM / 1000000 * 1000000" | bc | cut -d. -f1)
TOTAL_COST=$(( INPUT_COST + OUTPUT_COST ))

TIMESTAMP=$(date +%s%N)

LINE="ai_cost,workflow=${WORKFLOW},model=${MODEL} input_tokens=${INPUT_TOKENS}i,output_tokens=${OUTPUT_TOKENS}i,cost_microdollars=${TOTAL_COST}i ${TIMESTAMP}"

curl -sf \
  "${INFLUXDB_URL}/api/v2/write?org=${INFLUXDB_ORG}&bucket=${INFLUXDB_BUCKET}&precision=ns" \
  -H "Authorization: Token ${INFLUXDB_TOKEN}" \
  -H "Content-Type: text/plain; charset=utf-8" \
  --data-binary "$LINE"

echo "Logged: $LINE"
