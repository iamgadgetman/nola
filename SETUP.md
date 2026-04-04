# N.O.L.A. Setup Guide

Non-Organic Lab Assistant — homelab AI butler powered by n8n + Claude + Discord.

---

## Prerequisites

- Docker + Docker Compose v2
- A Discord bot token with **Message Content Intent** enabled
- An Anthropic API key
- (Optional) A VAPI account for phone call alerts

---

## Step 1 — Clone and configure

```bash
git clone https://github.com/iamgadgetman/nola.git
cd nola
cp .env.example .env
```

Edit `.env` and fill in every value. The required ones to get started:

| Variable | Where to get it |
|---|---|
| `POSTGRES_PASSWORD` | Make up a strong password |
| `N8N_ENCRYPTION_KEY` | Run `openssl rand -hex 32` |
| `N8N_WEBHOOK_BASE_URL` | The public URL your n8n will be reachable at |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `DISCORD_TOKEN` | discord.com/developers → your app → Bot |
| `DISCORD_CHANNEL_ID` | Right-click channel in Discord (Developer Mode) → Copy Channel ID |
| `DISCORD_WEBHOOK_URL` | Discord channel → Edit → Integrations → Webhooks |
| `N8N_WEBHOOK_URL` | `http://n8n:5678/webhook/nola` (keep as-is for Docker) |

---

## Step 2 — Start the stack

```bash
# Basic stack (n8n + postgres + Discord bot)
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d

# With local AI models (adds Ollama + Qdrant)
docker compose -f docker-compose.yml -f docker-compose.override.yml --profile local-ai up -d
```

Open n8n at `http://localhost:5678` (or your configured host) and create an account.

---

## Step 3 — Add your Anthropic credentials in n8n

1. Go to **Settings → Credentials → New**
2. Search for **Anthropic**
3. Enter your `ANTHROPIC_API_KEY`
4. Save as `Anthropic account` (must match this name exactly)

---

## Step 4 — Import workflows

Import in this order — the main workflow depends on the tool sub-workflow.

### 4a. Import the run_command sub-workflow

1. In n8n, go to **Workflows → Import from file**
2. Select `workflows/tool-run-command.json`
3. Save and **note the workflow ID** (visible in the URL: `/workflow/XXXXXXXX`)

### 4b. Set WORKFLOW_ID_RUN_COMMAND

Add this to your `.env`:
```
WORKFLOW_ID_RUN_COMMAND=<the ID from step 4a>
```

Then restart n8n to pick up the new env var:
```bash
docker compose restart n8n
```

### 4c. Import the main workflow

1. Import `workflows/nola-main-workflow.json`
2. Open it, verify the Claude credential is linked
3. **Activate** the workflow (toggle at the top right)

### 4d. Import alert/monitor workflows (optional)

Import any of these depending on what you want:

| File | Purpose |
|---|---|
| `workflows/librenms-alert.json` | Relay LibreNMS SNMP alerts to Discord |
| `workflows/proactive-monitor.json` | Poll Netdata every 5 min, alert on thresholds + call phone if critical |
| `workflows/weekly-digest.json` | Post a health summary to Discord every Monday 6 AM |

Activate each one after importing.

---

## Step 5 — Enable the Discord bot

The `nola-bot` container starts automatically with the stack. Verify it's running:

```bash
docker compose logs nola-bot
```

You should see: `nola Discord bridge ready as <your bot name>`

Send a message in your configured Discord channel — NOLA should respond within a few seconds.

---

## Infrastructure configuration

### Adding Netdata hosts

In `.env`, set `NETDATA_HOSTS` as a comma-separated list of `name:url` pairs:

```
NETDATA_HOSTS=server1:http://10.0.0.1:19999,server2:http://10.0.0.2:19999
```

### Enabling UPS monitoring

Set `UPS_HOST` and `UPS_PORT` to your apcupsd host:

```
UPS_HOST=10.0.0.1
UPS_PORT=3551
```

### Enabling SSH run_command

For each host NOLA should be allowed to SSH into, add:

```
SSH_ALLOWED_HOSTS=server1,server2
SSH_HOST_SERVER1=10.0.0.1
SSH_USER_SERVER1=admin
SSH_KEY_SERVER1=/run/secrets/ssh_key_server1
```

Mount your SSH private key as a Docker secret or bind mount, then reference the path in `SSH_KEY_<HOST>`.

---

## VAPI voice calls (optional)

To enable phone alerts on critical events:

1. Create a VAPI account at vapi.ai
2. Create a phone number and an assistant
3. Point the assistant's **Server URL** to: `{N8N_WEBHOOK_BASE_URL}/webhook/nola-vapi-tool`
4. Fill in `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID`, and `ALERT_PHONE_NUMBER` in `.env`
5. Activate the `proactive-monitor` workflow

---

## Troubleshooting

**NOLA doesn't respond in Discord**
- Check `docker compose logs nola-bot` for errors
- Verify `DISCORD_TOKEN`, `DISCORD_CHANNEL_ID`, and `N8N_WEBHOOK_URL` are set
- Make sure the nola-main-workflow is **activated** in n8n
- Confirm the bot has Message Content Intent enabled in the Discord Developer Portal

**n8n webhook not reachable**
- Make sure `N8N_WEBHOOK_BASE_URL` is the public URL, not `localhost`, if running remotely
- Check that port 5678 is accessible (or reverse proxy is configured)

**Claude errors in n8n**
- Verify the `Anthropic account` credential is saved with that exact name
- Check that `NOLA_MODEL` matches a valid Claude model ID

**run_command fails with "host not in SSH_ALLOWED_HOSTS"**
- Make sure the host label in `SSH_ALLOWED_HOSTS` matches exactly (case-insensitive) what you pass to the tool
