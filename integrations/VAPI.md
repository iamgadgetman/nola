# VAPI Voice Integration

<img src="../nola_icon.png" width="60" align="right" alt="N.O.L.A." />

This optional integration lets you talk to NOLA by phone. Call a number, ask about your homelab, get voice responses. NOLA can also call *you* when something critical happens.

---

## How it works

```
You call ──► VAPI phone number ──► VAPI assistant (Claude model)
                                        │  tool calls
                                        ▼
                               n8n /webhook/nola-vapi-tool
                                        │
                           (same tools as Discord agent)
                                        │
                               response back to VAPI ──► voice ──► your ear
```

Outbound alerts are triggered by the `proactive-monitor` workflow when `isCritical` is true.

---

## Prerequisites

- A [VAPI](https://vapi.ai) account
- An [ElevenLabs](https://elevenlabs.io) account (for voice synthesis)
- n8n reachable at a public HTTPS URL

---

## Step 1 — Import the workflow

In n8n: **Workflows → Import from file → `integrations/vapi-tool-handler.json`**

Activate it. The webhook path will be: `{N8N_WEBHOOK_BASE_URL}/webhook/nola-vapi-tool`

---

## Step 2 — Create a VAPI assistant

```bash
curl -X POST https://api.vapi.ai/assistant \
  -H "Authorization: Bearer YOUR_VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "nola",
    "model": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "systemPrompt": "You are NOLA, an AI assistant managing a homelab. Give concise, voice-friendly answers. No markdown, no bullet points, no asterisks. Speak naturally.",
      "temperature": 0.3
    },
    "voice": {
      "provider": "11labs",
      "voiceId": "YOUR_ELEVENLABS_VOICE_ID"
    },
    "firstMessage": "This is NOLA. How can I help with the homelab?",
    "serverUrl": "https://n8n.yourdomain.com/webhook/nola-vapi-tool",
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_ups_status",
          "description": "Get UPS battery level, load, runtime remaining, and whether on battery or utility power.",
          "parameters": { "type": "object", "properties": {} }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "get_netdata_metrics",
          "description": "Get CPU, RAM, and uptime for a specific host.",
          "parameters": {
            "type": "object",
            "properties": {
              "host": { "type": "string", "description": "Host name, e.g. server1" }
            },
            "required": ["host"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "query_prometheus",
          "description": "Run a PromQL query to get metrics.",
          "parameters": {
            "type": "object",
            "properties": {
              "query": { "type": "string", "description": "PromQL expression" }
            },
            "required": ["query"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "run_command",
          "description": "Run a shell command on an allowed host via SSH.",
          "parameters": {
            "type": "object",
            "properties": {
              "host":    { "type": "string", "description": "Target host label" },
              "command": { "type": "string", "description": "Shell command to run" }
            },
            "required": ["host", "command"]
          }
        }
      }
    ]
  }'
```

Note the `id` returned — that's your `VAPI_ASSISTANT_ID`.

---

## Step 3 — Get a phone number

In the VAPI dashboard, provision a phone number and assign it to your assistant. Note the `VAPI_PHONE_NUMBER_ID`.

---

## Step 4 — Configure .env

```
VAPI_API_KEY=your_vapi_api_key
VAPI_ASSISTANT_ID=your_assistant_id
VAPI_PHONE_NUMBER_ID=your_phone_number_id
ALERT_PHONE_NUMBER=+15555555555
```

---

## Step 5 — Enable outbound alerts

The `proactive-monitor` workflow will call `ALERT_PHONE_NUMBER` automatically when `isCritical` is true (UPS on battery, host unreachable, etc.).

Make sure `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, and `ALERT_PHONE_NUMBER` are all set and n8n has been restarted to pick them up.

---

## Optional: AMP game server control

If you run game servers via [AMP (CubeCoders)](https://cubecoders.com/AMP), add these to `.env`:

```
AMP_HOST=10.0.0.x
AMP_PORT=8080
AMP_USER=admin
AMP_PASSWORD=your_amp_password
```

NOLA will be able to start, stop, and check the status of game servers by voice.

---

## Tip — voice-friendly output

VAPI responses must be plain speech. The tool handler already formats output without markdown. If you add custom tools, follow the same pattern: full sentences, no symbols, numbers spelled naturally where needed.

VAPI requires tool call responses within ~20 seconds. All tool branches in the handler run in parallel via `Promise.all`.
