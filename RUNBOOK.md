# NOLA Operations Runbook
_Last updated: 2026-04-13_

Quick reference for common failure scenarios across NOLA, netflow, WireGuard, and Grafana.

---

## Table of Contents
1. [NOLA Stack — Common Issues](#1-nola-stack--common-issues)
2. [Grafana / Prometheus Alerts](#2-grafana--prometheus-alerts)
3. [Netflow / ntopng](#3-netflow--ntopng)
4. [WireGuard](#4-wireguard)
5. [OPNsense / Firewall](#5-opnsense--firewall)
6. [General Docker / Service Recovery](#6-general-docker--service-recovery)
7. [NOLA Dashboard](#7-nola-dashboard)
8. [Proxmox / union](#8-proxmox--union)

---

## 1. NOLA Stack — Common Issues

### n8n won't start
```bash
docker compose logs n8n | tail -50
```
**Common causes:**
- `POSTGRES_PASSWORD` not set in `.env` → set it and restart
- Postgres not healthy yet → wait 30s; check `docker compose ps postgres`
- `N8N_ENCRYPTION_KEY` changed → workflows encrypted with old key won't decrypt; do NOT change this key after first run

**Fix:**
```bash
docker compose down
docker compose up -d
```

### Workflow executions failing silently
1. Check n8n execution history at `http://n8n.galaxy.rip/executions`
2. Check for expired n8n API key (used by `import-workflows.sh`): Settings → API → regenerate
3. Check that `N8N_WEBHOOK_BASE_URL` in `.env` matches the actual reachable URL

### Discord bot not responding
```bash
docker compose logs nola-bot | tail -30
```
- `DISCORD_TOKEN` invalid → regenerate in Discord Developer Portal
- `DISCORD_CHANNEL_ID` wrong → bot only listens in that channel
- Webhook relay failing → check `N8N_WEBHOOK` var in override file; test with `curl`

### Proactive monitor alert dedup not working
Alert dedup uses `$workflow.staticData` in n8n. If alerts are repeating:
1. Open the workflow in n8n
2. Check "Dedup Check" node → inspect `staticData` in the last execution
3. If state is stuck, manually clear it: edit the node and delete the `staticData` keys

### Postgres backup not running
```bash
docker compose logs postgres-backup | tail -20
```
- Verify `POSTGRES_PASSWORD` is set (backup uses `PGPASSWORD`)
- Backups land in the `postgres_backups` Docker volume
- Check disk space: `docker system df`

---

## 2. Grafana / Prometheus Alerts

### Alert firing but no notification received
1. Check alert state in Grafana: Alerts → Alert Rules
2. Verify contact point is reachable: Alerting → Contact Points → Test
3. Check n8n webhook is active: `/api/v1/workflows` → confirm the alert-receiver workflow is active
4. Check Discord webhook URL hasn't changed

### Grafana dashboard shows "No data"
- Prometheus scrape target down → check `http://prometheus.galaxy.rip/targets`
- InfluxDB token expired → rotate `INFLUXDB_TOKEN` and restart affected services
- Wrong time range selected → check the dashboard time picker

### LibreNMS alerts not reaching n8n
1. LibreNMS → Alerts → Alert Transports → verify the n8n webhook transport is enabled
2. Check transport JSON template has correct field mapping
3. Test: LibreNMS → Alerts → Alert Rules → trigger a test alert

---

## 3. Netflow / ntopng

### No netflow data in InfluxDB / Grafana
1. Check Telegraf is running on the collector host:
   ```bash
   sudo systemctl status telegraf
   sudo journalctl -u telegraf -n 50
   ```
2. Verify env vars are set for Telegraf's exec plugin:
   ```bash
   sudo -u telegraf env | grep NTOPNG
   ```
3. Run the collector manually to test:
   ```bash
   NTOPNG_FORT_TOKEN=<token> python3 /home/gadget/apps/claude/netflow/ntopng_collector.py
   ```
4. Check ntopng is reachable: `curl -H "Authorization: Token <token>" http://10.0.16.100:3005/lua/rest/v2/get/ntopng/interfaces.lua`

### Collector errors with "URLError"
- ntopng service may be down on the firewall
- Token may have expired → regenerate in ntopng → Settings → Users
- Port 3005 blocked → check firewall rules

---

## 4. WireGuard

### Peer can't connect
1. Verify peer public key matches on both sides
2. Check `AllowedIPs` includes the peer's IP
3. Check that `PostUp`/`PostDown` rules aren't blocking traffic
4. On OPNsense: confirm WireGuard service is running (Services → WireGuard → Status)

### Config changes not taking effect
**IMPORTANT:** Never use partial POST to OPNsense WireGuard API (setServer/setClient) — it silently drops peers.
Always export the full current config, modify it, and POST the complete object.

To apply WireGuard config changes:
```bash
# 1. Export current config via API
curl -u 'key:secret' https://10.0.16.100:5223/api/wireguard/server/getServer/<uuid>

# 2. Modify the full JSON
# 3. POST the complete object
curl -u 'key:secret' -X POST https://10.0.16.100:5223/api/wireguard/server/setServer/<uuid> \
  -H 'Content-Type: application/json' -d @full_config.json

# 4. Apply
curl -u 'key:secret' -X POST https://10.0.16.100:5223/api/wireguard/service/reconfigure
```

---

## 5. OPNsense / Firewall

### API calls failing (401/403)
- API key/secret may have been regenerated → update in scripts/env files
- API port is **5223** (not 443)
- For halt.universe: URL is `halt.universe` (not `halt.galaxy.rip`)

### DNS change not resolving
After adding/modifying Unbound host overrides:
```bash
curl -u 'key:secret' -X POST https://10.0.16.100:5223/api/unbound/service/reconfigure
```
This is required — changes don't apply until reconfigure is called.

### Adding a DNS record
```bash
# 1. Add host override
curl -u 'key:secret' -X POST https://10.0.16.100:5223/api/unbound/settings/addHostOverride \
  -H 'Content-Type: application/json' \
  -d '{"host": {"hostname": "newhost", "domain": "galaxy.rip", "server": "10.0.11.x"}}'

# 2. Apply
curl -u 'key:secret' -X POST https://10.0.16.100:5223/api/unbound/service/reconfigure
```

---

## 6. General Docker / Service Recovery

### Service crashed — quick restart
```bash
docker compose restart <service-name>
```

### Full stack restart (preserves data)
```bash
cd /home/gadget/apps/NOLA
docker compose down
docker compose up -d
```

### Check all service health
```bash
docker compose ps
docker stats --no-stream
```

### Clear stuck containers
```bash
docker compose down --remove-orphans
docker compose up -d
```

### Disk space low
```bash
docker system df          # show Docker disk usage
docker system prune       # remove stopped containers, unused images, build cache
docker volume ls          # list volumes (don't prune volumes without backing up first)
```

### View logs for a service
```bash
docker compose logs -f <service>   # follow live
docker compose logs --tail=100 <service>
```

---

---

## 7. NOLA Dashboard

The dashboard is a Node.js/Express app that aggregates Prometheus, Grafana alerts,
InfluxDB WAN traffic, and the Proxmox API into a single read-only view.

**Source:** `dashboard/` in this repo  
**Live container:** `nola-dashboard` on containy (`10.0.11.11`)  
**Live URL:** https://nola.galaxy.rip  
**Container IP:** `10.0.11.55:3000`

### Redeploy after code changes

```bash
# From this machine — sync files then rebuild on containy
rsync -av dashboard/server.js dashboard/public/ \
  gadget@10.0.11.11:~/apps/nola-dashboard/public/
rsync -av dashboard/server.js gadget@10.0.11.11:~/apps/nola-dashboard/

ssh gadget@10.0.11.11
cd ~/apps/nola-dashboard
docker compose build --no-cache
docker compose up -d
docker logs nola-dashboard --tail 10
```

### Configuration (live .env on containy)

`~/apps/nola-dashboard/.env` on containy. Key vars:

| Var | Purpose |
|-----|---------|
| `PROMETHEUS_URL` | `http://10.0.11.69:9090` |
| `GRAFANA_URL` / `GRAFANA_TOKEN` | Grafana unified alerting |
| `INFLUXDB_URL` / `INFLUXDB_TOKEN` | OPNsense WAN traffic via InfluxDB |
| `LINUX_HOSTS` | Comma-separated Prometheus instance labels for Linux hosts |
| `FW_HOSTS` | OPNsense firewall labels (orange FW badge) |
| `PVE_HOSTS` | Proxmox hypervisor labels (orange PVE badge, default: `pve`) |
| `PVE_API_URL` | `https://10.0.16.32:8006` |
| `PVE_API_TOKEN` | `root@pam!nola=<secret>` — see Proxmox token below |
| `OLLAMA_URL` | Primary LLM for Ask NOLA |
| `ANTHROPIC_API_KEY` | Fallback LLM if Ollama is unreachable |
| `AUTH_ENABLED` | Set `true` + configure OAuth2 proxy to enable auth |

### Dashboard not loading / blank page

```bash
docker logs nola-dashboard --tail 30
curl -s http://10.0.11.55:3000/api/health
```

### PVE card shows "unavailable"

The Proxmox API call is failing. Most likely causes:
1. Token expired or revoked → recreate at Proxmox → Datacenter → Permissions → API Tokens
2. Network unreachable → `curl -k https://10.0.16.32:8006/api2/json/version`
3. Token format wrong → must be `root@pam!nola=<uuid>` (note the `!`)

Test the token directly:
```bash
curl -sk -H "Authorization: PVEAPIToken=root@pam!nola=<secret>" \
  https://10.0.16.32:8006/api2/json/nodes/pve/status | python3 -m json.tool
```

### Adding a new host to the dashboard

1. Install node_exporter on the host (see §8 for the install snippet)
2. Add a scrape target to `/home/gadget/proxy-setup/prometheus/prometheus.yml` on containy:
   ```yaml
   - targets: ['<IP>:9100']
     labels:
       instance: <hostname>
       host: <hostname>
   ```
3. Reload Prometheus: `docker kill -s SIGHUP containy-prometheus`
4. Add the hostname to `LINUX_HOSTS` (or `PVE_HOSTS`) in `~/apps/nola-dashboard/.env`
5. Restart dashboard: `cd ~/apps/nola-dashboard && docker compose up -d`

### Ask NOLA returning stale/wrong data

The `/api/ask` endpoint fetches live data on every request — it is not cached.
If the LLM answer seems wrong, check the raw context:
```bash
curl -s http://10.0.11.55:3000/api/data | python3 -m json.tool | head -60
```

---

## 8. Proxmox / union

### Infrastructure summary

| Host | IP | Role | SSH user |
|------|----|------|----------|
| pve | `10.0.16.32` | Proxmox VE 9.1.1 hypervisor | `root` (password auth) |
| union | `10.0.16.8` | VM on pve (VMID 100), Ubuntu 24.04 | `gadget` |

**Note on PVE RAM:** Proxmox reports ~84% RAM used. This is expected — KVM pre-commits
the full 26 GB allocated to union on VM start. `MemAvailable` on the host is ~5 GB and
swap usage is 0, so there is no actual memory pressure.

### Proxmox API token (for NOLA dashboard)

Token: `root@pam!nola`  
Created: 2026-04-13  
Permissions: inherits root (privsep=0)  
Secret stored in: `~/apps/nola-dashboard/.env` on containy as `PVE_API_TOKEN`

To regenerate if lost:
```bash
# Auth with password to get a ticket
TICKET=$(curl -sk -X POST https://10.0.16.32:8006/api2/json/access/ticket \
  -d "username=root@pam&password=<password>" | python3 -c \
  "import json,sys; print(json.load(sys.stdin)['data']['ticket'])")
CSRF=$(curl -sk -X POST https://10.0.16.32:8006/api2/json/access/ticket \
  -d "username=root@pam&password=<password>" | python3 -c \
  "import json,sys; print(json.load(sys.stdin)['data']['CSRFPreventionToken'])")

# Delete old token (if it exists)
curl -sk -X DELETE "https://10.0.16.32:8006/api2/json/access/users/root@pam/token/nola" \
  -H "CSRFPreventionToken: $CSRF" -b "PVEAuthCookie=$TICKET"

# Create new token
curl -sk -X POST "https://10.0.16.32:8006/api2/json/access/users/root@pam/token/nola" \
  -H "CSRFPreventionToken: $CSRF" -b "PVEAuthCookie=$TICKET" \
  -d "comment=NOLA dashboard monitoring&privsep=0"
# → copy the "value" field from the response → update PVE_API_TOKEN in containy .env
```

### node_exporter on pve and union

Both hosts run node_exporter as a systemd service (installed 2026-04-13).

```bash
# Check status
systemctl is-active node_exporter
curl -s localhost:9100/metrics | head -3

# Install from scratch (linux/amd64)
NE_VER=1.8.2
curl -fsSL https://github.com/prometheus/node_exporter/releases/download/v${NE_VER}/node_exporter-${NE_VER}.linux-amd64.tar.gz | tar xz
sudo mv node_exporter-${NE_VER}.linux-amd64/node_exporter /usr/local/bin/
sudo useradd -rs /bin/false node_exporter 2>/dev/null || true
sudo tee /etc/systemd/system/node_exporter.service > /dev/null <<'EOF'
[Unit]
Description=Prometheus Node Exporter
After=network.target
[Service]
User=node_exporter
ExecStart=/usr/local/bin/node_exporter
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now node_exporter
```

### Prometheus scrape config

File: `/home/gadget/proxy-setup/prometheus/prometheus.yml` on containy (`10.0.11.11`)

pve and union entries in the `node` job:
```yaml
- targets: ['10.0.16.8:9100']
  labels:
    instance: union
    host: union
- targets: ['10.0.16.32:9100']
  labels:
    instance: pve
    host: pve
```

Reload after editing:
```bash
ssh gadget@10.0.11.11 "docker kill -s SIGHUP containy-prometheus"
# auto-reloads every 30s anyway; verify at http://10.0.11.69:9090/targets
```

---

## Key Service URLs

| Service | URL | Notes |
|---------|-----|-------|
| **NOLA Dashboard** | **https://nola.galaxy.rip** | **This dashboard** |
| n8n | http://n8n.galaxy.rip | Workflow automation |
| Grafana | https://grafana.galaxy.rip | Dashboards & alerts |
| LibreNMS | https://librenms.galaxy.rip | Network monitoring |
| Authentik | https://auth.galaxy.rip | SSO / identity |
| Portainer (containy) | https://containy.galaxy.rip | Container management |
| Portainer (knox) | https://knox.galaxy.rip | Container management |
| aivault | https://aivault.galaxy.rip | AI credentials vault |
| Personal vault | https://vault.galaxy.rip | Personal credentials |
| ntopng (fort) | http://10.0.16.100:3005 | Flow analysis |
| OPNsense (stop) | https://10.0.16.100:5223 | Fort firewall API |
| OPNsense (halt) | https://10.0.11.100:5223 | Hawk firewall API |
| Proxmox | https://10.0.16.32:8006 | Hypervisor UI (root@pam) |
