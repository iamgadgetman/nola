# Holodeck exporter deploy

Ready-to-run bundle that makes the **Holodeck Containers** and **Databases** cards
on the Game Servers tab show live data. Work happens in three places:

| Where | What runs there |
|-------|-----------------|
| **Each DB server** | create the read-only `nola_exporter` user (`sql/`) |
| **holodeck** | cAdvisor + one mysqld_exporter per DB (generated compose) |
| **Prometheus host** (10.0.6.42) | one cAdvisor target + one `mysql` scrape job |

Background/theory: [../holodeck-db-monitoring.md](../holodeck-db-monitoring.md).

---

## 1. On each MariaDB/MySQL server — create the monitoring user

Pick one strong password and use it for every server.

```bash
mysql -u root -p < sql/nola-exporter-user.sql   # edit the password first
```

## 2. On holodeck — generate and start the stack

```bash
cd deploy/holodeck
cp .env.example .env                 # set DB_MON_USER / DB_MON_PASS (same password as step 1)
vi databases.list                    # list your DBs (one line each; see the file's header)
./generate.sh                        # writes docker-compose.generated.yml + targets json
docker compose -f docker-compose.generated.yml up -d
```

`databases.list` format is `Friendly Name | mysql_address:port | exporter_port`.
The `mysql_address` must be reachable **from the exporter container**:

- DB **published on the holodeck host** → `host.docker.internal:<port>` (the compose
  already maps `host.docker.internal` to the host gateway)
- DB **container on a shared docker network** → use its container name, and attach
  the exporter to that network (add a `networks:` block)
- otherwise a **LAN IP**

One MariaDB server with many schemas? Use a **single line** — one exporter reports
every schema.

Check an exporter locally on holodeck:

```bash
curl -s localhost:9104/metrics | grep -m1 mysql_up   # -> mysql_up 1
```

## 3. On the Prometheus host (10.0.6.42)

**Databases** — file-based targets so you never edit `prometheus.yml` again:

```bash
mkdir -p /etc/prometheus/holodeck
scp holodeck:.../deploy/holodeck/prometheus/mysql-targets.generated.json \
    /etc/prometheus/holodeck/mysql-targets.json
# add the job from prometheus/mysql-job.yml to scrape_configs:
curl -X POST http://10.0.6.42:9090/-/reload
```

**Containers** — add holodeck to the existing cAdvisor job:
see [prometheus/cadvisor-target.md](prometheus/cadvisor-target.md).

## 3b. (Optional) Grafana alert rules

Provision four Grafana-managed alerts for the DBs — down, connection saturation,
low buffer-pool hit ratio, and slow queries. Being Grafana-managed, they show up
in Grafana **and** in the app's Alerts tab (Network) when firing.

```bash
cd grafana
./gen-alerts.sh                 # auto-finds the Prometheus datasource UID via the
                                # dashboard .env, or: ./gen-alerts.sh <uid>
cp alerting/nola-mysql-alerts.generated.yaml \
   /etc/grafana/provisioning/alerting/nola-mysql-alerts.yaml   # on the Grafana host
systemctl restart grafana-server
```

Requires Grafana 9+. Rules land in a `NOLA` folder and fire once per DB, carrying
that DB's `server`/`instance` labels. See [grafana/](grafana/).

## 4. Verify

```bash
# Prometheus sees the DBs (expect one series per DB, value 1):
curl -sG 'http://10.0.6.42:9090/api/v1/query' \
  --data-urlencode 'query=mysql_up{job="mysql"}' | jq '.data.result[] | {server:.metric.server, up:.value[1]}'

# The dashboard exposes them:
curl -s http://<dashboard>/api/data | jq '.databases, (.containers.by_host | keys)'
```

Then open the app → **Game Servers**: Holodeck Containers and Databases populate,
refreshing every 10s.

## Adding a database later

Add a line to `databases.list`, re-run `./generate.sh`, `docker compose ... up -d`,
copy the refreshed targets json to the Prometheus host. No app or `prometheus.yml`
change needed.

## Files

```
sql/nola-exporter-user.sql          run on each DB server
.env.example                        -> .env  (credentials; gitignored)
databases.list                      your DB inventory (edit)
generate.sh                         emits the two *.generated.* files below
docker-compose.generated.yml        (generated) runs on holodeck
prometheus/mysql-job.yml            scrape job snippet for prometheus.yml
prometheus/mysql-targets.generated.json  (generated) -> Prometheus host
prometheus/cadvisor-target.md       how to add holodeck to the cadvisor job
grafana/gen-alerts.sh               fills the datasource UID into the alert rules
grafana/alerting/nola-mysql-alerts.yaml  alert-rule template (4 rules)
```
