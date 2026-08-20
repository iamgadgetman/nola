require('dotenv').config();
const express = require('express');
const path    = require('path');
const https   = require('https');
const fsp     = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://10.0.6.42:9090';
const GRAFANA_URL    = process.env.GRAFANA_URL    || 'http://10.0.6.31:3000';
const GRAFANA_TOKEN  = process.env.GRAFANA_TOKEN  || '';
const LIBRENMS_URL   = process.env.LIBRENMS_URL   || 'http://10.0.7.97:8000';
const LIBRENMS_TOKEN = process.env.LIBRENMS_TOKEN || '';
const INFLUXDB_DS_UID = process.env.INFLUXDB_DATASOURCE_UID || '';
const INFLUXDB_URL   = process.env.INFLUXDB_URL   || 'http://10.0.6.39:8086';
const INFLUXDB_TOKEN = process.env.INFLUXDB_TOKEN;
const INFLUXDB_ORG   = process.env.INFLUXDB_ORG   || 'galaxy-lab';
const INFLUXDB_BUCKET = process.env.INFLUXDB_BUCKET || 'opnsense';
// WAN interface name on both OPNsense firewalls (verified: em0 is highest-traffic iface)
const WAN_INTERFACE  = process.env.WAN_INTERFACE  || 'em0';

// Friendly UPS names, keyed by Prometheus `instance` label (job="ups").
// halt = Fort firewall UPS, stop = Hawk House firewall UPS.
// Electricity price for the Power page. 13.716 c/kWh = Avista Schedule 1
// (residential WA) all-in rate for the 801-1500 kWh block, effective 2025-11-01 --
// the marginal tier the lab's incremental load actually bills at. The $10/mo basic
// charge is fixed and deliberately excluded. Same value as Grafana /d/power-cost.
// ─── Geist/Vertiv environmental sensor ──────────────────────────────────────
// Restored 2026-08-20: this feature was lost in an Aug-10 Syncthing conflict and
// survived only in the conflict copy. The sensor is NOT answering at this address
// (verified from union, dilithium and from eagle on its own subnet), so the card
// degrades to em-dashes until GEIST_URL points somewhere live.
const GEIST_URL  = process.env.GEIST_URL  || 'http://10.0.1.28';
const GEIST_USER = process.env.GEIST_USER || 'gadget';
const GEIST_PASS = process.env.GEIST_PASS || '';

const POWER_RATE_CENTS = parseFloat(process.env.POWER_RATE_CENTS || '13.716');

// Plugs that sit DOWNSTREAM of another metered plug. Dilithium is fed from a UPS
// whose own inlet is metered, so counting both double-counts it (~300 W). These are
// still shown individually, just excluded from fleet totals.
const POWER_DOWNSTREAM = (process.env.POWER_DOWNSTREAM || 'Dilithium')
  .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

const UPS_DISPLAY_NAMES = {
  'halt-opnsense': 'Fort UPS',
  'stop-opnsense': 'Hawk UPS',
};

// Firewall netdata instances (job="netdata", honor_labels -> netdata hostname,
// e.g. "halt.fort.example.com" / "stop.hawk.example.com"). Anything not matching
// (e.g. unraid = "everything") is ignored.
const NETDATA_FW_NAMES = [
  { match: /halt|fort/i, name: 'Fort Firewall' },
  { match: /stop|hawk/i, name: 'Hawk Firewall' },
];
function netdataFwName(instance) {
  const m = NETDATA_FW_NAMES.find(x => x.match.test(instance || ''));
  return m ? m.name : null;
}

// ─── LLM Config ─────────────────────────────────────────────────────────────
const OLLAMA_URL    = process.env.OLLAMA_URL    || 'http://10.0.6.45:11434';
const OLLAMA_MODEL  = process.env.OLLAMA_MODEL  || 'llama3.2:3b';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
// Set LLM_FALLBACK=false to disable Claude fallback and only use Ollama
const LLM_FALLBACK  = process.env.LLM_FALLBACK  !== 'false';

const LINUX_HOSTS = (process.env.LINUX_HOSTS || 'voyager,knox,union,dilithium,holodeck').split(',').map(h => h.trim());
const FW_HOSTS    = (process.env.FW_HOSTS    || 'fort-opnsense,hawk-opnsense').split(',').map(h => h.trim());
const FW_DISPLAY  = { 'fort-opnsense': 'fort', 'hawk-opnsense': 'hawk' };
const PVE_HOSTS   = (process.env.PVE_HOSTS   || 'pve').split(',').map(h => h.trim());

// SNMP-monitored NAS/servers surfaced from LibreNMS (which polls them via SNMP).
// Format: "librenmsDeviceId|Friendly Name|Site" entries separated by ';'.
// Fort OMV only for now (LibreNMS device_id 7); add the Hawk OMV here once healthy.
const SNMP_SERVERS = (process.env.SNMP_SERVERS || '7|OMV|Fort')
  .split(';').map(s => s.trim()).filter(Boolean)
  .map(s => { const [id, name, site] = s.split('|'); return { id: (id||'').trim(), name: (name||'').trim(), site: (site||'').trim() }; })
  .filter(s => s.id);

// Optional friendly names for MariaDB/MySQL exporter targets (job="mysql"), keyed
// by Prometheus `instance` label. The `server` label from Prometheus already
// names each DB, so this is just an optional override.
const DB_NAMES = Object.fromEntries(
  (process.env.DB_FRIENDLY_NAMES || '').split(',').filter(Boolean)
    .map(p => p.split('=').map(s => s.trim()))
    .filter(([k, v]) => k && v)
);

// ─── Proxmox API Config ──────────────────────────────────────────────────────
// PVE_API_TOKEN format: "root@pam!tokenid=<secret>"
const PVE_API_URL   = process.env.PVE_API_URL   || 'https://10.0.4.32:8006';
const PVE_API_TOKEN = process.env.PVE_API_TOKEN || '';
// Node name as it appears in the Proxmox cluster (default: pve)
const PVE_NODE      = process.env.PVE_NODE      || 'pve';

// ─── Auth middleware ────────────────────────────────────────────────────────
// Two supported modes (both require AUTH_ENABLED=true):
//   1. Bearer token — set API_TOKEN; clients send "Authorization: Bearer <token>"
//   2. OAuth2 proxy — leave API_TOKEN unset; validated user arrives in X-Forwarded-User
const API_TOKEN = process.env.API_TOKEN || '';

// ─── CheckCle proxy ──────────────────────────────────────────────────────────
const CHECKCLE_URL      = process.env.CHECKCLE_URL      || 'https://checkcle.example.com';
const CHECKCLE_EMAIL    = process.env.CHECKCLE_EMAIL    || '';
const CHECKCLE_PASSWORD = process.env.CHECKCLE_PASSWORD || '';

// ─── AMP proxy ───────────────────────────────────────────────────────────────
const AMP_PROXY_URL = process.env.AMP_URL      || '';
const AMP_USERNAME  = process.env.AMP_USERNAME || '';
const AMP_PASSWORD  = process.env.AMP_PASSWORD || '';

// ─── Unraid API ────────────────────────────────────────────────────────────────
// Unraid Connect GraphQL API (the unraid-api service on the server). Feeds the
// Unraid card: array status + capacity, per-disk/cache usage, and containers.
// UNRAID_API_KEY is created on the server (Settings → Management Access → API keys).
const UNRAID_URL     = process.env.UNRAID_URL     || 'http://10.0.7.19';
const UNRAID_API_KEY = process.env.UNRAID_API_KEY || '';
const UNRAID_NAME    = process.env.UNRAID_NAME    || 'Unraid';

// ─── Patch reports ───────────────────────────────────────────────────────────
// homelab-patching writes reports/latest.json on the control host (union). The
// directory is bind-mounted read-only into this container; see docker-compose.yml.
const PATCH_REPORT_DIR = process.env.PATCH_REPORT_DIR || '/data/patching';


app.use('/api', (req, res, next) => {
  if (process.env.AUTH_ENABLED !== 'true') return next();

  if (API_TOKEN) {
    const header = req.headers['authorization'] || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token !== API_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
    return next();
  }

  // OAuth2 proxy mode — X-Forwarded-User is set by Authentik/oauth2-proxy after validation
  if (req.headers['x-forwarded-user']) return next();

  res.status(401).json({ error: 'Unauthorized' });
});

// ─── Helpers ────────────────────────────────────────────────────────────────
function withTimeout(promise, ms = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function promQuery(expr) {
  try {
    const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(expr)}`;
    const res = await withTimeout(fetch(url));
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.result || [];
  } catch {
    return null;
  }
}

async function promRange(expr, start, end, step = 60) {
  try {
    const params = new URLSearchParams({ query: expr, start, end, step });
    const url = `${PROMETHEUS_URL}/api/v1/query_range?${params}`;
    const res = await withTimeout(fetch(url));
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.result || [];
  } catch {
    return null;
  }
}

async function grafanaGet(path) {
  try {
    const res = await withTimeout(fetch(`${GRAFANA_URL}${path}`, {
      headers: { Authorization: `Bearer ${GRAFANA_TOKEN}` }
    }));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Strip :port suffix from Prometheus instance labels
const stripPort = inst => (inst || '').split(':')[0];

// Map a vector result to { hostname: value }
function vectorToMap(results) {
  const map = {};
  if (!results) return map;
  for (const r of results) {
    const name = stripPort(r.metric.instance || r.metric.host || '');
    map[name] = parseFloat(r.value[1]);
  }
  return map;
}

// ─── Data fetchers ──────────────────────────────────────────────────────────
async function fetchPrometheus() {
  const [upNode, upFw, cpu, ram, disk, dlBits, ulBits, bootTime] = await Promise.all([
    promQuery('up{job="node"}'),
    promQuery('up{job="opnsense_node"}'),
    promQuery('100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle",job="node"}[5m])))'),
    promQuery('(1 - node_memory_MemAvailable_bytes{job="node"} / node_memory_MemTotal_bytes{job="node"}) * 100'),
    promQuery('(node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs",job="node"} - node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs",job="node"}) / node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs",job="node"} * 100'),
    promQuery('speedtest_tracker_download_bits'),
    promQuery('speedtest_tracker_upload_bits'),
    promQuery('time() - node_boot_time_seconds{job="node"}'),
  ]);

  const upMap      = vectorToMap(upNode);
  const fwMap      = vectorToMap(upFw);
  const cpuMap     = vectorToMap(cpu);
  const ramMap     = vectorToMap(ram);
  const diskMap    = vectorToMap(disk);
  const uptimeMap  = vectorToMap(bootTime);

  const round1 = v => v != null ? Math.round(v * 10) / 10 : null;

  const hosts = [
    ...LINUX_HOSTS.map(name => ({
      name,
      type: 'linux',
      up: upMap[name] === 1,
      cpu_pct:  round1(cpuMap[name]),
      ram_pct:  round1(ramMap[name]),
      disk_pct: round1(diskMap[name]),
      uptime:   fmtUptime(uptimeMap[name]),
    })),
    ...FW_HOSTS.map(name => ({
      name: FW_DISPLAY[name] || name,
      instance: name,
      type: 'firewall',
      up: fwMap[name] === 1,
      cpu_pct: null, ram_pct: null, disk_pct: null, uptime: null,
    })),
    ...PVE_HOSTS.map(name => ({
      name,
      type: 'proxmox',
      up: upMap[name] === 1,
      cpu_pct:  round1(cpuMap[name]),
      ram_pct:  round1(ramMap[name]),
      disk_pct: round1(diskMap[name]),
      uptime:   fmtUptime(uptimeMap[name]),
    })),
  ];

  // Build speedtests array — one entry per Prometheus instance
  // instance label: "speedtest-tracker" = fort, "speedtest-tracker-hawk" = hawk
  const SITE_LABELS = {
    'speedtest-tracker':      'Fort',
    'speedtest-tracker-hawk': 'Hawk',
  };
  const dlMap = {};
  const ulMap = {};
  const ispMap = {};
  for (const r of (dlBits || [])) {
    const inst = r.metric.instance || r.metric.host || 'unknown';
    dlMap[inst]  = parseFloat(r.value[1]);
    ispMap[inst] = r.metric.isp || null;
  }
  for (const r of (ulBits || [])) {
    const inst = r.metric.instance || r.metric.host || 'unknown';
    ulMap[inst] = parseFloat(r.value[1]);
  }
  const allInsts = [...new Set([...Object.keys(dlMap), ...Object.keys(ulMap)])];
  const speedtests = allInsts.map(inst => ({
    instance: inst,
    site:     SITE_LABELS[inst] || inst,
    isp:      ispMap[inst] || null,
    download_mbps: dlMap[inst] != null ? round1(dlMap[inst] / 1e6) : null,
    upload_mbps:   ulMap[inst] != null ? round1(ulMap[inst] / 1e6) : null,
  })).sort((a, b) => a.site.localeCompare(b.site));

  return {
    hosts,
    speedtests,
  };
}

async function fetchAlerts() {
  // Grafana unified alerting — active, non-silenced alerts
  const raw = await grafanaGet('/api/alertmanager/grafana/api/v2/alerts?active=true&inhibited=false&silenced=false');
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(a => a.status?.state === 'active')
    .map(a => ({
      name:         a.labels?.alertname || 'Unknown',
      severity:     a.labels?.severity  || 'warning',
      instance:     a.labels?.instance  || a.labels?.host || '',
      summary:      a.annotations?.summary || '',
      firing_since: a.startsAt,
    }))
    .sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    });
}

async function fetchWan() {
  if (!INFLUXDB_TOKEN) return null;

  // Query InfluxDB directly for WAN traffic on both OPNsense firewalls.
  // Both halt.example.com and stop.example.com use em0 as the WAN interface (verified).
  // Returns 1-hour history at 5-minute resolution, one series per firewall.
  const fluxQuery = `
from(bucket: "${INFLUXDB_BUCKET}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "net"
      and r.interface == "${WAN_INTERFACE}"
      and (r._field == "bytes_recv" or r._field == "bytes_sent"))
  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)
  |> derivative(unit: 1s, nonNegative: true)
  |> map(fn: (r) => ({r with mbps: r._value * 8.0 / 1000000.0}))
  |> pivot(rowKey: ["_time","host"], columnKey: ["_field"], valueColumn: "mbps")
  |> sort(columns: ["_time","host"])
`;
  try {
    const res = await withTimeout(fetch(
      `${INFLUXDB_URL}/api/v2/query?org=${INFLUXDB_ORG}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${INFLUXDB_TOKEN}`,
          'Content-Type': 'application/vnd.flux',
          Accept: 'application/csv',
        },
        body: fluxQuery,
      }
    ), 8000);
    if (!res.ok) return null;
    const csv = await res.text();
    return parseWanCsv(csv);
  } catch {
    return null;
  }
}

function parseWanCsv(csv) {
  try {
    const lines = csv.replace(/\r/g, '').split('\n').filter(l => l.trim() && !l.startsWith('#'));
    if (lines.length < 2) return null;

    const headers = lines[0].split(',');
    const timeIdx = headers.indexOf('_time');
    const hostIdx = headers.indexOf('host');
    const rxIdx   = headers.indexOf('bytes_recv');
    const txIdx   = headers.indexOf('bytes_sent');
    if (timeIdx < 0 || rxIdx < 0 || txIdx < 0) return null;

    // Collect data per host
    const byHost = {};
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const t = new Date(cols[timeIdx]);
      if (isNaN(t)) continue;
      const host = hostIdx >= 0 ? (cols[hostIdx] || 'wan') : 'wan';
      const label = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`;
      const rx = Math.round((parseFloat(cols[rxIdx]) || 0) * 10) / 10;
      const tx = Math.round((parseFloat(cols[txIdx]) || 0) * 10) / 10;
      if (!byHost[host]) byHost[host] = { labels: [], rx_mbps: [], tx_mbps: [] };
      byHost[host].labels.push(label);
      byHost[host].rx_mbps.push(rx);
      byHost[host].tx_mbps.push(tx);
    }

    const hosts = Object.keys(byHost);
    if (!hosts.length) return null;

    // Use the first host's labels as the shared x-axis (they share the same 5m windows)
    const primary = byHost[hosts[0]];
    return {
      labels: primary.labels,
      series: hosts.map(h => ({
        host: h.replace('.example.com', '').replace('.universe', ''),
        rx_mbps: byHost[h].rx_mbps,
        tx_mbps: byHost[h].tx_mbps,
      })),
    };
  } catch {
    return null;
  }
}

// ─── LLM helpers ────────────────────────────────────────────────────────────
function buildLabContext(prom, alerts, pve, ups) {
  const lines = [];
  lines.push('(Percentages below are percent USED, not percent free.)');

  if (prom?.hosts?.length) {
    const up   = prom.hosts.filter(h => h.up).length;
    const down = prom.hosts.filter(h => !h.up);
    lines.push(`Hosts: ${up}/${prom.hosts.length} online`);
    if (down.length) lines.push(`  Offline: ${down.map(h => h.name).join(', ')}`);
    for (const h of prom.hosts) {
      if (h.cpu_pct != null)
        lines.push(`  ${h.name}: CPU ${h.cpu_pct}% used | RAM ${h.ram_pct}% used | Disk ${h.disk_pct}% used`);
    }
  }

  if (prom?.speedtests?.length) {
    for (const s of prom.speedtests) {
      const isp = s.isp ? ` (${s.isp})` : '';
      lines.push(`Internet (${s.site}): ↓${s.download_mbps ?? '?'} Mbps ↑${s.upload_mbps ?? '?'} Mbps${isp}`);
    }
  }

  if (pve) {
    const n = pve.node;
    lines.push(`Proxmox VE ${n.version ?? ''}: CPU ${n.cpu_pct}% | RAM ${n.mem_used_gb}/${n.mem_total_gb} GB | uptime ${n.uptime}`);
    if (pve.vms?.length) {
      lines.push(`  VMs (${pve.vms.length}):`);
      for (const vm of pve.vms) {
        const s = vm.status === 'running'
          ? `running — CPU ${vm.cpu_pct}% | RAM ${vm.mem_used_gb}/${vm.mem_total_gb} GB | up ${vm.uptime}`
          : vm.status;
        lines.push(`    ${vm.name} (${vm.vmid}): ${s}`);
      }
    }
    if (pve.storage?.length) {
      lines.push(`  Storage: ${pve.storage.map(s => `${s.name} ${s.pct}% used`).join(', ')}`);
    }
  }

  if (ups?.length) {
    for (const u of ups) {
      // A UPS that has lost its monitoring link reports zero for every reading.
      // Printed raw, "Battery 0%" reads as a dead battery, so say the readings
      // are unavailable instead of handing the model zeros to interpret.
      if (u.status === 'COMMLOST' || u.status === 'COMMBAD') {
        lines.push(`UPS (${u.name}): ${u.status} - monitoring link down, readings unavailable. This means we cannot see the UPS, NOT that its battery is empty.`);
      } else {
        lines.push(`UPS (${u.name}): ${u.status} | Battery ${u.charge_pct ?? '?'}% charged | Runtime ${u.time_left_m ?? '?'} min remaining | Load ${u.load_pct ?? '?'}% | Line ${u.line_volts ?? '?'}V`);
      }
    }
  }

  if (!alerts?.length) {
    lines.push('Active alerts: none');
  } else {
    lines.push(`Active alerts (${alerts.length}):`);
    for (const a of alerts) {
      const inst = a.instance ? ` on ${a.instance}` : '';
      const summ = a.summary  ? ` — ${a.summary}`   : '';
      lines.push(`  [${a.severity.toUpperCase()}] ${a.name}${inst}${summ}`);
    }
  }

  return lines.join('\n');
}

async function askOllama(systemPrompt, messages) {
  const res = await withTimeout(fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    OLLAMA_MODEL,
      stream:   false,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  }), 30000);
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const json = await res.json();
  const text = json.message?.content?.trim();
  if (!text) throw new Error('Empty response from Ollama');
  return text;
}

async function askClaude(systemPrompt, messages) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await withTimeout(fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system:     systemPrompt,
      messages,
    }),
  }), 15000);
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
  const json = await res.json();
  const text = json.content?.[0]?.text?.trim();
  if (!text) throw new Error('Empty response from Claude');
  return text;
}

async function fetchContainers() {
  const [cpu, mem, limit] = await Promise.all([
    promQuery('rate(container_cpu_usage_seconds_total{name!="",job="cadvisor"}[2m]) * 100'),
    promQuery('container_memory_usage_bytes{name!="",job="cadvisor"}'),
    promQuery('container_spec_memory_limit_bytes{name!="",job="cadvisor"}'),
  ]);

  if (!cpu?.length) return null;

  // Key by "instance/name" to avoid collisions across hosts
  const memMap = {};
  const limitMap = {};
  for (const r of (mem   || [])) memMap[`${r.metric.instance}/${r.metric.name}`]   = parseFloat(r.value[1]);
  for (const r of (limit || [])) limitMap[`${r.metric.instance}/${r.metric.name}`] = parseFloat(r.value[1]);

  const all = cpu.map(r => {
    const rawName  = r.metric.name || 'unknown';
    const host     = r.metric.instance || 'unknown';
    const key      = `${host}/${rawName}`;
    // Prefer the Swarm service name (clean) over the full task name (has node/task hash suffixes)
    const svcName  = r.metric.container_label_com_docker_swarm_service_name;
    const name     = svcName || rawName;
    const cpuPct   = Math.round(parseFloat(r.value[1]) * 10) / 10;
    const memBytes = memMap[key]   || 0;
    const limBytes = limitMap[key] || 0;
    const memMb    = Math.round(memBytes / 1048576);
    const limMb    = limBytes > 0 ? Math.round(limBytes / 1048576) : 0;
    const memPct   = limBytes > 0 ? Math.round((memBytes / limBytes) * 100) : null;
    return { name, host, cpu_pct: cpuPct, mem_mb: memMb, limit_mb: limMb, mem_pct: memPct };
  });

  // Group by host, sorted by CPU desc within each host
  const byHost = {};
  for (const c of all) {
    if (!byHost[c.host]) byHost[c.host] = [];
    byHost[c.host].push(c);
  }
  for (const host of Object.keys(byHost)) {
    byHost[host].sort((a, b) => b.cpu_pct - a.cpu_pct);
  }

  // Flat top-15 list for backwards compat
  const containers = all.sort((a, b) => b.cpu_pct - a.cpu_pct).slice(0, 15);

  return { running: cpu.length, containers, by_host: byHost };
}

// MariaDB/MySQL performance via mysqld_exporter (job="mysql"). One target per DB;
// results keyed by the Prometheus `instance` label so each DB is its own row.
async function fetchDatabases() {
  const [up, uptime, connected, maxConn, running, queries, slow, aborted, bpReads, bpReq] =
    await Promise.all([
      promQuery('mysql_up{job=~"mysql.*"}'),
      promQuery('mysql_global_status_uptime{job=~"mysql.*"}'),
      promQuery('mysql_global_status_threads_connected{job=~"mysql.*"}'),
      promQuery('mysql_global_variables_max_connections{job=~"mysql.*"}'),
      promQuery('mysql_global_status_threads_running{job=~"mysql.*"}'),
      promQuery('rate(mysql_global_status_queries{job=~"mysql.*"}[5m])'),
      promQuery('rate(mysql_global_status_slow_queries{job=~"mysql.*"}[5m])'),
      promQuery('rate(mysql_global_status_aborted_connects{job=~"mysql.*"}[5m])'),
      promQuery('rate(mysql_global_status_innodb_buffer_pool_reads{job=~"mysql.*"}[5m])'),
      promQuery('rate(mysql_global_status_innodb_buffer_pool_read_requests{job=~"mysql.*"}[5m])'),
    ]);

  if (!up?.length) return null;

  const round1 = v => (v != null && !isNaN(v) ? Math.round(v * 10) / 10 : null);
  const byInst = (results) => {
    const m = {};
    for (const r of (results || [])) m[r.metric.instance] = parseFloat(r.value[1]);
    return m;
  };
  const uptM = byInst(uptime), conM = byInst(connected), maxM = byInst(maxConn),
        runM = byInst(running), qM = byInst(queries), slowM = byInst(slow),
        abM = byInst(aborted), bprM = byInst(bpReads), bpqM = byInst(bpReq);

  return up.map(r => {
    const inst = r.metric.instance;
    const name = DB_NAMES[inst] || r.metric.server || stripPort(inst);
    const reads = bprM[inst], req = bpqM[inst];
    const hitPct = (req != null && req > 0) ? round1((1 - reads / req) * 100) : null;
    const conn = conM[inst], max = maxM[inst];
    return {
      name,
      instance:        inst,
      up:              r.value[1] === '1',
      uptime:          fmtUptime(uptM[inst]),
      connections:     conn != null ? Math.round(conn) : null,
      max_conn:        max  != null ? Math.round(max)  : null,
      conn_pct:        (conn != null && max) ? round1((conn / max) * 100) : null,
      threads_running: runM[inst] != null ? Math.round(runM[inst]) : null,
      qps:             round1(qM[inst]),
      slow_qps:        round1(slowM[inst]),
      aborted_qps:     round1(abM[inst]),
      buffer_hit_pct:  hitPct,
      engine:          'mysql',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Redis performance via redis_exporter (job="redis"). Shaped to slot into the
// same databases view as MariaDB/MySQL rows (engine: 'redis'); metrics that don't
// map to Redis (slow queries, worker threads) are left null.
async function fetchRedis() {
  const [up, uptime, clients, maxClients, cmds, hits, misses] = await Promise.all([
    promQuery('redis_up{job=~"redis.*"}'),
    promQuery('redis_uptime_in_seconds{job=~"redis.*"}'),
    promQuery('redis_connected_clients{job=~"redis.*"}'),
    promQuery('redis_config_maxclients{job=~"redis.*"}'),
    promQuery('rate(redis_commands_processed_total{job=~"redis.*"}[5m])'),
    promQuery('rate(redis_keyspace_hits_total{job=~"redis.*"}[5m])'),
    promQuery('rate(redis_keyspace_misses_total{job=~"redis.*"}[5m])'),
  ]);

  if (!up?.length) return null;

  const round1 = v => (v != null && !isNaN(v) ? Math.round(v * 10) / 10 : null);
  const byInst = (results) => {
    const m = {};
    for (const r of (results || [])) m[r.metric.instance] = parseFloat(r.value[1]);
    return m;
  };
  const uptM = byInst(uptime), cliM = byInst(clients), maxM = byInst(maxClients),
        cmdM = byInst(cmds), hitM = byInst(hits), missM = byInst(misses);

  return up.map(r => {
    const inst = r.metric.instance;
    const name = DB_NAMES[inst] || r.metric.server || stripPort(inst);
    const conn = cliM[inst], max = maxM[inst];
    const h = hitM[inst], m = missM[inst];
    // Keyspace hit ratio (rate-based); null when there's no read traffic
    const hitPct = (h != null && m != null && (h + m) > 0) ? round1((h / (h + m)) * 100) : null;
    return {
      name,
      instance:        inst,
      up:              r.value[1] === '1',
      uptime:          fmtUptime(uptM[inst]),
      connections:     conn != null ? Math.round(conn) : null,
      max_conn:        max  != null ? Math.round(max)  : null,
      conn_pct:        (conn != null && max) ? round1((conn / max) * 100) : null,
      threads_running: null,
      qps:             round1(cmdM[inst]),
      slow_qps:        null,
      aborted_qps:     null,
      buffer_hit_pct:  hitPct,
      engine:          'redis',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// PostgreSQL performance via postgres_exporter (job="postgres", multi-target).
// Metrics are per-datname, so several are summed by instance. Shaped to slot into
// the same databases view with engine: 'postgres'.
async function fetchPostgres() {
  const [up, maxc, conns, xact, hit, reads] = await Promise.all([
    promQuery('pg_up{job="postgres"}'),
    promQuery('pg_settings_max_connections{job="postgres"}'),
    promQuery('sum by (instance) (pg_stat_database_numbackends{job="postgres"})'),
    promQuery('sum by (instance) (rate(pg_stat_database_xact_commit{job="postgres"}[5m]) + rate(pg_stat_database_xact_rollback{job="postgres"}[5m]))'),
    promQuery('sum by (instance) (rate(pg_stat_database_blks_hit{job="postgres"}[5m]))'),
    promQuery('sum by (instance) (rate(pg_stat_database_blks_read{job="postgres"}[5m]))'),
  ]);

  if (!up?.length) return null;

  const round1 = v => (v != null && !isNaN(v) ? Math.round(v * 10) / 10 : null);
  const byInst = (results) => {
    const m = {};
    for (const r of (results || [])) m[r.metric.instance] = parseFloat(r.value[1]);
    return m;
  };
  const maxM = byInst(maxc), conM = byInst(conns), xM = byInst(xact),
        hM = byInst(hit), rM = byInst(reads);

  return up.map(r => {
    const inst = r.metric.instance;
    const name = DB_NAMES[inst] || r.metric.server || stripPort(inst);
    const conn = conM[inst], max = maxM[inst];
    const h = hM[inst], rd = rM[inst];
    const hitPct = (h != null && rd != null && (h + rd) > 0) ? round1((h / (h + rd)) * 100) : null;
    return {
      name,
      instance:        inst,
      up:              r.value[1] === '1',
      uptime:          null,
      connections:     conn != null ? Math.round(conn) : null,
      max_conn:        max  != null ? Math.round(max)  : null,
      conn_pct:        (conn != null && max) ? round1((conn / max) * 100) : null,
      threads_running: null,
      qps:             round1(xM[inst]),
      slow_qps:        null,
      aborted_qps:     null,
      buffer_hit_pct:  hitPct,
      engine:          'postgres',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Proxmox API ────────────────────────────────────────────────────────────
// Proxmox uses a self-signed cert — https.request with rejectUnauthorized:false
function pveGet(apiPath) {
  if (!PVE_API_TOKEN) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const url = new URL(`${PVE_API_URL}${apiPath}`);
      const timer = setTimeout(() => resolve(null), 6000);
      const req = https.request({
        hostname: url.hostname,
        port:     url.port || 8006,
        path:     url.pathname + url.search,
        method:   'GET',
        rejectUnauthorized: false,
        headers:  { Authorization: `PVEAPIToken=${PVE_API_TOKEN}` },
      }, res => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          clearTimeout(timer);
          try { resolve(JSON.parse(raw).data ?? null); }
          catch { resolve(null); }
        });
      });
      req.on('error', () => { clearTimeout(timer); resolve(null); });
      req.end();
    } catch {
      resolve(null);
    }
  });
}

function fmtUptime(seconds) {
  if (seconds == null) return null;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function fetchUps() {
  const [charge, timeLeft, load, lineVolts, battVolts, info] = await Promise.all([
    promQuery('apcupsd_battery_charge_percent{job="ups"}'),
    promQuery('apcupsd_battery_time_left_seconds{job="ups"}'),
    promQuery('apcupsd_ups_load_percent{job="ups"}'),
    promQuery('apcupsd_line_volts{job="ups"}'),
    promQuery('apcupsd_battery_volts{job="ups"}'),
    promQuery('apcupsd_info{job="ups"}'),
  ]);

  if (!charge?.length) return null;

  // Keyed by the Prometheus `instance` label (one per apcupsd exporter), which
  // is stable regardless of the apcupsd UPSNAME. Values map to friendly names.
  const get = (results) => {
    const map = {};
    for (const r of (results || [])) {
      map[r.metric.instance || r.metric.ups || 'ups'] = parseFloat(r.value[1]);
    }
    return map;
  };

  const chargeMap    = get(charge);
  const timeLeftMap  = get(timeLeft);
  const loadMap      = get(load);
  const lineVoltsMap = get(lineVolts);
  const battVoltsMap = get(battVolts);

  const upsList = charge.map(r => {
    const inst   = r.metric.instance || r.metric.ups || 'ups';
    const name   = UPS_DISPLAY_NAMES[inst] || r.metric.ups || inst;
    const infoR  = (info || []).find(i => (i.metric.instance || i.metric.ups) === inst);
    const status = infoR?.metric?.status || 'UNKNOWN';
    const model  = infoR?.metric?.model  || '';
    const pct    = chargeMap[inst]    ?? null;
    const left   = timeLeftMap[inst]  ?? null;
    return {
      name,
      model,
      status,
      charge_pct:   pct   != null ? Math.round(pct)   : null,
      time_left_m:  left  != null ? Math.round(left / 60) : null,
      load_pct:     loadMap[inst]      != null ? Math.round(loadMap[inst])      : null,
      line_volts:   lineVoltsMap[inst] != null ? Math.round(lineVoltsMap[inst]) : null,
      batt_volts:   battVoltsMap[inst] != null ? parseFloat(battVoltsMap[inst].toFixed(1)) : null,
    };
  });

  // Stable order: Fort first, then Hawk, then anything else alphabetically.
  const order = { 'Fort UPS': 0, 'Hawk UPS': 1 };
  upsList.sort((a, b) => (order[a.name] ?? 9) - (order[b.name] ?? 9) || a.name.localeCompare(b.name));

  return upsList;
}

function geistGet(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(GEIST_URL);
    const transport = u.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path,
      method: 'GET',
      rejectUnauthorized: false,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${GEIST_USER}:${GEIST_PASS}`).toString('base64')}`,
      },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, data: JSON.parse(body) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function fetchTemperature() {
  try {
    const res = await geistGet('/api/');
    if (!res.ok || res.data?.retCode !== 0) return null;
    const devs = res.data?.data?.dev;
    if (!devs) return null;
    const dev = Object.values(devs)[0];
    if (!dev) return null;
    const m = dev.entity?.[0]?.measurement;
    if (!m) return null;
    const triggers = Object.values(res.data?.data?.alarm?.trigger || {});
    const highTrig = triggers.find(t => t.type === 'high' && t.path?.includes('measurement/0'));
    return {
      name:              dev.label || dev.name || 'Sensor',
      location:          res.data?.data?.conf?.contact?.location || '',
      temp_f:            parseFloat(m[0]?.value) || null,
      humidity_pct:      parseFloat(m[1]?.value) || null,
      dewpoint_f:        parseFloat(m[2]?.value) || null,
      alarm_state:       dev.alarm?.state || 'none',
      alarm_threshold_f: highTrig ? parseFloat(highTrig.threshold) : 90,
    };
  } catch {
    return null;
  }
}

// ─── Kasa metered plugs (power) ──────────────────────────────────────────────
// python-kasa exporter on union (10.0.6.73:9311) -> Prometheus job "kasa".
// Only some plugs meter; kasa_power_watts simply won't exist for the others.
async function fetchKasa() {
  const [watts, kwhToday, kwhMonth, amps, state] = await Promise.all([
    promQuery('kasa_power_watts'),
    promQuery('kasa_energy_kwh_today'),
    promQuery('kasa_energy_kwh_month'),
    promQuery('kasa_current_amps'),
    promQuery('kasa_outlet_state'),
  ]);

  if (!watts?.length) return null;

  // Keyed by the `device` label (the plug's Kasa alias, e.g. "Fort big UPS").
  const byDevice = (results) => {
    const m = {};
    for (const r of (results || [])) {
      const k = (r.metric.device || r.metric.outlet || '').trim();
      if (k) m[k] = parseFloat(r.value[1]);
    }
    return m;
  };
  const todayMap = byDevice(kwhToday);
  const monthMap = byDevice(kwhMonth);
  const ampsMap  = byDevice(amps);
  const stateMap = byDevice(state);

  const r1 = (n) => (n == null || Number.isNaN(n)) ? null : Math.round(n * 10) / 10;

  const plugs = watts.map(r => {
    const dev = (r.metric.device || r.metric.outlet || 'unknown').trim();
    return {
      device:     dev,
      ip:         r.metric.ip    || null,
      model:      r.metric.model || null,
      site:       r.metric.site  || null,
      watts:      r1(parseFloat(r.value[1])),
      kwh_today:  r1(todayMap[dev]),
      kwh_month:  r1(monthMap[dev]),
      amps:       ampsMap[dev] != null ? Math.round(ampsMap[dev] * 100) / 100 : null,
      on:         stateMap[dev] != null ? stateMap[dev] === 1 : null,
      // True = fed from another metered plug, so excluded from the totals below.
      downstream: POWER_DOWNSTREAM.includes(dev.toLowerCase()),
    };
  }).sort((a, b) => (b.watts ?? 0) - (a.watts ?? 0));

  const counted = plugs.filter(p => !p.downstream);
  const sum = (arr, k) => arr.reduce((t, p) => t + (p[k] ?? 0), 0);

  const totalW    = sum(counted, 'watts');
  const kwhTodayT = sum(counted, 'kwh_today');
  const kwhMonthT = sum(counted, 'kwh_month');
  const rate      = POWER_RATE_CENTS / 100;          // cents -> dollars per kWh
  const projMonth = (totalW / 1000) * 24 * 30;
  const money     = (n) => Math.round(n * 100) / 100;

  return {
    rate_cents:       POWER_RATE_CENTS,
    plugs,
    excluded:         plugs.filter(p => p.downstream).map(p => p.device),
    total_watts:      r1(totalW),
    total_watts_raw:  r1(sum(plugs, 'watts')),
    kwh_today:        r1(kwhTodayT),
    kwh_month:        r1(kwhMonthT),
    cost_today:       money(kwhTodayT * rate),
    cost_month_todate: money(kwhMonthT * rate),
    proj_month_kwh:   r1(projMonth),
    proj_month_cost:  money(projMonth * rate),
    proj_year_cost:   money((totalW / 1000) * 24 * 365 * rate),
  };
}

// ─── LibreNMS (SNMP) ─────────────────────────────────────────────────────────
// LibreNMS polls the OMV NAS boxes via SNMP already; we just read its API so
// NOLA doesn't need a second SNMP poller. Returns null on any auth/network fail.
async function librenmsGet(path) {
  if (!LIBRENMS_TOKEN) return null;
  try {
    const res = await withTimeout(fetch(`${LIBRENMS_URL}/api/v0${path}`, {
      headers: { 'X-Auth-Token': LIBRENMS_TOKEN },
    }), 8000);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Compact health card for each SNMP-monitored server: status/uptime + CPU
// (avg processor usage), RAM (physical mempool), and its largest data volume.
async function fetchServers() {
  const out = await Promise.all(SNMP_SERVERS.map(async (cfg) => {
    const dev = await librenmsGet(`/devices/${cfg.id}`);
    const d = dev?.devices?.[0];
    if (!d) return null;

    // CPU: average processor_usage across every processor sensor.
    let cpu_pct = null;
    const procList = await librenmsGet(`/devices/${cfg.id}/health/processor`);
    const procIds = (procList?.graphs || []).map(g => g.sensor_id);
    if (procIds.length) {
      const procs = await Promise.all(procIds.map(id =>
        librenmsGet(`/devices/${cfg.id}/health/processor/${id}`)));
      const vals = procs.map(p => p?.graphs?.[0]?.processor_usage)
        .filter(v => v != null && !isNaN(v));
      if (vals.length) cpu_pct = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    // RAM: the "Physical memory" mempool (fallback: first mempool sensor).
    let ram = null;
    const memList = await librenmsGet(`/devices/${cfg.id}/health/mempool`);
    const memSensor = (memList?.graphs || []).find(g => /physical/i.test(g.desc || ''))
                   || (memList?.graphs || [])[0];
    if (memSensor) {
      const m = await librenmsGet(`/devices/${cfg.id}/health/mempool/${memSensor.sensor_id}`);
      const g = m?.graphs?.[0];
      if (g) ram = { pct: Math.round(g.mempool_perc), used: g.mempool_used, total: g.mempool_total };
    }

    // Disk: largest real volume (skip tmpfs/pseudo mounts).
    let disk = null;
    const stList = await librenmsGet(`/devices/${cfg.id}/health/storage`);
    const stIds = (stList?.graphs || [])
      .filter(g => !/^\/(tmp|run|dev|proc|sys|boot)(\/|$)/.test(g.desc || ''))
      .map(g => g.sensor_id);
    if (stIds.length) {
      const sts = await Promise.all(stIds.map(id =>
        librenmsGet(`/devices/${cfg.id}/health/storage/${id}`)));
      // Largest volume wins; on a tie prefer a friendly share path over OMV's
      // raw /srv/dev-disk-by-* mount (both point at the same physical disk).
      const rawMount = m => /^\/srv\/dev-disk/.test(m || '');
      const vols = sts.map(s => s?.graphs?.[0]).filter(Boolean)
        .sort((a, b) => (b.storage_size || 0) - (a.storage_size || 0)
                     || (rawMount(a.storage_descr) - rawMount(b.storage_descr)));
      const v = vols[0];
      if (v) disk = { mount: v.storage_descr, pct: Math.round(v.storage_perc),
                      used: v.storage_used, size: v.storage_size };
    }

    return {
      name:    cfg.name || d.sysName || d.hostname,
      site:    cfg.site || '',
      status:  d.status ? 'UP' : 'DOWN',
      uptime_s: d.uptime ?? null,
      os:      d.hardware || d.os || '',
      cpu_pct,
      ram,
      disk,
    };
  }));
  const list = out.filter(Boolean);
  return list.length ? list : null;
}

// Netdata-sourced firewall health. Netdata for both firewalls is already
// scraped into Prometheus (job="netdata"); this surfaces the signal NOLA
// doesn't get from node_exporter: ML anomaly rate, disk temp, and per-NIC
// throughput. A firewall only appears while its netdata target is up.
async function fetchNetdata() {
  const [anomaly, diskTemp, load1, net] = await Promise.all([
    promQuery('netdata_anomaly_detection_anomaly_rate_percentage_average'),
    promQuery('netdata_smartctl_device_temperature_Celsius_average'),
    promQuery('netdata_system_load_load_average{dimension="load1"}'),
    promQuery('netdata_net_net_kilobits_persec_average'),
  ]);

  const fw = {};
  const ensure = (inst) => {
    const name = netdataFwName(inst);
    if (!name) return null;
    if (!fw[name]) fw[name] = { name, anomaly_pct: null, disk_temp_c: null, load1: null, interfaces: {} };
    return fw[name];
  };

  for (const r of (anomaly || [])) {
    const o = ensure(r.metric.instance); if (!o) continue;
    const v = parseFloat(r.value[1]);
    o.anomaly_pct = o.anomaly_pct == null ? v : Math.max(o.anomaly_pct, v);
  }
  for (const r of (diskTemp || [])) {
    const o = ensure(r.metric.instance); if (!o) continue;
    const v = parseFloat(r.value[1]);
    o.disk_temp_c = o.disk_temp_c == null ? v : Math.max(o.disk_temp_c, v); // hottest disk
  }
  for (const r of (load1 || [])) {
    const o = ensure(r.metric.instance); if (!o) continue;
    o.load1 = parseFloat(r.value[1]);
  }
  for (const r of (net || [])) {
    const o = ensure(r.metric.instance); if (!o) continue;
    const dev = r.metric.device || r.metric.chart || 'iface';
    const kbps = Math.abs(parseFloat(r.value[1])); // netdata reports "sent" as negative
    if (!o.interfaces[dev]) o.interfaces[dev] = { dev, rx_kbps: 0, tx_kbps: 0 };
    if (r.metric.dimension === 'received') o.interfaces[dev].rx_kbps = kbps;
    else if (r.metric.dimension === 'sent') o.interfaces[dev].tx_kbps = kbps;
  }

  const list = Object.values(fw).map(o => {
    const interfaces = Object.values(o.interfaces)
      .map(i => ({ ...i, total: i.rx_kbps + i.tx_kbps }))
      .filter(i => i.total >= 1)          // hide idle NICs
      .sort((a, b) => b.total - a.total)
      .slice(0, 4)
      .map(i => ({ dev: i.dev, rx_kbps: Math.round(i.rx_kbps), tx_kbps: Math.round(i.tx_kbps) }));
    return {
      name: o.name,
      anomaly_pct: o.anomaly_pct != null ? parseFloat(o.anomaly_pct.toFixed(2)) : null,
      disk_temp_c: o.disk_temp_c != null ? Math.round(o.disk_temp_c) : null,
      load1:       o.load1 != null ? parseFloat(o.load1.toFixed(2)) : null,
      interfaces,
    };
  });

  const order = { 'Fort Firewall': 0, 'Hawk Firewall': 1 };
  list.sort((a, b) => (order[a.name] ?? 9) - (order[b.name] ?? 9) || a.name.localeCompare(b.name));

  return list.length ? list : null;
}

async function fetchProxmox() {
  if (!PVE_API_TOKEN) return null;

  const [nodeStatus, vms, storage] = await Promise.all([
    pveGet(`/api2/json/nodes/${PVE_NODE}/status`),
    pveGet(`/api2/json/nodes/${PVE_NODE}/qemu`),
    pveGet(`/api2/json/nodes/${PVE_NODE}/storage`),
  ]);

  if (!nodeStatus) return null;

  const round2 = v => Math.round((v ?? 0) * 100) / 100;

  return {
    node: {
      name:       PVE_NODE,
      version:    nodeStatus.pveversion?.match(/pve-manager\/([\d.]+)/)?.[1] ?? null,
      uptime:     fmtUptime(nodeStatus.uptime),
      cpu_pct:    round2(nodeStatus.cpu * 100),
      mem_used_gb: round2((nodeStatus.memory?.used  ?? 0) / 1e9),
      mem_total_gb: round2((nodeStatus.memory?.total ?? 0) / 1e9),
      loadavg:    nodeStatus.loadavg ?? null,
    },
    vms: (vms ?? [])
      .sort((a, b) => a.vmid - b.vmid)
      .map(vm => ({
        vmid:        vm.vmid,
        name:        vm.name,
        status:      vm.status,
        cpu_pct:     round2(vm.cpu * 100),
        mem_used_gb: round2((vm.mem    ?? 0) / 1e9),
        mem_total_gb: round2((vm.maxmem ?? 0) / 1e9),
        uptime:      fmtUptime(vm.uptime),
      })),
    storage: (storage ?? [])
      .filter(s => s.active && s.total > 0)
      .sort((a, b) => a.storage.localeCompare(b.storage))
      .map(s => ({
        name:      s.storage,
        type:      s.type,
        used_gb:   round2((s.used  ?? 0) / 1e9),
        total_gb:  round2((s.total ?? 0) / 1e9),
        pct:       s.total > 0 ? round2(s.used / s.total * 100) : 0,
      })),
  };
}

// Unraid Connect GraphQL API. One query returns the array (state + capacity +
// per-disk/cache/parity), the docker container list, and host info. Disk/array
// sizes come back in KiB (1024-byte units) — converted to bytes here. Shaped so
// the "NAS mounts" are array data disks + cache pools (things with a filesystem),
// while parity disks are health-only (no usable filesystem). See UNRAID_* env.
async function unraidQuery(query) {
  const res = await withTimeout(fetch(`${UNRAID_URL}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': UNRAID_API_KEY },
    body: JSON.stringify({ query }),
  }), 6000);
  if (!res.ok) return null;
  const json = await res.json();
  return json?.data || null;
}

async function fetchUnraid() {
  if (!UNRAID_API_KEY) return null;

  const data = await unraidQuery(`{
    info { os { hostname uptime } }
    array {
      state
      capacity { kilobytes { free used total } }
      disks    { name size status temp fsSize fsFree fsUsed type }
      caches   { name size temp fsSize fsFree fsUsed }
      parities { name status temp size }
    }
    docker { containers { names state } }
  }`);
  if (!data?.array) return null;

  const KiB = 1024;
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const pctOf = (used, total) => (total > 0 ? Math.round((used / total) * 1000) / 10 : null);

  // Array data disks + cache pools become the usable "mounts" (they carry a
  // filesystem). fsUsed/fsFree/fsSize are per-filesystem; fall back to raw size.
  const toMount = (d, type) => {
    const used = num(d.fsUsed) * KiB;
    const free = num(d.fsFree) * KiB;
    const size = (num(d.fsSize) || num(d.size)) * KiB;
    return {
      name:       d.name,
      type,
      used_bytes: used,
      free_bytes: free,
      size_bytes: size,
      pct:        pctOf(used, size),
      temp_c:     d.temp != null ? Math.round(num(d.temp)) : null,
      status:     d.status || null,
    };
  };
  const mounts = [
    ...(data.array.disks  || []).map(d => toMount(d, d.type || 'DATA')),
    ...(data.array.caches || []).map(d => toMount(d, 'CACHE')),
  ];

  const parity = (data.array.parities || []).map(p => ({
    name:   p.name,
    status: p.status || null,
    temp_c: p.temp != null ? Math.round(num(p.temp)) : null,
  }));

  const cap = data.array.capacity?.kilobytes || {};
  const capUsed = num(cap.used) * KiB, capTotal = num(cap.total) * KiB;
  const capacity = {
    used_bytes:  capUsed,
    free_bytes:  num(cap.free) * KiB,
    total_bytes: capTotal,
    pct:         pctOf(capUsed, capTotal),
  };

  const ctrs = (data.docker?.containers || []).map(c => {
    const name = (Array.isArray(c.names) ? c.names[0] : c.names || '').replace(/^\//, '');
    return { name, state: c.state, running: c.state === 'RUNNING' };
  }).sort((a, b) => (b.running - a.running) || a.name.localeCompare(b.name));
  const running = ctrs.filter(c => c.running).length;

  // uptime is an ISO boot timestamp; convert to an elapsed-seconds string.
  const boot = Date.parse(data.info?.os?.uptime);
  const uptime = isNaN(boot) ? null : fmtUptime((Date.now() - boot) / 1000);

  return {
    name:     UNRAID_NAME,
    host:     data.info?.os?.hostname || null,
    state:    data.array.state || null,
    uptime,
    capacity,
    mounts,
    parity,
    containers: { total: ctrs.length, running, stopped: ctrs.length - running, list: ctrs },
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────
app.get('/api/data', async (req, res) => {
  const [promResult, alertsResult, wanResult, pveResult, upsResult, powerResult, tempResult, ctrResult, netdataResult, dbResult, redisResult, pgResult, serversResult, unraidResult] = await Promise.allSettled([
    fetchPrometheus(),
    fetchAlerts(),
    fetchWan(),
    fetchProxmox(),
    fetchUps(),
    fetchKasa(),
    fetchTemperature(),
    fetchContainers(),
    fetchNetdata(),
    fetchDatabases(),
    fetchRedis(),
    fetchPostgres(),
    fetchServers(),
    fetchUnraid(),
  ]);

  const prom    = promResult.status    === 'fulfilled' ? promResult.value    : null;
  const alerts  = alertsResult.status  === 'fulfilled' ? alertsResult.value  : [];
  const wan     = wanResult.status     === 'fulfilled' ? wanResult.value     : null;
  const pve     = pveResult.status     === 'fulfilled' ? pveResult.value     : null;
  const ups     = upsResult.status     === 'fulfilled' ? upsResult.value     : null;
  const power   = powerResult.status   === 'fulfilled' ? powerResult.value   : null;
  const temperature = tempResult.status === 'fulfilled' ? tempResult.value   : null;
  const ctr     = ctrResult.status     === 'fulfilled' ? ctrResult.value     : null;
  const netdata = netdataResult.status === 'fulfilled' ? netdataResult.value : null;
  const mysqlDbs = dbResult.status     === 'fulfilled' ? dbResult.value      : null;
  const redisDbs = redisResult.status  === 'fulfilled' ? redisResult.value   : null;
  const pgDbs    = pgResult.status     === 'fulfilled' ? pgResult.value      : null;
  const servers  = serversResult.status === 'fulfilled' ? serversResult.value : null;
  const unraid  = unraidResult.status  === 'fulfilled' ? unraidResult.value  : null;

  // MySQL/MariaDB + Redis + PostgreSQL share one databases view (each row carries `engine`)
  const databases = (mysqlDbs || redisDbs || pgDbs)
    ? [...(mysqlDbs || []), ...(redisDbs || []), ...(pgDbs || [])].sort((a, b) => a.name.localeCompare(b.name))
    : null;

  res.json({
    timestamp: new Date().toISOString(),
    hosts:      prom?.hosts      || [],
    speedtests: prom?.speedtests || [],
    alerts,
    wan,
    pve,
    ups,
    power,
    temperature,
    containers: ctr,
    netdata,
    databases,
    servers,
    unraid,
    errors: {
      prometheus:  prom   ? null : 'fetch failed',
      alerts:      alertsResult.status === 'rejected' ? 'fetch failed' : null,
      wan:         wan    ? null : 'unavailable',
      pve:         pve    ? null : 'unavailable',
      ups:         ups    ? null : 'unavailable',
      power:       power  ? null : 'unavailable',
      temperature: temperature ? null : 'unavailable',
      containers:  ctr    ? null : 'unavailable',
      netdata:     netdata ? null : 'unavailable',
      databases:   databases ? null : 'unavailable',
      servers:     servers ? null : 'unavailable',
      unraid:      unraid ? null : 'unavailable',
    },
  });
});

app.get('/api/cpu-history', async (req, res) => {
  const end   = Math.floor(Date.now() / 1000);
  const start = end - 30 * 60; // last 30 minutes
  const results = await promRange(
    '100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle",job="node"}[5m])))',
    start, end, 60
  );
  if (!results) return res.json(null);

  const series = results.map(r => ({
    host: stripPort(r.metric.instance),
    data: r.values.map(([ts, val]) => ({
      t: ts * 1000,
      v: Math.round(parseFloat(val) * 10) / 10,
    })),
  }));
  res.json(series);
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

app.post('/api/ask', express.json(), async (req, res) => {
  const question = (req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question required' });

  // history: array of { role: 'user'|'assistant', content: string }
  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const history = rawHistory
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content }));

  const [promResult, alertsResult, pveResult, upsAskResult] = await Promise.allSettled([
    fetchPrometheus(),
    fetchAlerts(),
    fetchProxmox(),
    fetchUps(),
  ]);
  const prom   = promResult.status      === 'fulfilled' ? promResult.value      : null;
  const alerts = alertsResult.status    === 'fulfilled' ? alertsResult.value    : [];
  const pve    = pveResult.status       === 'fulfilled' ? pveResult.value       : null;
  const ups    = upsAskResult.status    === 'fulfilled' ? upsAskResult.value    : null;

  const systemPrompt =
    `You are NOLA, a Non-Organic Lab Assistant monitoring a home network lab. ` +
    `Answer the user's question concisely based on the current lab state below. ` +
    `Be direct and specific. If something looks wrong, say so clearly. Keep answers under 3 sentences.\n\n` +
    `Current lab state:\n${buildLabContext(prom, alerts, pve, ups)}`;

  const messages = [...history, { role: 'user', content: question }];

  let response = null;
  let provider = null;

  try {
    response = await askOllama(systemPrompt, messages);
    provider = `ollama:${OLLAMA_MODEL}`;
  } catch (ollamaErr) {
    if (!LLM_FALLBACK) {
      return res.status(503).json({ error: `Ollama unavailable: ${ollamaErr.message}` });
    }
    try {
      response = await askClaude(systemPrompt, messages);
      provider = 'claude';
    } catch (claudeErr) {
      return res.status(503).json({ error: 'Both Ollama and Claude are unavailable' });
    }
  }

  res.json({ response, provider });
});

// ─── CheckCle proxy helpers ──────────────────────────────────────────────────
const ccToken = { value: null, expiry: 0 };

async function getCheckcleToken() {
  if (ccToken.value && Date.now() < ccToken.expiry) return ccToken.value;
  const res = await withTimeout(fetch(`${CHECKCLE_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: CHECKCLE_EMAIL, password: CHECKCLE_PASSWORD }),
  }), 8000);
  if (!res.ok) throw new Error(`CheckCle auth failed (${res.status})`);
  const { token } = await res.json();
  ccToken.value  = token;
  ccToken.expiry = Date.now() + 12 * 60 * 60 * 1000;
  return token;
}

async function checkcleGet(path) {
  let token = await getCheckcleToken();
  let res = await withTimeout(fetch(`${CHECKCLE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }), 8000);
  if (res.status === 401) {
    ccToken.value = null;
    token = await getCheckcleToken();
    res = await withTimeout(fetch(`${CHECKCLE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    }), 8000);
  }
  if (!res.ok) throw new Error(`CheckCle HTTP ${res.status}`);
  return res.json();
}

async function checkclePatch(path, body) {
  let token = await getCheckcleToken();
  const doReq = (t) => withTimeout(fetch(`${CHECKCLE_URL}${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), 8000);
  let res = await doReq(token);
  if (res.status === 401) {
    ccToken.value = null;
    token = await getCheckcleToken();
    res = await doReq(token);
  }
  if (!res.ok) throw new Error(`CheckCle HTTP ${res.status}`);
  return res.json();
}

// ─── AMP proxy helpers ───────────────────────────────────────────────────────
const ampState = { session: null };

async function getAMPSession() {
  if (!AMP_PROXY_URL || !AMP_USERNAME) throw new Error('AMP not configured');
  const res = await withTimeout(fetch(`${AMP_PROXY_URL}/API/Core/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: AMP_USERNAME, password: AMP_PASSWORD, token: '', rememberMe: false }),
  }), 10000);
  if (!res.ok) throw new Error(`AMP login failed (${res.status})`);
  const data = await res.json();
  if (!data.sessionID) throw new Error('AMP login returned no session');
  return data.sessionID;
}

// AMP returns HTTP 200 (not 401) with an "Unauthorized Access" body when the
// session is expired/invalid, so we must detect it in the payload and re-login.
function isAmpAuthError(data) {
  return data && !Array.isArray(data) && typeof data === 'object' &&
    (data.Title === 'Unauthorized Access' ||
     (typeof data.Message === 'string' && /session/i.test(data.Message)));
}

async function ampPost(endpoint, params = {}) {
  const doReq = async () => {
    if (!ampState.session) ampState.session = await getAMPSession();
    const res = await withTimeout(fetch(`${AMP_PROXY_URL}/API/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ SESSIONID: ampState.session, ...params }),
    }), 10000);
    if (!res.ok) throw new Error(`AMP ${endpoint} failed (${res.status})`);
    return res.json();
  };
  let data = await doReq();
  if (isAmpAuthError(data)) {        // stale session → AMP 200s with an auth-error body
    ampState.session = null;
    data = await doReq();
  }
  return data;
}

// ─── CheckCle proxy routes ───────────────────────────────────────────────────
app.get('/api/checkcle/services', async (req, res) => {
  if (!CHECKCLE_EMAIL) return res.status(503).json({ error: 'CheckCle not configured on server' });
  try {
    const data = await checkcleGet('/api/collections/services/records?perPage=200');
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/checkcle/history/:serviceId', async (req, res) => {
  if (!CHECKCLE_EMAIL) return res.status(503).json({ error: 'CheckCle not configured on server' });
  try {
    const limit = Math.min(parseInt(req.query.limit) || 60, 200);
    const data = await checkcleGet(
      `/api/collections/uptime_data/records?filter=service_id%3D'${req.params.serviceId}'&sort=-created&perPage=${limit}`
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.patch('/api/checkcle/services/:id', express.json(), async (req, res) => {
  if (!CHECKCLE_EMAIL) return res.status(503).json({ error: 'CheckCle not configured on server' });
  try {
    const data = await checkclePatch(`/api/collections/services/records/${req.params.id}`, req.body);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ─── AMP proxy routes ────────────────────────────────────────────────────────
app.get('/api/amp/instances', async (req, res) => {
  if (!AMP_PROXY_URL) return res.status(503).json({ error: 'AMP not configured on server' });
  try {
    const data = await ampPost('ADSModule/GetInstances');
    const all = [];
    for (const controller of (Array.isArray(data) ? data : [])) {
      for (const inst of (controller.AvailableInstances ?? controller.Instances ?? [])) {
        if (inst.Module !== 'ADS') all.push(inst);
      }
    }
    res.json(all);
  } catch (e) {
    ampState.session = null;
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/amp/action', express.json(), async (req, res) => {
  if (!AMP_PROXY_URL) return res.status(503).json({ error: 'AMP not configured on server' });
  const { action, instanceId } = req.body || {};
  if (!['Start', 'Stop', 'Restart'].includes(action)) {
    return res.status(400).json({ error: 'action must be Start, Stop, or Restart' });
  }
  try {
    const result = await ampPost(`ADSModule/${action}Instance`, { instanceId });
    res.json(result);
  } catch (e) {
    ampState.session = null;
    res.status(502).json({ error: e.message });
  }
});

// ─── Patch reports (homelab-patching) ───────────────────────────────────────
// Read-only view of whatever the last `nola-patch` run wrote. The reports
// directory is bind-mounted from the control host at PATCH_REPORT_DIR; if the
// mount is missing the endpoint says so instead of 500ing, so the card can
// render "no data" rather than an error.
app.get('/api/patching', async (req, res) => {
  try {
    const raw = await fsp.readFile(path.join(PATCH_REPORT_DIR, 'latest.json'), 'utf8');
    const d = JSON.parse(raw);
    const s = d.summary || {};

    // history.jsonl is one summary object per run, oldest first. It is optional:
    // a fresh control host has latest.json before it has any history worth showing.
    let history = [];
    try {
      const lines = (await fsp.readFile(path.join(PATCH_REPORT_DIR, 'history.jsonl'), 'utf8'))
        .split('\n').filter(Boolean);
      history = lines.slice(-10).map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean)
        .map(h => ({
          timestamp: h.timestamp, mode: h.mode,
          pending: h.total_pending_packages ?? 0, security: h.total_security_packages ?? 0,
          updated: h.updated ?? 0, rebooted: h.rebooted ?? 0,
          failed: h.failed ?? 0, unreachable: h.unreachable ?? 0,
        }))
        .reverse();
    } catch { /* no history yet */ }

    const ts = s.timestamp ? Date.parse(s.timestamp) : null;
    res.json({
      ok: true,
      timestamp: s.timestamp ?? null,
      age_hours: ts ? +((Date.now() - ts) / 3.6e6).toFixed(1) : null,
      mode: s.mode ?? null,
      totals: {
        hosts: s.total ?? 0,
        pending_packages: s.total_pending_packages ?? 0,
        security_packages: s.total_security_packages ?? 0,
        reboot_pending: s.reboot_pending ?? 0,
        updated: s.updated ?? 0,
        rebooted: s.rebooted ?? 0,
        failed: s.failed ?? 0,
        unreachable: s.unreachable ?? 0,
        clean: s.clean ?? 0,
      },
      hosts: (d.hosts || []).map(h => ({
        host: h.host,
        status: h.status ?? 'unknown',
        os: h.os ?? null,
        kernel: h.kernel_after ?? h.kernel_before ?? null,
        pending: h.pending_count ?? 0,
        security: h.security_count ?? 0,
        reboot_required: !!h.reboot_required,
        error: h.error ? String(h.error).slice(0, 300) : null,
        packages: (h.pending || []).slice(0, 25),
      })),
      history,
    });
  } catch (e) {
    // ENOENT = no run yet, or the reports volume is not mounted.
    if (e.code === 'ENOENT') return res.json({ ok: false, error: 'no patch report yet', hosts: [], history: [] });
    res.status(502).json({ ok: false, error: e.message, hosts: [], history: [] });
  }
});

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.listen(PORT, () => console.log(`[nola] dashboard listening on :${PORT}`));
