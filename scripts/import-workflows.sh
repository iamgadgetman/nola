#!/usr/bin/env bash
# NOLA workflow importer
# Automates Steps 4a-4d from SETUP.md using the n8n REST API.
#
# Usage:
#   ./scripts/import-workflows.sh
#
# Requires:
#   - n8n is running and reachable at N8N_BASE_URL (default http://localhost:5678)
#   - N8N_API_KEY set in environment or .env file (Settings → API → Create API Key)
#
# The script will:
#   1. Import tool-run-command.json and capture its workflow ID
#   2. Write WORKFLOW_ID_RUN_COMMAND to .env and restart n8n
#   3. Import and activate the main workflow and optional workflows

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env if present
if [[ -f "$REPO_DIR/.env" ]]; then
  set -a; source "$REPO_DIR/.env"; set +a
fi

N8N_BASE_URL="${N8N_BASE_URL:-http://localhost:5678}"
N8N_API_URL="$N8N_BASE_URL/api/v1"

# ── Validate requirements ─────────────────────────────────────────
if [[ -z "${N8N_API_KEY:-}" ]]; then
  echo "ERROR: N8N_API_KEY is not set."
  echo "  1. Open n8n at $N8N_BASE_URL"
  echo "  2. Go to Settings → API → Create an API key"
  echo "  3. Export it: export N8N_API_KEY=<your-key>"
  echo "     or add it to your .env file"
  exit 1
fi

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is required but not installed."
  exit 1
fi
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed."
  exit 1
fi

# ── Helper: import a workflow JSON and return its ID ──────────────
import_workflow() {
  local file="$1"
  local name
  name="$(jq -r '.name' "$file")"
  echo "→ Importing: $name"

  local response
  response=$(curl -sf -X POST "$N8N_API_URL/workflows" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d @"$file")

  local id
  id="$(echo "$response" | jq -r '.id // empty')"
  if [[ -z "$id" ]]; then
    echo "  ERROR: Failed to import $name"
    echo "  Response: $response"
    return 1
  fi
  echo "  ID: $id"
  echo "$id"
}

# ── Helper: activate a workflow by ID ────────────────────────────
activate_workflow() {
  local id="$1"
  curl -sf -X PATCH "$N8N_API_URL/workflows/$id" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"active": true}' >/dev/null
  echo "  Activated."
}

# ── Wait for n8n to be ready ──────────────────────────────────────
echo "Waiting for n8n at $N8N_BASE_URL ..."
for i in $(seq 1 30); do
  if curl -sf "$N8N_BASE_URL/healthz" >/dev/null 2>&1; then
    echo "n8n is up."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: n8n did not become ready in time."
    exit 1
  fi
  sleep 2
done

# ── Step 1: Import tool-run-command (must be first) ───────────────
echo ""
echo "Step 1: Importing tool-run-command sub-workflow..."
RUN_CMD_ID=$(import_workflow "$REPO_DIR/workflows/tool-run-command.json")

# ── Step 2: Persist WORKFLOW_ID_RUN_COMMAND to .env ──────────────
echo ""
echo "Step 2: Writing WORKFLOW_ID_RUN_COMMAND=$RUN_CMD_ID to .env..."
ENV_FILE="$REPO_DIR/.env"
if grep -q "^WORKFLOW_ID_RUN_COMMAND=" "$ENV_FILE" 2>/dev/null; then
  sed -i "s/^WORKFLOW_ID_RUN_COMMAND=.*/WORKFLOW_ID_RUN_COMMAND=$RUN_CMD_ID/" "$ENV_FILE"
else
  echo "WORKFLOW_ID_RUN_COMMAND=$RUN_CMD_ID" >> "$ENV_FILE"
fi
echo "  Written."

# ── Step 3: Restart n8n to pick up the new env var ───────────────
echo ""
echo "Step 3: Restarting n8n to apply WORKFLOW_ID_RUN_COMMAND..."
docker compose -f "$REPO_DIR/docker-compose.yml" -f "$REPO_DIR/docker-compose.override.yml" restart n8n

echo "Waiting for n8n to come back up..."
sleep 5
for i in $(seq 1 30); do
  if curl -sf "$N8N_BASE_URL/healthz" >/dev/null 2>&1; then
    echo "n8n is up."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: n8n did not restart in time."
    exit 1
  fi
  sleep 2
done

# ── Step 4: Import and activate the main workflow ─────────────────
echo ""
echo "Step 4: Importing and activating main workflow..."
MAIN_ID=$(import_workflow "$REPO_DIR/workflows/nola-main-workflow.json")
activate_workflow "$MAIN_ID"

# ── Step 5: Import optional workflows ────────────────────────────
OPTIONAL=(
  "workflows/proactive-monitor.json"
  "workflows/weekly-digest.json"
  "workflows/librenms-alert.json"
  "integrations/vapi-tool-handler.json"
)

echo ""
echo "Step 5: Importing optional workflows..."
for wf in "${OPTIONAL[@]}"; do
  wf_path="$REPO_DIR/$wf"
  if [[ -f "$wf_path" ]]; then
    WF_ID=$(import_workflow "$wf_path")
    activate_workflow "$WF_ID"
  fi
done

echo ""
echo "All workflows imported and activated."
echo "Open n8n at $N8N_BASE_URL to verify."
