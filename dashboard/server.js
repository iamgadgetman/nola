require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://10.0.11.69:9090';
const GRAFANA_URL    = process.env.GRAFANA_URL    || 'http://10.0.11.70:3000';
const GRAFANA_TOKEN  = process.env.GRAFANA_TOKEN  || '';
const LIBRENMS_URL   = process.env.LIBRENMS_URL   || 'http://10.0.19.97:8000';
const LIBRENMS_TOKEN = process.env.LIBRENMS_TOKEN || '';
const INFLUXDB_DS_UID = process.env.INFLUXDB_DATASOURCE_UID || 'P951FEA4DE68E13C5';
const INFLUXDB_URL   = process.env.INFLUXDB_URL   || 'http://10.0.11.74:8086';
const INFLUXDB_TOKEN = process.env.INFLUXDB_TOKEN;
const INFLUXDB_ORG   = process.env.INFLUXDB_ORG   || 'galaxy';
const INFLUXDB_BUCKET = process.env.INFLUXDB_BUCKET || 'opnsense';
// WAN interface name on both OPNsense firewalls (verified: em0 is highest-traffic iface)
const WAN_INTERFACE  = process.env.WAN_INTERFACE  || 'em0';

// ─── LLM Config ─────────────────────────────────────────────────────────────
const OLLAMA_URL    = process.env.OLLAMA_URL    || 'http://10.0.11.25:11434';
const OLLAMA_MODEL  = process.env.OLLAMA_MODEL  || 'llama3.2:3b';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
// Set LLM_FALLBACK=false to disable Claude fallback and only use Ollama
const LLM_FALLBACK  = process.env.LLM_FALLBACK  !== 'false';

const LINUX_HOSTS = (process.env.LINUX_HOSTS || 'containy,voyager,knox,dilithium,amp-server').split(',').map(h => h.trim());
const FW_HOSTS    = (process.env.FW_HOSTS    || 'fort-opnsense,hawk-opnsense').split(',').map(h => h.trim());
const FW_DISPLAY  = { 'fort-opnsense': 'fort', 'hawk-opnsense': 'hawk' };

// ─── Auth middleware ────────────────────────────────────────────────────────
// Two supported modes (both require AUTH_ENABLED=true):
//   1. Bearer token — set API_TOKEN; clients send "Authorization: Bearer <token>"
//   2. OAuth2 proxy — leave API_TOKEN unset; validated user arrives in X-Forwarded-User
const API_TOKEN = process.env.API_TOKEN || '';

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
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return promise.finally(() => clearTimeout(t));
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
  const [upNode, upFw, cpu, ram, disk, dlBits, ulBits, bans] = await Promise.all([
    promQuery('up{job="node"}'),
    promQuery('up{job="opnsense_node"}'),
    promQuery('100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle",job="node"}[5m])))'),
    promQuery('(1 - node_memory_MemAvailable_bytes{job="node"} / node_memory_MemTotal_bytes{job="node"}) * 100'),
    promQuery('(node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs",job="node"} - node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs",job="node"}) / node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs",job="node"} * 100'),
    promQuery('speedtest_tracker_download_bits'),
    promQuery('speedtest_tracker_upload_bits'),
    promQuery('sum(cs_active_decisions{action="ban"})'),
  ]);

  const upMap  = vectorToMap(upNode);
  const fwMap  = vectorToMap(upFw);
  const cpuMap = vectorToMap(cpu);
  const ramMap = vectorToMap(ram);
  const diskMap = vectorToMap(disk);

  const round1 = v => v != null ? Math.round(v * 10) / 10 : null;

  const hosts = [
    ...LINUX_HOSTS.map(name => ({
      name,
      type: 'linux',
      up: upMap[name] === 1,
      cpu_pct:  round1(cpuMap[name]),
      ram_pct:  round1(ramMap[name]),
      disk_pct: round1(diskMap[name]),
    })),
    ...FW_HOSTS.map(name => ({
      name: FW_DISPLAY[name] || name,
      instance: name,
      type: 'firewall',
      up: fwMap[name] === 1,
      cpu_pct: null, ram_pct: null, disk_pct: null,
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
    crowdsec: {
      active_bans: bans?.[0]?.value[1] ? parseInt(bans[0].value[1]) : 0,
    },
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
  // Both halt.galaxy.rip and stop.galaxy.rip use em0 as the WAN interface (verified).
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
        host: h.replace('.galaxy.rip', '').replace('.universe', ''),
        rx_mbps: byHost[h].rx_mbps,
        tx_mbps: byHost[h].tx_mbps,
      })),
    };
  } catch {
    return null;
  }
}

// ─── LLM helpers ────────────────────────────────────────────────────────────
function buildLabContext(prom, alerts) {
  const lines = [];

  if (prom?.hosts?.length) {
    const up   = prom.hosts.filter(h => h.up).length;
    const down = prom.hosts.filter(h => !h.up);
    lines.push(`Hosts: ${up}/${prom.hosts.length} online`);
    if (down.length) lines.push(`  Offline: ${down.map(h => h.name).join(', ')}`);
    for (const h of prom.hosts) {
      if (h.cpu_pct != null)
        lines.push(`  ${h.name}: CPU ${h.cpu_pct}% | RAM ${h.ram_pct}% | Disk ${h.disk_pct}%`);
    }
  }

  if (prom?.speedtests?.length) {
    for (const s of prom.speedtests) {
      const isp = s.isp ? ` (${s.isp})` : '';
      lines.push(`Internet (${s.site}): ↓${s.download_mbps ?? '?'} Mbps ↑${s.upload_mbps ?? '?'} Mbps${isp}`);
    }
  }

  lines.push(`CrowdSec active bans: ${prom?.crowdsec?.active_bans ?? '?'}`);

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

async function askOllama(systemPrompt, question) {
  const res = await withTimeout(fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    OLLAMA_MODEL,
      stream:   false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: question },
      ],
    }),
  }), 30000);
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const json = await res.json();
  const text = json.message?.content?.trim();
  if (!text) throw new Error('Empty response from Ollama');
  return text;
}

async function askClaude(systemPrompt, question) {
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
      messages:   [{ role: 'user', content: question }],
    }),
  }), 15000);
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
  const json = await res.json();
  const text = json.content?.[0]?.text?.trim();
  if (!text) throw new Error('Empty response from Claude');
  return text;
}

// ─── Routes ─────────────────────────────────────────────────────────────────
app.get('/api/data', async (req, res) => {
  const [promResult, alertsResult, wanResult] = await Promise.allSettled([
    fetchPrometheus(),
    fetchAlerts(),
    fetchWan(),
  ]);

  const prom   = promResult.status   === 'fulfilled' ? promResult.value   : null;
  const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value : [];
  const wan    = wanResult.status    === 'fulfilled' ? wanResult.value    : null;

  res.json({
    timestamp: new Date().toISOString(),
    hosts:      prom?.hosts      || [],
    speedtests: prom?.speedtests || [],
    crowdsec:  prom?.crowdsec  || { active_bans: 0 },
    alerts,
    wan,
    errors: {
      prometheus: prom   ? null : 'fetch failed',
      alerts:     alertsResult.status === 'rejected' ? 'fetch failed' : null,
      wan:        wan    ? null : 'unavailable',
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

  const [promResult, alertsResult] = await Promise.allSettled([
    fetchPrometheus(),
    fetchAlerts(),
  ]);
  const prom   = promResult.status   === 'fulfilled' ? promResult.value   : null;
  const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value : [];

  const systemPrompt =
    `You are NOLA, a Non-Organic Lab Assistant monitoring a home network lab. ` +
    `Answer the user's question concisely based on the current lab state below. ` +
    `Be direct and specific. If something looks wrong, say so clearly. Keep answers under 3 sentences.\n\n` +
    `Current lab state:\n${buildLabContext(prom, alerts)}`;

  let response = null;
  let provider = null;

  try {
    response = await askOllama(systemPrompt, question);
    provider = `ollama:${OLLAMA_MODEL}`;
  } catch (ollamaErr) {
    if (!LLM_FALLBACK) {
      return res.status(503).json({ error: `Ollama unavailable: ${ollamaErr.message}` });
    }
    try {
      response = await askClaude(systemPrompt, question);
      provider = 'claude';
    } catch (claudeErr) {
      return res.status(503).json({ error: 'Both Ollama and Claude are unavailable' });
    }
  }

  res.json({ response, provider });
});

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.listen(PORT, () => console.log(`[nola] dashboard listening on :${PORT}`));
