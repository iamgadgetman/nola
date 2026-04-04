<p align="center">
  <img src="nola_icon.png" width="120" alt="N.O.L.A." />
</p>

<h1 align="center">N.O.L.A.</h1>
<h3 align="center">Non-Organic Lab Assistant</h3>

<p align="center">
  A self-hosted homelab AI butler powered by n8n, Claude, and Discord.<br/>
  Monitors your infrastructure, answers questions in plain English, and calls your phone when things go wrong.
</p>

---

## What it does

- **Chat in Discord** — ask NOLA anything about your homelab, get real answers
- **Monitors infrastructure** — Netdata metrics, UPS status, Prometheus queries
- **Proactive alerts** — posts to Discord when thresholds are exceeded; calls your phone for critical events
- **Runs commands** — SSH to whitelisted hosts with a safety filter on destructive operations
- **Weekly digest** — Monday morning health summary posted to Discord
- **Voice calls** — optional VAPI + ElevenLabs integration for phone alerts and voice queries
- **LibreNMS relay** — forwards SNMP alerts to Discord

## Architecture

```
Discord ──► nola-bot ──► n8n webhook ──► NOLA AI Agent (Claude)
                                               │
                         ┌─────────────────────┼──────────────────────┐
                         ▼                     ▼                      ▼
                  get_ups_status      get_netdata_metrics      query_prometheus
                  post_to_discord         run_command

Phone ──► VAPI ──► n8n webhook ──► vapi-tool-handler (same tools, voice-optimized)

Schedule ──► proactive-monitor ──► Discord alerts ──► VAPI phone call (if critical)
Schedule ──► weekly-digest ──► Discord
LibreNMS ──► n8n webhook ──► Discord
```

## Stack

| Component | Purpose |
|---|---|
| [n8n](https://n8n.io) | Workflow orchestration, AI agent, webhooks |
| [Claude](https://anthropic.com) | The brain — Anthropic Sonnet via n8n |
| Discord bot | Bridge between Discord and n8n |
| Netdata | Per-host system metrics |
| Prometheus | PromQL metric queries |
| apcupsd | UPS status via TCP |
| [VAPI](https://vapi.ai) *(optional)* | Phone call interface |
| [ElevenLabs](https://elevenlabs.io) *(optional)* | Voice synthesis |

## Quick start

```bash
git clone https://github.com/iamgadgetman/nola.git
cd nola
cp .env.example .env
# Edit .env with your keys
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d
```

Then follow [SETUP.md](SETUP.md) to import the n8n workflows and connect Discord.

## Workflows

| File | Purpose |
|---|---|
| `workflows/nola-main-workflow.json` | Main AI agent — import first |
| `workflows/tool-run-command.json` | SSH tool sub-workflow |
| `workflows/librenms-alert.json` | LibreNMS → Discord alert relay |
| `workflows/proactive-monitor.json` | 5-minute health monitor + phone alerts |
| `workflows/weekly-digest.json` | Monday morning health digest |
| `integrations/vapi-tool-handler.json` | Voice call tool handler (optional) |

## Integrations

### VAPI voice calls *(optional)*

NOLA can answer your phone. The `integrations/vapi-tool-handler.json` workflow handles inbound tool calls from a VAPI voice assistant — same tools as the Discord agent, but with voice-friendly output.

See [integrations/VAPI.md](integrations/VAPI.md) for setup instructions.

## Environment variables

All configuration is done via `.env`. See [`.env.example`](.env.example) for the full list with descriptions.

## Name

NOLA is named for **Nola**, after the 1918 piano piece *Nola* by Felix Arndt. The silhouette in the icon is from that original sheet music cover.

---

<p align="center"><sub>Built with n8n · Claude · Discord · love</sub></p>
