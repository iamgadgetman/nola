// ═══════════════════════════════════════════════════════════
//  N.O.L.A. Dashboard — Main App
// ═══════════════════════════════════════════════════════════

const GRAFANA_BASE   = 'http://10.0.11.70:3000';
const LIBRENMS_BASE  = 'http://10.0.19.97:8000';
const REFRESH_MS     = 30_000;
const KIOSK_DURATIONS = [15000, 12000, 12000, 12000]; // ms per slide

let state       = null;
let cpuChart    = null;
let wanChart    = null;
let kioskActive = false;
let kioskSlide  = 0;
let kioskProgressTimer = null;
let progressStart = 0;
let progressDuration = 0;

// ─── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  initAsk();

  // Check for ?kiosk param
  if (new URLSearchParams(window.location.search).has('kiosk')) {
    enterKioskMode();
  }

  loadData();
  setInterval(loadData, REFRESH_MS);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && kioskActive) exitKioskMode();
    if (e.key === 'ArrowRight' && kioskActive) advanceKioskSlide();
    if (e.key === 'ArrowLeft'  && kioskActive) retreatKioskSlide();
  });
});

// ─── Clock ───────────────────────────────────────────────
function startClock() {
  const tick = () => {
    const now = new Date();
    const fmt = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const el = document.getElementById('clock');
    if (el) el.textContent = fmt;
    const kel = document.getElementById('kiosk-clock');
    if (kel) kel.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 1000);
}

// ─── Data loading ────────────────────────────────────────
async function loadData() {
  try {
    const [dataRes, histRes] = await Promise.all([
      fetch('/api/data'),
      fetch('/api/cpu-history'),
    ]);
    state = await dataRes.json();
    const history = histRes.ok ? await histRes.json() : null;

    renderDashboard(state);
    renderCpuChart(history);
    renderWanChart(state.wan);
    if (kioskActive) renderKiosk(state);
  } catch (err) {
    console.error('[nola] data fetch error:', err);
  }
}

// ─── Dashboard rendering ─────────────────────────────────
function renderDashboard(d) {
  renderHosts(d.hosts);
  renderSpeedtests(d.speedtests);
  renderCrowdsec(d.crowdsec);
  renderAlerts(d.alerts);
  renderProxmox(d.pve);
  renderContainers(d.containers);
  updateSummary(d);
  document.getElementById('last-updated').textContent =
    `Updated ${new Date(d.timestamp).toLocaleTimeString()}`;
}

function renderHosts(hosts) {
  const strip = document.getElementById('host-strip');
  if (!hosts?.length) { strip.innerHTML = '<div class="loading-placeholder">No host data</div>'; return; }

  strip.innerHTML = hosts.map(h => {
    const cls = h.up ? 'up' : 'down';
    const typeBadge = h.type === 'firewall'
      ? `<span class="host-type-badge fw">FW</span>`
      : h.type === 'proxmox'
      ? `<span class="host-type-badge pve">PVE</span>`
      : `<span class="host-type-badge">node</span>`;

    const gauges = (h.cpu_pct != null || h.ram_pct != null || h.disk_pct != null)
      ? `<div class="mini-gauges">
          ${miniGauge('CPU', h.cpu_pct, 'cpu')}
          ${miniGauge('RAM', h.ram_pct, 'ram')}
          ${miniGauge('DSK', h.disk_pct, 'disk')}
        </div>`
      : `<div class="host-na-text">SNMP / OPNsense</div>`;

    return `<div class="host-card ${cls}">
      <div class="host-card__top">
        <div class="host-status-dot"></div>
        <span class="host-name">${h.name}</span>
        ${typeBadge}
      </div>
      ${gauges}
    </div>`;
  }).join('');
}

function miniGauge(label, val, cls) {
  const pct = val != null ? Math.min(Math.max(val, 0), 100) : 0;
  const display = val != null ? val.toFixed(0) + '%' : '—';
  let fillCls = cls;
  if (val != null && val >= 90) fillCls += ' high-fill';
  return `<div class="mini-gauge-row">
    <span class="mini-gauge-label">${label}</span>
    <div class="mini-gauge-bar"><div class="mini-gauge-fill ${fillCls}" style="width:${pct}%"></div></div>
    <span class="mini-gauge-val">${display}</span>
  </div>`;
}

function renderSpeedtests(speedtests) {
  const container = document.getElementById('speed-cards-container');
  if (!container) return;
  if (!speedtests?.length) {
    container.innerHTML = `<div class="speed-no-data">No speedtest data</div>`;
    return;
  }
  container.innerHTML = speedtests.map(s => `
    <div class="speed-site-block">
      <div class="speed-site-header">
        <span class="speed-site-name">${escHtml(s.site)}</span>
        ${s.isp ? `<span class="speed-site-isp">${escHtml(s.isp)}</span>` : ''}
      </div>
      <div class="speed-stats">
        <div class="speed-stat">
          <span class="speed-arrow down-arrow">↓</span>
          <span class="speed-value">${s.download_mbps ?? '—'}</span>
          <span class="speed-unit">Mbps</span>
        </div>
        <div class="speed-stat">
          <span class="speed-arrow up-arrow">↑</span>
          <span class="speed-value">${s.upload_mbps ?? '—'}</span>
          <span class="speed-unit">Mbps</span>
        </div>
      </div>
    </div>
  `).join('<div class="speed-divider"></div>');
}

function renderCrowdsec(cs) {
  const el = document.getElementById('crowdsec-count');
  el.textContent = cs?.active_bans ?? '—';
  const val = cs?.active_bans ?? 0;
  el.style.color = val > 500 ? 'var(--crit)' : val > 100 ? 'var(--warn)' : 'var(--ok)';
}

function renderAlerts(alerts) {
  const list   = document.getElementById('alerts-list');
  const badge  = document.getElementById('alert-count-badge');
  const cardEl = document.getElementById('card-alerts');

  if (!alerts?.length) {
    badge.textContent = '0';
    badge.className = 'nola-card__badge';
    cardEl.style.borderColor = '';
    list.innerHTML = `<div class="all-clear"><div class="all-clear-icon">✓</div><span>All Clear</span></div>`;
    return;
  }

  badge.textContent = alerts.length;
  const hasCrit = alerts.some(a => a.severity === 'critical');
  badge.className = 'nola-card__badge ' + (hasCrit ? 'crit' : 'warn');
  cardEl.style.borderColor = hasCrit ? 'var(--crit)' : 'var(--warn)';

  list.innerHTML = alerts.map(a => {
    const cls = a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info';
    const ago = firingAgo(a.firing_since);
    return `<div class="alert-item ${cls}">
      <span class="alert-sev">${a.severity}</span>
      <div class="alert-info">
        <div class="alert-name">${escHtml(a.name)}</div>
        ${a.summary ? `<div class="alert-summary">${escHtml(a.summary)}</div>` : ''}
        <div class="alert-time">firing for ${ago}</div>
      </div>
    </div>`;
  }).join('');
}

// ─── Proxmox Card ────────────────────────────────────────
function renderProxmox(pve) {
  const card = document.getElementById('card-pve');
  if (!card) return;

  if (!pve) {
    card.style.opacity = '0.4';
    return;
  }
  card.style.opacity = '';

  // Version badge
  const verBadge = document.getElementById('pve-version-badge');
  if (verBadge) verBadge.textContent = pve.node.version ? `PVE ${pve.node.version}` : 'PVE';

  // Node summary row
  const cpuEl = document.getElementById('pve-node-cpu');
  const memEl = document.getElementById('pve-node-mem');
  const upEl  = document.getElementById('pve-node-uptime');
  if (cpuEl) cpuEl.textContent = `CPU ${pve.node.cpu_pct ?? '—'}%`;
  if (memEl) memEl.textContent = `RAM ${pve.node.mem_used_gb ?? '—'} / ${pve.node.mem_total_gb ?? '—'} GB`;
  if (upEl)  upEl.textContent  = `up ${pve.node.uptime ?? '—'}`;

  // VM list
  const vmList = document.getElementById('pve-vm-list');
  if (vmList) {
    if (!pve.vms?.length) {
      vmList.innerHTML = '<div class="pve-empty">No VMs</div>';
    } else {
      vmList.innerHTML = pve.vms.map(vm => {
        const running = vm.status === 'running';
        const statusCls = running ? 'pve-vm-dot running' : 'pve-vm-dot stopped';
        const cpuBar = pveBar(vm.cpu_pct, 100, running ? '' : 'dim');
        const memPct = vm.mem_total_gb > 0 ? (vm.mem_used_gb / vm.mem_total_gb * 100) : 0;
        const memBar = pveBar(memPct, 100, running ? 'mem' : 'dim');
        return `<div class="pve-vm-row">
          <span class="${statusCls}"></span>
          <span class="pve-vm-name">${escHtml(vm.name)}</span>
          <span class="pve-vm-vmid">${vm.vmid}</span>
          <div class="pve-vm-metrics">
            <div class="pve-metric-row">
              <span class="pve-metric-label">CPU</span>
              ${cpuBar}
              <span class="pve-metric-val">${vm.cpu_pct ?? '—'}%</span>
            </div>
            <div class="pve-metric-row">
              <span class="pve-metric-label">RAM</span>
              ${memBar}
              <span class="pve-metric-val">${vm.mem_used_gb ?? '—'} / ${vm.mem_total_gb ?? '—'} GB</span>
            </div>
          </div>
          ${vm.uptime ? `<span class="pve-vm-uptime">↑${vm.uptime}</span>` : ''}
        </div>`;
      }).join('');
    }
  }

  // Storage list
  const storList = document.getElementById('pve-storage-list');
  if (storList) {
    if (!pve.storage?.length) {
      storList.innerHTML = '<div class="pve-empty">No storage data</div>';
    } else {
      storList.innerHTML = pve.storage.map(s => {
        const warnCls = s.pct >= 90 ? 'high' : s.pct >= 75 ? 'warn' : '';
        return `<div class="pve-stor-row">
          <div class="pve-stor-header">
            <span class="pve-stor-name">${escHtml(s.name)}</span>
            <span class="pve-stor-type">${escHtml(s.type)}</span>
            <span class="pve-stor-pct ${warnCls}">${s.pct}%</span>
          </div>
          <div class="pve-stor-bar-wrap">
            <div class="pve-stor-bar-fill ${warnCls}" style="width:${Math.min(s.pct, 100)}%"></div>
          </div>
          <div class="pve-stor-sizes">${s.used_gb} / ${s.total_gb} GB</div>
        </div>`;
      }).join('');
    }
  }
}

// ─── Container Stats Card ─────────────────────────────────
function renderContainers(containers) {
  const section = document.getElementById('containers-section');
  const grid    = document.getElementById('containers-grid');
  if (!section || !grid) return;

  if (!containers?.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  grid.innerHTML = containers.map(h => `
    <div class="container-host-col">
      <div class="container-host-label">${escHtml(h.host)}</div>
      ${h.containers.map(c => {
        const cpuPct = Math.min(c.cpu_pct ?? 0, 100);
        const memPct = (c.mem_limit_mb > 0)
          ? Math.min((c.mem_mb / c.mem_limit_mb) * 100, 100) : 0;
        const memVal = c.mem_limit_mb
          ? `${c.mem_mb ?? '—'}/${c.mem_limit_mb}M`
          : `${c.mem_mb ?? '—'}M`;
        return `<div class="container-row">
          <div class="container-name">${escHtml(c.name)}</div>
          <div class="container-metrics">
            <div class="container-metric">
              <span class="container-metric-label">CPU</span>
              <div class="mini-gauge-bar"><div class="mini-gauge-fill cpu" style="width:${cpuPct}%"></div></div>
              <span class="container-metric-val">${c.cpu_pct != null ? c.cpu_pct.toFixed(1) + '%' : '—'}</span>
            </div>
            <div class="container-metric">
              <span class="container-metric-label">MEM</span>
              <div class="mini-gauge-bar"><div class="mini-gauge-fill ram" style="width:${memPct}%"></div></div>
              <span class="container-metric-val">${memVal}</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `).join('');
}

function pveBar(val, max, cls) {
  const pct = val != null ? Math.min(Math.max(val / max * 100, 0), 100) : 0;
  return `<div class="pve-bar"><div class="pve-bar-fill ${cls}" style="width:${pct}%"></div></div>`;
}

function updateSummary(d) {
  const total = d.hosts?.length ?? 0;
  const up    = d.hosts?.filter(h => h.up).length ?? 0;
  const summEl = document.getElementById('host-summary');
  summEl.textContent = `${up}/${total} hosts up`;
  summEl.style.color = up < total ? 'var(--crit)' : 'var(--ok)';

  const alertEl = document.getElementById('alert-summary');
  const n = d.alerts?.length ?? 0;
  alertEl.textContent = n ? `⚠ ${n} alert${n !== 1 ? 's' : ''} firing` : '';
}

// ─── CPU History Chart ───────────────────────────────────
const HOST_COLORS = [
  '#00e5ff', '#a78bfa', '#10d070', '#ffab00',
  '#ff6b9d', '#4ecdc4', '#ff9f43',
];

function renderCpuChart(series) {
  const canvas = document.getElementById('cpu-chart');
  if (!canvas) return;

  if (!series?.length) {
    if (cpuChart) { cpuChart.destroy(); cpuChart = null; }
    return;
  }

  // Build labels from the first series timestamps
  const labels = series[0].data.map(p =>
    new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );

  const datasets = series.map((s, i) => ({
    label: s.host,
    data: s.data.map(p => p.v),
    borderColor: HOST_COLORS[i % HOST_COLORS.length],
    backgroundColor: hexAlpha(HOST_COLORS[i % HOST_COLORS.length], 0.08),
    borderWidth: 1.5,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.3,
    fill: false,
  }));

  if (cpuChart) {
    cpuChart.data.labels = labels;
    cpuChart.data.datasets = datasets;
    cpuChart.update('none');
    return;
  }

  cpuChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: '#94a3b8',
            font: { family: "'JetBrains Mono', monospace", size: 11 },
            boxWidth: 12,
            padding: 16,
          }
        },
        tooltip: {
          backgroundColor: '#0d1117',
          borderColor: '#1a2640',
          borderWidth: 1,
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 10 },
          grid:  { color: 'rgba(255,255,255,0.03)' },
          border: { color: '#1a2640' },
        },
        y: {
          min: 0, max: 100,
          ticks: {
            color: '#64748b',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            callback: v => v + '%',
          },
          grid:  { color: 'rgba(255,255,255,0.04)' },
          border: { color: '#1a2640' },
        },
      },
    },
  });
}

// ─── WAN Traffic Chart ───────────────────────────────────
// Colors per host: halt=cyan, stop=purple; rx=solid, tx=dashed
const WAN_COLORS = ['#00e5ff', '#a78bfa', '#10d070', '#ffab00'];

function renderWanChart(wan) {
  const canvas = document.getElementById('wan-chart');
  const card   = document.getElementById('card-wan');
  if (!canvas) return;

  if (!wan?.series?.length) {
    if (wanChart) { wanChart.destroy(); wanChart = null; }
    if (card) card.style.opacity = '0.4';
    return;
  }
  if (card) card.style.opacity = '';

  const datasets = [];
  wan.series.forEach((s, i) => {
    const color = WAN_COLORS[i % WAN_COLORS.length];
    datasets.push({
      label: `${s.host} ↓`,
      data: s.rx_mbps,
      borderColor: color,
      backgroundColor: hexAlpha(color, 0.10),
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.3,
      fill: true,
      borderDash: [],
    });
    datasets.push({
      label: `${s.host} ↑`,
      data: s.tx_mbps,
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.3,
      fill: false,
      borderDash: [4, 3],
    });
  });

  if (wanChart) {
    wanChart.data.labels   = wan.labels;
    wanChart.data.datasets = datasets;
    wanChart.update('none');
    return;
  }

  wanChart = new Chart(canvas, {
    type: 'line',
    data: { labels: wan.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: '#94a3b8',
            font: { family: "'JetBrains Mono', monospace", size: 11 },
            boxWidth: 12,
            padding: 14,
          },
        },
        tooltip: {
          backgroundColor: '#0d1117',
          borderColor: '#1a2640',
          borderWidth: 1,
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} Mbps` },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 8 },
          grid:  { color: 'rgba(255,255,255,0.03)' },
          border: { color: '#1a2640' },
        },
        y: {
          min: 0,
          ticks: {
            color: '#64748b',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            callback: v => v + ' M',
          },
          grid:  { color: 'rgba(255,255,255,0.04)' },
          border: { color: '#1a2640' },
        },
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════
//  KIOSK MODE
// ═══════════════════════════════════════════════════════════

function enterKioskMode() {
  kioskActive = true;
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('kiosk').style.display = 'flex';
  kioskSlide = 0;
  if (state) renderKiosk(state);
  activateSlide(0);
  document.documentElement.style.cursor = 'none';
  history.replaceState(null, '', '?kiosk');
}

function exitKioskMode() {
  kioskActive = false;
  clearKioskTimers();
  document.getElementById('kiosk').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
  document.documentElement.style.cursor = '';
  history.replaceState(null, '', '/');
}

// Expose globally for HTML onclick
window.enterKioskMode = enterKioskMode;
window.exitKioskMode  = exitKioskMode;
window.jumpKioskSlide = (n) => { activateSlide(n); };

function activateSlide(n) {
  clearKioskTimers();
  const prev = kioskSlide;
  kioskSlide = n;

  // Transition
  const prevEl = document.getElementById(`kslide-${prev}`);
  const nextEl = document.getElementById(`kslide-${n}`);
  if (prevEl && prev !== n) {
    prevEl.classList.add('exit');
    setTimeout(() => { prevEl.classList.remove('active', 'exit'); }, 350);
  }
  if (nextEl) {
    nextEl.classList.add('active');
    nextEl.classList.remove('exit');
  }

  // Update dots
  document.querySelectorAll('.kiosk-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === n);
  });

  startKioskProgress(KIOSK_DURATIONS[n]);
}

function advanceKioskSlide() {
  activateSlide((kioskSlide + 1) % KIOSK_DURATIONS.length);
}
function retreatKioskSlide() {
  activateSlide((kioskSlide - 1 + KIOSK_DURATIONS.length) % KIOSK_DURATIONS.length);
}

function startKioskProgress(duration) {
  const bar = document.getElementById('kiosk-progress');
  if (!bar) return;
  progressStart    = performance.now();
  progressDuration = duration;
  bar.style.width  = '0%';

  kioskProgressTimer = setInterval(() => {
    const elapsed = performance.now() - progressStart;
    const pct = Math.min((elapsed / progressDuration) * 100, 100);
    bar.style.width = pct + '%';
    if (elapsed >= progressDuration) {
      clearInterval(kioskProgressTimer);
      advanceKioskSlide();
    }
  }, 120);
}

function clearKioskTimers() {
  clearInterval(kioskProgressTimer);
  const bar = document.getElementById('kiosk-progress');
  if (bar) bar.style.width = '0%';
}

// ─── Kiosk render ─────────────────────────────────────────
function renderKiosk(d) {
  renderKioskHosts(d.hosts);
  renderKioskPerf(d);
  renderKioskAlerts(d.alerts);
  renderKioskPve(d.pve);
}

function renderKioskHosts(hosts) {
  const grid = document.getElementById('kiosk-hosts');
  const summ = document.getElementById('kiosk-host-summary');
  if (!hosts?.length) { grid.innerHTML = ''; return; }

  grid.innerHTML = hosts.map(h => {
    const cls = h.up ? 'up' : 'down';
    const pill = h.up ? 'UP' : 'DOWN';
    const gauges = (h.cpu_pct != null) ? `
      <div class="khost-gauges">
        ${kioskGauge('CPU', h.cpu_pct, 'cpu')}
        ${kioskGauge('RAM', h.ram_pct, 'ram')}
        ${kioskGauge('DSK', h.disk_pct, 'disk')}
      </div>` : h.type === 'proxmox'
      ? `<div style="font-size:0.75rem;color:var(--text-muted)">Proxmox VE</div>`
      : `<div style="font-size:0.75rem;color:var(--text-muted)">OPNsense Firewall</div>`;
    return `<div class="kiosk-host-card ${cls}">
      <div class="khost-top">
        <span class="khost-status-pill">${pill}</span>
        <span class="khost-name">${h.name}</span>
      </div>
      ${gauges}
    </div>`;
  }).join('');

  const total = hosts.length;
  const up    = hosts.filter(h => h.up).length;
  summ.textContent = `${up} of ${total} hosts online`;
  summ.style.color = up < total ? 'var(--crit)' : 'var(--ok)';
}

function kioskGauge(label, val, cls) {
  const pct = val != null ? Math.min(Math.max(val, 0), 100) : 0;
  const display = val != null ? val.toFixed(0) + '%' : '—';
  return `<div class="khost-gauge-row">
    <span class="khost-gauge-label">${label}</span>
    <div class="khost-gauge-bar"><div class="khost-gauge-fill ${cls}" style="width:${pct}%"></div></div>
    <span class="khost-gauge-val">${display}</span>
  </div>`;
}

function renderKioskPerf(d) {
  // Render speedtest blocks per site
  const speedContainer = document.getElementById('k-speed-blocks');
  if (speedContainer && d.speedtests?.length) {
    speedContainer.innerHTML = d.speedtests.map(s => `
      <div class="kperf-block">
        <div class="kperf-label">↓ ${escHtml(s.site)} DL</div>
        <div class="kperf-value cyan">${s.download_mbps ?? '—'}</div>
        <div class="kperf-unit">${s.isp ? escHtml(s.isp) : 'Mbps'}</div>
      </div>
      <div class="kperf-block">
        <div class="kperf-label">↑ ${escHtml(s.site)} UL</div>
        <div class="kperf-value purple">${s.upload_mbps ?? '—'}</div>
        <div class="kperf-unit">Mbps</div>
      </div>
    `).join('');
  }
  document.getElementById('k-bans').textContent = d.crowdsec?.active_bans ?? '—';

  // Top resource consumers
  const topHosts = document.getElementById('k-top-hosts');
  if (d.hosts?.length) {
    const byCpu = [...d.hosts].filter(h => h.cpu_pct != null).sort((a,b) => b.cpu_pct - a.cpu_pct);
    topHosts.innerHTML = byCpu.slice(0, 5).map(h =>
      `<div class="k-top-host-item">
        <span class="k-top-badge">CPU ${h.cpu_pct.toFixed(0)}%</span>
        <span>${h.name}</span>
       </div>`
    ).join('');
  }
}

function renderKioskAlerts(alerts) {
  const acEl   = document.getElementById('kiosk-all-clear');
  const listEl = document.getElementById('kiosk-alert-list');
  if (!alerts?.length) {
    acEl.style.display   = '';
    listEl.style.display = 'none';
    return;
  }
  acEl.style.display   = 'none';
  listEl.style.display = '';
  listEl.innerHTML = alerts.map(a => {
    const cls = a.severity === 'critical' ? 'critical' : 'warning';
    return `<div class="kiosk-alert-item ${cls}">
      <span class="k-alert-sev">${a.severity}</span>
      <div>
        <div class="k-alert-name">${escHtml(a.name)}</div>
        ${a.summary ? `<div class="k-alert-summary">${escHtml(a.summary)}</div>` : ''}
        <div class="k-alert-time">firing for ${firingAgo(a.firing_since)}</div>
      </div>
    </div>`;
  }).join('');
}

function renderKioskPve(pve) {
  const verEl      = document.getElementById('k-pve-version');
  const nodeEl     = document.getElementById('k-pve-node-stats');
  const vmsEl      = document.getElementById('k-pve-vms');
  const storageEl  = document.getElementById('k-pve-storage');

  if (!pve) {
    if (verEl)  verEl.textContent  = '—';
    if (nodeEl) nodeEl.textContent = 'Proxmox data unavailable';
    return;
  }

  const n = pve.node;
  if (verEl)  verEl.textContent  = `PVE ${n.version ?? ''}`;
  if (nodeEl) nodeEl.innerHTML =
    `<span>CPU <strong>${n.cpu_pct}%</strong></span>` +
    `<span class="k-pve-sep">·</span>` +
    `<span>RAM <strong>${n.mem_used_gb} / ${n.mem_total_gb} GB</strong></span>` +
    `<span class="k-pve-sep">·</span>` +
    `<span>up <strong>${n.uptime}</strong></span>`;

  if (vmsEl) {
    if (!pve.vms?.length) {
      vmsEl.innerHTML = '<div class="k-pve-empty">No VMs</div>';
    } else {
      vmsEl.innerHTML = pve.vms.map(vm => {
        const running = vm.status === 'running';
        const dotCls  = running ? 'k-pve-dot running' : 'k-pve-dot stopped';
        const memPct  = vm.mem_total_gb > 0 ? Math.round(vm.mem_used_gb / vm.mem_total_gb * 100) : 0;
        return `<div class="k-pve-vm-row">
          <span class="${dotCls}"></span>
          <span class="k-pve-vm-name">${escHtml(vm.name)}</span>
          <span class="k-pve-vm-stat">CPU ${vm.cpu_pct}%</span>
          <div class="k-pve-bar"><div class="k-pve-bar-fill" style="width:${memPct}%"></div></div>
          <span class="k-pve-vm-stat">${vm.mem_used_gb}/${vm.mem_total_gb} GB</span>
        </div>`;
      }).join('');
    }
  }

  if (storageEl) {
    if (!pve.storage?.length) {
      storageEl.innerHTML = '<div class="k-pve-empty">No storage data</div>';
    } else {
      storageEl.innerHTML = pve.storage.map(s => {
        const warnCls = s.pct >= 90 ? 'high' : s.pct >= 75 ? 'warn' : '';
        return `<div class="k-pve-stor-row">
          <div class="k-pve-stor-header">
            <span class="k-pve-stor-name">${escHtml(s.name)}</span>
            <span class="k-pve-stor-pct ${warnCls}">${s.pct}%</span>
          </div>
          <div class="k-pve-stor-bar-wrap">
            <div class="k-pve-stor-bar-fill ${warnCls}" style="width:${Math.min(s.pct,100)}%"></div>
          </div>
          <div class="k-pve-stor-sizes">${s.used_gb} / ${s.total_gb} GB</div>
        </div>`;
      }).join('');
    }
  }
}

// ─── Utilities ───────────────────────────────────────────
function firingAgo(isoStr) {
  if (!isoStr) return '?';
  const ms = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function escHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Ask NOLA ────────────────────────────────────────────────
function initAsk() {
  const input = document.getElementById('ask-input');
  if (!input) return;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submitAsk(); });
}

async function submitAsk() {
  const input      = document.getElementById('ask-input');
  const responseEl = document.getElementById('ask-response');
  const btn        = document.getElementById('ask-btn');
  const provEl     = document.getElementById('ask-provider');

  const question = input?.value?.trim();
  if (!question) return;

  btn.disabled = true;
  responseEl.className = 'ask-response ask-thinking';
  responseEl.textContent = 'Thinking…';
  provEl.style.display = 'none';

  try {
    const res  = await fetch('/api/ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      responseEl.className = 'ask-response ask-error';
      responseEl.textContent = data.error || 'Request failed';
    } else {
      responseEl.className = 'ask-response ask-done';
      responseEl.textContent = data.response;
      if (data.provider) {
        provEl.textContent   = data.provider;
        provEl.style.display = '';
      }
    }
  } catch {
    responseEl.className = 'ask-response ask-error';
    responseEl.textContent = 'Network error — is the dashboard server running?';
  } finally {
    btn.disabled = false;
  }
}

window.submitAsk = submitAsk;
