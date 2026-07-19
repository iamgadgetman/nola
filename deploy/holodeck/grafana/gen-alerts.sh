#!/usr/bin/env bash
# Fills the Prometheus datasource UID into the alert-rule template and writes
# nola-mysql-alerts.generated.yaml, ready to drop into Grafana provisioning.
#
# UID resolution order:
#   1. first arg:            ./gen-alerts.sh <uid>
#   2. $PROM_DS_UID env
#   3. auto-lookup via Grafana API using GRAFANA_URL + GRAFANA_TOKEN
#      (read from ../../dashboard/.env if present)
set -euo pipefail
cd "$(dirname "$0")"

TEMPLATE="alerting/nola-mysql-alerts.yaml"
OUT="alerting/nola-mysql-alerts.generated.yaml"

UID_VAL="${1:-${PROM_DS_UID:-}}"

if [ -z "$UID_VAL" ]; then
  # Pull Grafana creds from the dashboard .env if not already in the environment
  if [ -f ../../dashboard/.env ]; then
    set -a; . ../../dashboard/.env; set +a
  fi
  if [ -n "${GRAFANA_URL:-}" ] && [ -n "${GRAFANA_TOKEN:-}" ]; then
    echo "Looking up Prometheus datasource UID from ${GRAFANA_URL}..." >&2
    json="$(curl -s -H "Authorization: Bearer ${GRAFANA_TOKEN}" "${GRAFANA_URL}/api/datasources" || true)"
    if command -v jq >/dev/null 2>&1; then
      UID_VAL="$(printf '%s' "$json" | jq -r 'map(select(.type=="prometheus"))[0].uid // empty' 2>/dev/null || true)"
    elif command -v python3 >/dev/null 2>&1; then
      UID_VAL="$(printf '%s' "$json" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(next((x["uid"] for x in d if x.get("type")=="prometheus"), ""))
except Exception:
    pass' 2>/dev/null || true)"
    fi
  fi
fi

if [ -z "$UID_VAL" ] || [ "$UID_VAL" = "null" ]; then
  cat >&2 <<'MSG'
error: could not determine the Prometheus datasource UID.
Pass it explicitly:   ./gen-alerts.sh <uid>
Find it in Grafana:   Connections → Data sources → Prometheus
                      (the uid is the last path segment of that page's URL)
MSG
  exit 1
fi

sed "s/PROMETHEUS_DS_UID/${UID_VAL}/g" "$TEMPLATE" > "$OUT"
echo "Wrote $OUT (datasource uid: ${UID_VAL})"
echo
echo "Install on the Grafana host:"
echo "  cp $OUT /etc/grafana/provisioning/alerting/nola-mysql-alerts.yaml"
echo "  systemctl restart grafana-server        # or restart the Grafana container"
echo
echo "Firing rules then show up in Grafana AND the NOLA app's Alerts tab."
