# Add holodeck to the cAdvisor scrape job

The dashboard already reads `job="cadvisor"` from Prometheus and groups containers
by host — it just needs holodeck as a target. On the Prometheus host (10.0.5.42),
find the existing `cadvisor` job in `prometheus.yml` and add holodeck to it:

```yaml
  - job_name: cadvisor
    static_configs:
      - targets:
          - union:8080          # ...your existing targets...
          - holodeck.fort.galaxy.rip:8080   # <-- add this
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
