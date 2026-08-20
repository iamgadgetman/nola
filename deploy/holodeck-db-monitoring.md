# Holodeck DB & Container Monitoring — Implementation Plan

Goal: surface **container performance** and **MariaDB/MySQL database performance** for
`holodeck.fort.example.com` inside the NOLA phone app, on the **Game Servers** tab.

Data path (matches everything else in NOLA):

```
holodeck ──(cAdvisor / mysqld_exporter)──► Prometheus (10.0.6.42:9090)
                                              │
                            dashboard/server.js  /api/data
                                              │
                                    mobile app  Game Servers tab
```

**Status:** the container UI (`useContainers` + `ContainerSection`) **and** the
database backend + UI (Parts 2–3 below) are **already built and committed**. All
that remains on the holodeck side is deploying the exporters (Parts 0 and 1) —
the app lights up automatically once Prometheus is scraping them.

> **Ready-to-run bundle:** [`deploy/holodeck/`](holodeck/) packages Parts 0–1 as
> drop-in files — a `generate.sh` that emits the holodeck compose (cAdvisor + one
> mysqld_exporter per DB) and Prometheus targets from a simple `databases.list`,
> plus the monitoring-user SQL and scrape-job snippets. Start there; the sections
> below are the underlying theory/reference.

---

## Part 0 — cAdvisor on holodeck (prerequisite for the container view)

`server.js → fetchContainers()` already reads cAdvisor from Prometheus and groups
`by_host`. The phone view filters that map to the `holodeck` host. It shows data
only if holodeck is actually scraped. The web dashboard's host list
(`union, eagle, falcon, talon`) does **not** include holodeck, so this is probably
not yet in place.

**1. Confirm current state** (run on any box that can reach Prometheus):

```bash
# Is holodeck reporting containers?
curl -sG 'http://10.0.6.42:9090/api/v1/query' \
  --data-urlencode 'query=count by (instance)(container_last_seen{job="cadvisor"})' | jq
```

If holodeck isn't listed, add cAdvisor on holodeck:

> ⚠️ **Port conflict:** AMP's web panel owns **8080** on holodeck, so cAdvisor
> must use a different host port — **8081** below. Binding cAdvisor to 8080 there
> either fails to start (port in use) or makes Prometheus scrape AMP's HTML.

**2. Run cAdvisor** (`/opt/monitoring/docker-compose.yml` on holodeck):

```yaml
services:
  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.49.1
    container_name: cadvisor
    restart: unless-stopped
    privileged: true
    environment:
      - DOCKER_API_VERSION=1.40   # Docker 29+ rejects cAdvisor's default 1.24 client
    ports:
      - "8081:8080"          # host 8081 (NOT 8080 — AMP owns it on holodeck)
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
    devices:
      - /dev/kmsg
```

**3. Add a scrape target** to Prometheus (`prometheus.yml` on 10.0.6.42), matching
the existing `job="cadvisor"` so no server.js change is needed:

```yaml
  - job_name: cadvisor
    static_configs:
      - targets:
          - holodeck.fort.example.com:8081   # add holodeck (8081, not 8080)
```

`docker compose up -d cadvisor` on holodeck, then reload Prometheus
(`curl -X POST http://10.0.6.42:9090/-/reload` or SIGHUP). The **Holodeck
Containers** section on the Game Servers tab should populate within ~15s.

> Note on the host label: `by_host` is keyed on Prometheus's `instance` label.
> `ContainerSection` matches it by substring `holodeck`, so `holodeck:8081`,
> `holodeck.fort.example.com:8081`, or an FQDN all work. If you scrape it by raw
> IP, either give the target a hostname or change `hostMatch` in
> `mobile/src/screens/AMPScreen.js`.

---

## Part 1 — mysqld_exporter on holodeck

One exporter can monitor one MariaDB server. If holodeck runs **multiple** DB
containers (common with many game servers), run one exporter per DB, or use the
exporter's multi-target mode. Start with the shared/primary MariaDB.

**1. Create a read-only monitoring user** (MariaDB syntax; `SLAVE MONITOR` is the
MariaDB name for MySQL's `REPLICATION CLIENT`):

```sql
CREATE USER 'nola_exporter'@'%' IDENTIFIED BY 'CHANGE_ME_STRONG'
  WITH MAX_USER_CONNECTIONS 3;
GRANT PROCESS, SLAVE MONITOR, REPLICATION CLIENT, SELECT ON *.* TO 'nola_exporter'@'%';
FLUSH PRIVILEGES;
```

**2. Exporter config** — `/opt/monitoring/mysqld_exporter.cnf` (mode 600):

```ini
[client]
user = nola_exporter
password = CHANGE_ME_STRONG
host = 127.0.0.1        # or the MariaDB container's service name on the shared network
port = 3306
```

**3. Add to holodeck's monitoring compose:**

```yaml
  mysqld-exporter:
    image: prom/mysqld-exporter:v0.15.1
    container_name: mysqld-exporter
    restart: unless-stopped
    command:
      - "--config.my-cnf=/cfg/my.cnf"
      - "--collect.info_schema.tablesize"      # per-database size (optional, small cost)
      - "--collect.global_status"
      - "--collect.global_variables"
      - "--collect.info_schema.innodb_metrics"
    volumes:
      - /opt/monitoring/mysqld_exporter.cnf:/cfg/my.cnf:ro
    ports:
      - "9104:9104"
    # If MariaDB runs as a container, put both on the same docker network and set
    # host = <mariadb-container-name> in the .cnf instead of 127.0.0.1.
```

**4. Prometheus scrape job** (`prometheus.yml`):

```yaml
  - job_name: mysql
    static_configs:
      - targets: ['holodeck.fort.example.com:9104']
        labels:
          server: holodeck          # friendly label surfaced in the app
```

Reload Prometheus. Verify:

```bash
curl -sG 'http://10.0.6.42:9090/api/v1/query' \
  --data-urlencode 'query=mysql_up{job="mysql"}' | jq '.data.result'
```

---

## Part 2 — Backend: `fetchDatabases()` in `dashboard/server.js`  ✅ BUILT

Implemented alongside `fetchContainers()` / `fetchUps()`, keyed by the Prometheus
`instance` label so multiple DB targets each get a row, and wired into `/api/data`
as `databases` (with `errors.databases`). Friendly names come from the optional
`DB_FRIENDLY_NAMES` env var (see `dashboard/.env.example`). Reference implementation:

```js
// Optional friendly names, e.g. "holodeck.fort.example.com:9104=Holodeck MariaDB"
const DB_NAMES = Object.fromEntries(
  (process.env.DB_FRIENDLY_NAMES || '').split(',').filter(Boolean)
    .map(p => p.split('=').map(s => s.trim()))
);

async function fetchDatabases() {
  const [up, uptime, connected, maxConn, running, queries, slow, aborted, bpReads, bpReq] =
    await Promise.all([
      promQuery('mysql_up{job="mysql"}'),
      promQuery('mysql_global_status_uptime{job="mysql"}'),
      promQuery('mysql_global_status_threads_connected{job="mysql"}'),
      promQuery('mysql_global_variables_max_connections{job="mysql"}'),
      promQuery('mysql_global_status_threads_running{job="mysql"}'),
      promQuery('rate(mysql_global_status_queries{job="mysql"}[5m])'),
      promQuery('rate(mysql_global_status_slow_queries{job="mysql"}[5m])'),
      promQuery('rate(mysql_global_status_aborted_connects{job="mysql"}[5m])'),
      promQuery('rate(mysql_global_status_innodb_buffer_pool_reads{job="mysql"}[5m])'),
      promQuery('rate(mysql_global_status_innodb_buffer_pool_read_requests{job="mysql"}[5m])'),
    ]);

  if (!up?.length) return null;

  const round1 = v => (v != null ? Math.round(v * 10) / 10 : null);
  const byInst = (results) => {
    const m = {};
    for (const r of (results || [])) m[r.metric.instance] = parseFloat(r.value[1]);
    return m;
  };
  const uptM = byInst(uptime), conM = byInst(connected), maxM = byInst(maxConn),
        runM = byInst(running), qM = byInst(queries), slowM = byInst(slow),
        abM = byInst(aborted), bprM = byInst(bpReads), bpqM = byInst(bpReq);

  return up.map(r => {
    const inst   = r.metric.instance;
    const name   = DB_NAMES[inst] || r.metric.server || inst.split(':')[0];
    const reads  = bprM[inst], req = bpqM[inst];
    // buffer-pool hit ratio: 1 - disk_reads / logical_read_requests
    const hitPct = (req && req > 0) ? round1((1 - reads / req) * 100) : null;
    const conn   = conM[inst], max = maxM[inst];
    return {
      name,
      instance:      inst,
      up:            r.value[1] === '1',
      uptime:        fmtUptime(uptM[inst]),
      connections:   conn != null ? Math.round(conn) : null,
      max_conn:      max  != null ? Math.round(max)  : null,
      conn_pct:      (conn != null && max) ? round1((conn / max) * 100) : null,
      threads_running: runM[inst] != null ? Math.round(runM[inst]) : null,
      qps:           round1(qM[inst]),
      slow_qps:      round1(slowM[inst]),
      aborted_qps:   round1(abM[inst]),
      buffer_hit_pct: hitPct,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
```

Wire it into `/api/data` next to the others:

```js
// in app.get('/api/data'): add fetchDatabases() to Promise.allSettled
const dbResult = /* ... */;
const databases = dbResult.status === 'fulfilled' ? dbResult.value : null;
res.json({ /* ...existing... */, databases,
  errors: { /* ...existing... */, databases: databases ? null : 'unavailable' } });
```

Optionally feed it into `buildLabContext()` so NOLA can answer DB questions in chat.

---

## Part 3 — Mobile: Databases section  ✅ BUILT

Implemented on the **Game Servers** tab, below the containers:

- **`mobile/src/hooks/useDatabases.js`** — reads `data.databases`, 10s refresh.
- **`mobile/src/components/DatabaseSection.js`** — one card per DB:
  - status dot + name + uptime
  - **Connections** bar (`conn_pct`, warn ≥70 / crit ≥90)
  - **Queries/s**, **Slow/s** (amber when > 0), **Cache hit %**
    (green ≥99 / amber ≥95 / red below), **Threads running**
- **`AMPScreen.js`** renders it in `ListFooterComponent` and includes
  `databases.refresh()` in `refreshAll` / pull-to-refresh.

---

## Part 4 — Verification

1. `curl .../api/v1/query?query=mysql_up{job="mysql"}` → `1`.
2. `curl http://<dashboard>/api/data | jq '.databases, .containers.by_host | keys'`
   → holodeck present in both.
3. Phone → Game Servers tab → **Holodeck Containers** and **Databases** sections
   render below the AMP instances, refreshing every 10s.

## Optional hardening
- Bind cAdvisor / exporter ports to the lab-facing interface only (not 0.0.0.0).
- Add Grafana alert rules: `mysql_up == 0`, `conn_pct > 90`, `buffer_hit_pct < 95`.
- If holodeck has several MariaDB instances, add one exporter + target per DB;
  the backend already keys by `instance`, so they appear as separate rows.
```
