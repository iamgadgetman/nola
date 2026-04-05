# Ollama Integration

Local LLM inference for NOLA's proactive monitor and weekly digest.  
Two instances — one per site — reachable from the VPS via WireGuard.

| Host | IP | Network | Reaches via |
|------|----|---------|-------------|
| containy.galaxy | 10.0.11.25 | 11_Net / Hawk DMZ | wg0 |
| knox.universe | 10.0.18.25 | 18_Net / Fort DMZ | wg1 |

Model: `llama3.2:3b` — ~2GB RAM, CPU-only (Intel iGPU not supported by Ollama)

---

## Deploy

### 1. Verify parent interface on each host

```bash
ssh gadget@10.0.11.11 'ip link | grep -E "^[0-9]+:" | grep -v lo'
ssh gadget@10.0.18.18 'ip link | grep -E "^[0-9]+:" | grep -v lo'
```

Update `parent:` in each compose file if it's not `eno1`.

### 2. Start Ollama on containy

```bash
scp deploy/containy/docker-compose.ollama.yml gadget@10.0.11.11:~/
ssh gadget@10.0.11.11 'docker compose -f docker-compose.ollama.yml up -d'
```

### 3. Start Ollama on knox

```bash
scp deploy/knox/docker-compose.ollama.yml gadget@10.0.18.18:~/
ssh gadget@10.0.18.18 'docker compose -f docker-compose.ollama.yml up -d'
```

### 4. Pull the model on both hosts

```bash
ssh gadget@10.0.11.11 'docker exec ollama ollama pull llama3.2:3b'
ssh gadget@10.0.18.18 'docker exec ollama ollama pull llama3.2:3b'
```

First pull is ~2GB — takes a few minutes. Subsequent starts load from disk.

### 5. Verify reachability from VPS

```bash
curl http://10.0.11.25:11434/api/tags
curl http://10.0.18.25:11434/api/tags
```

Both should return JSON listing `llama3.2:3b`.

### 6. Add env vars to `.env` on the VPS

```
OLLAMA_URL_CONTAINY=http://10.0.11.25:11434
OLLAMA_URL_KNOX=http://10.0.18.25:11434
OLLAMA_MODEL=llama3.2:3b
```

Restart n8n to pick them up:
```bash
docker compose restart n8n
```

### 7. Re-import updated workflows in n8n

Re-import (replacing existing):
- `workflows/proactive-monitor.json`
- `workflows/weekly-digest.json`

Activate both after import.

---

## What changed in the workflows

### proactive-monitor
New node **Summarize with Ollama** inserted after "Any Alerts?" — calls containy's Ollama to produce a 1-2 sentence summary. The raw alert list is still posted; the AI summary appears below it as a `💬` line. If Ollama times out or is unreachable, the raw alerts post as before.

Also fixed a latent bug: "Is Critical?" now reads `isCritical` from the Ollama node output directly (via `$('Summarize with Ollama')`) rather than from the HTTP response of the Discord post.

### weekly-digest
New node **Narrate with Ollama** inserted after "Build Health Digest" — calls knox's Ollama to write a short narrative paragraph. Appended to the digest as `💬 **NOLA's Take:**`. Falls back to raw digest if Ollama is unavailable. Timeout is 45s (generation is longer here).

---

## Changing the model

To try a different model (e.g. `mistral:7b` if RAM allows):

```bash
# Pull on both hosts
ssh gadget@10.0.11.11 'docker exec ollama ollama pull mistral:7b'
ssh gadget@10.0.18.18 'docker exec ollama ollama pull mistral:7b'
```

Then update `OLLAMA_MODEL=mistral:7b` in `.env` and restart n8n.

## RAM guidance

| Model | RAM | Notes |
|-------|-----|-------|
| llama3.2:3b | ~2.0 GB | Recommended — fast on CPU |
| llama3.2:8b | ~5.0 GB | Better quality, noticeably slower |
| mistral:7b | ~4.5 GB | Good balance if RAM allows |
