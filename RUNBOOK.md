# NOLA Operations Runbook
_Last updated: 2026-04-05_

Quick reference for common failure scenarios across NOLA, netflow, WireGuard, and Grafana.

---

## Table of Contents
1. [NOLA Stack — Common Issues](#1-nola-stack--common-issues)
2. [Grafana / Prometheus Alerts](#2-grafana--prometheus-alerts)
3. [Netflow / ntopng](#3-netflow--ntopng)
4. [WireGuard](#4-wireguard)
5. [OPNsense / Firewall](#5-opnsense--firewall)
6. [General Docker / Service Recovery](#6-general-docker--service-recovery)

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

## Key Service URLs

| Service | URL | Notes |
|---------|-----|-------|
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
