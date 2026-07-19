# Add holodeck to the cAdvisor scrape job

The dashboard already reads `job="cadvisor"` from Prometheus and groups containers
by host — it just needs holodeck as a target.

> ⚠️ **Not port 8080 on holodeck.** AMP's web panel already owns 8080 there, so
> cAdvisor runs on **8081** (`CADVISOR_PORT` in generate.sh). Scraping 8080 would
> hit AMP and return HTML, not metrics.

On the Prometheus host (10.0.5.42), find the existing `cadvisor` job in
`prometheus.yml` and add holodeck to it:

```yaml
  - job_name: cadvisor
    static_configs:
      - targets:
          - union:8080          # ...your existing targets (their own ports)...
          - holodeck.fort.example.com:8081   # <-- add this (8081, not 8080)
```

Then reload:

```bash
curl -X POST http://10.0.5.42:9090/-/reload
```

`generate.sh` already includes the cAdvisor container in the holodeck compose, so
once it's running and this target is added, the **Holodeck Containers** card on the
Game Servers tab populates within ~15s.

Verify:

```bash
curl -sG 'http://10.0.5.42:9090/api/v1/query' \
  --data-urlencode 'query=count by (instance)(container_last_seen{job="cadvisor"})' | jq
```
