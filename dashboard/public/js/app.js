// ═══════════════════════════════════════════════════════════
//  N.O.L.A. Dashboard — Main App
// ═══════════════════════════════════════════════════════════

const GRAFANA_BASE   = 'http://10.0.5.31:3000';
const LIBRENMS_BASE  = 'http://10.0.6.97:8000';
const REFRESH_MS     = 30_000;
const KIOSK_DURATIONS = [15000, 12000, 12000, 12000, 12000, 12000, 12000, 12000]; // ms per slide

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
  initNav();

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

// ─── Page navigation ─────────────────────────────────────
const PAGES = ['home', 'infra', 'storage', 'network', 'power', 'security'];

function showPage(name) {
  if (!PAGES.includes(name)) name = 'home';
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === 'page-' + name));
  document.querySelectorAll('.nav-link').forEach(b =>
    b.classList.toggle('active', b.dataset.page === name));
  if (('#' + name) !== window.location.hash) {
    history.replaceState(null, '', '#' + name);
  }
  // Charts built while their page was hidden have a 0-size canvas; fix on show.
  requestAnimationFrame(() => {
    if (name === 'infra')   cpuChart?.resize();
    if (name === 'network') wanChart?.resize();
  });
}

function initNav() {
  document.querySelectorAll('.nav-link').forEach(btn =>
    btn.addEventListener('click', () => showPage(btn.dataset.page)));
  window.addEventListener('hashchange', () =>
    showPage(window.location.hash.slice(1) || 'home'));
  showPage(window.location.hash.slice(1) || 'home');
}

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
    loadPatching();          // own endpoint, own failure mode — never awaited here
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
  renderUps(d.ups);
  renderPower(d.power);
  renderTemperature(d.temperature);
  renderServers(d.servers);
  renderNetdata(d.netdata);
  renderAlerts(d.alerts);
  renderProxmox(d.pve);
  renderUnraid(d.unraid);
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

// Geist/Vertiv environmental sensor. Restored from the Aug-10 conflict copy;
// renders em-dashes and dims the card whenever the sensor is unreachable.
function renderTemperature(t) {
  const valEl = document.getElementById('temp-value');
  const humEl = document.getElementById('temp-humidity');
  const dpEl  = document.getElementById('temp-dewpoint');
  const card  = document.getElementById('card-temp');
  if (!valEl) return;

  if (!t || t.temp_f == null) {
    valEl.textContent = '\u2014';
    if (humEl) humEl.textContent = '\u2014';
    if (dpEl)  dpEl.textContent  = '\u2014';
    valEl.style.color = '';
    if (card) card.style.opacity = '0.4';
    return;
  }
  if (card) card.style.opacity = '';

  valEl.textContent = t.temp_f.toFixed(1);
  if (humEl) humEl.textContent = Math.round(t.humidity_pct ?? 0);
  if (dpEl)  dpEl.textContent  = (t.dewpoint_f ?? 0).toFixed(1);

  // Colour by proximity to the sensor's own alarm threshold.
  const pct = t.temp_f / (t.alarm_threshold_f || 90);
  valEl.style.color = pct >= 1.0  ? 'var(--crit)'
                    : pct >= 0.94 ? 'var(--warn)'
                    : pct >= 0.88 ? 'var(--accent)'
                    :               'var(--ok)';

  const alarming = t.alarm_state && t.alarm_state !== 'none' && t.alarm_state !== 'clear';
  if (card) card.style.borderColor = alarming ? 'var(--crit)' : '';
}

// ─── Power page ──────────────────────────────────────────
// Fleet totals deliberately EXCLUDE plugs marked `downstream` by the server:
// Dilithium is fed from a UPS whose own inlet is metered, so counting both would
// double-count it. Downstream plugs are still listed, just visually set apart.
function renderPower(power) {
  const sumBody   = document.getElementById('power-summary-body');
  const rateBadge = document.getElementById('power-rate-badge');
  const plugBody  = document.getElementById('power-plugs-body');
  const plugBadge = document.getElementById('power-plugs-badge');
  if (!sumBody) return; // page not present

  if (!power || !power.plugs?.length) {
    sumBody.innerHTML  = '<div class="ups-no-data">No power data</div>';
    plugBody.innerHTML = '<div class="ups-no-data">No metered plugs</div>';
    rateBadge.textContent = '—';
    plugBadge.textContent = '—';
    return;
  }

  rateBadge.textContent = `${power.rate_cents}¢/kWh`;

  const money = n => (n == null ? '—' : `$${n.toFixed(2)}`);
  const tile  = (label, value, sub) => `
    <div class="power-tile">
      <div class="power-tile__value">${value}</div>
      <div class="power-tile__label">${label}</div>
      ${sub ? `<div class="power-tile__sub">${sub}</div>` : ''}
    </div>`;

  sumBody.innerHTML = `
    <div class="power-tiles">
      ${tile('Drawing now', `${power.total_watts ?? '—'}<span class="power-unit">W</span>`)}
      ${tile('Energy today', `${power.kwh_today ?? '—'}<span class="power-unit">kWh</span>`)}
      ${tile('Cost today', money(power.cost_today))}
      ${tile('Month to date', money(power.cost_month_todate))}
      ${tile('Projected / mo', money(power.proj_month_cost), `${power.proj_month_kwh ?? '—'} kWh`)}
      ${tile('Projected / yr', money(power.proj_year_cost))}
    </div>
    ${power.excluded?.length ? `<div class="power-note">
      Totals exclude ${power.excluded.map(escHtml).join(', ')} — fed from an already-metered UPS,
      so counting both would double-count. Raw sum of all plugs: ${power.total_watts_raw} W.
    </div>` : ''}`;

  const counted = power.plugs.filter(p => !p.downstream);
  plugBadge.textContent = `${counted.length} metered`;

  // Bar is scaled to the biggest plug so the smallest still reads.
  const peak = Math.max(...power.plugs.map(p => p.watts ?? 0), 1);

  plugBody.innerHTML = `<div class="power-plugs">` + power.plugs.map(p => {
    const w   = p.watts ?? 0;
    const pct = Math.max(2, Math.round((w / peak) * 100));
    return `
    <div class="power-plug${p.downstream ? ' is-downstream' : ''}">
      <div class="power-plug__head">
        <span class="power-plug__name">${escHtml(p.device)}</span>
        <span class="power-plug__watts">${p.watts ?? '—'} W</span>
      </div>
      <div class="power-plug__bar"><div class="power-plug__fill" style="width:${pct}%"></div></div>
      <div class="power-plug__meta">
        <span>${p.kwh_today ?? '—'} kWh today</span>
        <span>${p.model ? escHtml(p.model) : ''}${p.ip ? ' · ' + escHtml(p.ip) : ''}</span>
        ${p.downstream ? '<span class="power-plug__tag">downstream</span>' : ''}
      </div>
    </div>`;
  }).join('') + `</div>`;
}

function renderUps(upsList) {
  const body  = document.getElementById('ups-body');
  const badge = document.getElementById('ups-status-badge');
  if (!upsList?.length) {
    body.innerHTML = '<div class="ups-no-data">No UPS data</div>';
    badge.textContent = '—';
    badge.className = 'nola-card__badge ups-status-badge';
    return;
  }

  const statusCls = s =>
    s === 'ONLINE' ? 'ok' : s === 'ONBATT' ? 'warn' : 'crit'; // COMMLOST/UNKNOWN -> crit

  // Card badge summarises all units: green when every UPS is ONLINE,
  // otherwise flags how many need attention.
  const bad = upsList.filter(u => u.status !== 'ONLINE');
  if (!bad.length) {
    badge.textContent = upsList.length > 1 ? `${upsList.length} OK` : 'ONLINE';
    badge.className = 'nola-card__badge ups-status-badge ok';
  } else {
    badge.textContent = `${bad.length} ⚠`;
    badge.className = 'nola-card__badge ups-status-badge ' +
      (bad.some(u => u.status === 'ONBATT') ? 'warn' : 'crit');
  }

  const fmtRuntime = m => {
    if (m == null) return '—';
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}m`;
  };

  body.innerHTML = upsList.map(u => {
    const chargePct = u.charge_pct ?? 0;
    const chargeCls = chargePct < 20 ? 'crit' : chargePct < 50 ? 'warn' : 'ok';
    // A UPS that has lost its monitoring link reports zero for every reading.
    // Say that plainly -- a bare 0% bar reads as a flat battery, which it is not.
    if (u.status === 'COMMLOST') {
      return `
    <div class="ups-unit">
      <div class="ups-unit-head">
        <span class="ups-unit-name">${escHtml(u.name)}</span>
        <span class="ups-unit-status crit">${escHtml(u.status)}</span>
      </div>
      <div class="ups-commlost">Monitoring link down &mdash; readings unavailable.
        This does <strong>not</strong> mean the battery is empty.</div>
    </div>`;
    }
    return `
    <div class="ups-unit">
      <div class="ups-unit-head">
        <span class="ups-unit-name">${escHtml(u.name)}</span>
        <span class="ups-unit-status ${statusCls(u.status)}">${escHtml(u.status)}</span>
      </div>
      <div class="ups-charge-row">
        <span class="ups-charge-label">Battery</span>
        <div class="ups-bar-wrap">
          <div class="ups-bar-fill ${chargeCls}" style="width:${chargePct}%"></div>
        </div>
        <span class="ups-charge-val ${chargeCls}">${u.charge_pct ?? '—'}%</span>
      </div>
      <div class="ups-stats-row">
        <div class="ups-stat">
          <span class="ups-stat-label">Runtime</span>
          <span class="ups-stat-val">${fmtRuntime(u.time_left_m)}</span>
        </div>
        <div class="ups-stat">
          <span class="ups-stat-label">Load</span>
          <span class="ups-stat-val">${u.load_pct ?? '—'}%</span>
        </div>
        <div class="ups-stat">
          <span class="ups-stat-label">Line</span>
          <span class="ups-stat-val">${u.line_volts ?? '—'}V</span>
        </div>
      </div>
      ${u.model ? `<div class="ups-model">${escHtml(u.model)}</div>` : ''}
    </div>`;
  }).join('');
}

// SNMP-monitored servers (OMV NAS boxes), sourced from LibreNMS. Reuses the
// UPS card's bar/stat styling for CPU / RAM / disk usage.
function renderServers(list) {
  const body  = document.getElementById('servers-body');
  const badge = document.getElementById('servers-badge');
  if (!body) return;
  if (!list?.length) {
    body.innerHTML = '<div class="ups-no-data">No SNMP server data</div>';
    if (badge) { badge.textContent = '—'; badge.className = 'nola-card__badge'; }
    return;
  }

  const down = list.filter(s => s.status !== 'UP');
  if (badge) {
    badge.textContent = down.length ? `${down.length} ⚠` : (list.length > 1 ? `${list.length} OK` : 'UP');
    badge.className = 'nola-card__badge ' + (down.length ? 'crit' : 'ok');
  }

  const fmtBytes = b => {
    if (b == null || isNaN(b)) return '—';
    const u = ['B','KB','MB','GB','TB','PB']; let i = 0; b = Number(b);
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b >= 100 ? b.toFixed(0) : b.toFixed(1)} ${u[i]}`;
  };
  const fmtUptime = s => {
    if (s == null) return '—';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
    return d ? `${d}d ${h}h` : `${h}h`;
  };
  const barCls = p => p == null ? '' : p >= 90 ? 'crit' : p >= 75 ? 'warn' : 'ok';
  const bar = (label, pct, sub) => {
    const p = pct == null ? 0 : pct;
    return `
      <div class="ups-charge-row">
        <span class="ups-charge-label">${label}</span>
        <div class="ups-bar-wrap">
          <div class="ups-bar-fill ${barCls(pct)}" style="width:${p}%"></div>
        </div>
        <span class="ups-charge-val ${barCls(pct)}">${pct == null ? '—' : pct + '%'}${sub ? ` <small>${sub}</small>` : ''}</span>
      </div>`;
  };

  body.innerHTML = list.map(s => `
    <div class="ups-unit">
      <div class="ups-unit-head">
        <span class="ups-unit-name">${escHtml(s.name)}${s.site ? ` <small>${escHtml(s.site)}</small>` : ''}</span>
        <span class="ups-unit-status ${s.status === 'UP' ? 'ok' : 'crit'}">${escHtml(s.status)}</span>
      </div>
      ${bar('CPU', s.cpu_pct, null)}
      ${bar('RAM', s.ram?.pct, s.ram ? fmtBytes(s.ram.used) + ' / ' + fmtBytes(s.ram.total) : null)}
      ${bar('Disk', s.disk?.pct, s.disk ? fmtBytes(s.disk.used) + ' / ' + fmtBytes(s.disk.size) : null)}
      <div class="ups-stats-row">
        <div class="ups-stat">
          <span class="ups-stat-label">Uptime</span>
          <span class="ups-stat-val">${fmtUptime(s.uptime_s)}</span>
        </div>
        <div class="ups-stat">
          <span class="ups-stat-label">Volume</span>
          <span class="ups-stat-val">${s.disk ? escHtml(s.disk.mount) : '—'}</span>
        </div>
      </div>
      ${s.os ? `<div class="ups-model">${escHtml(s.os)}</div>` : ''}
    </div>`).join('');
}

function renderNetdata(list) {
  const body  = document.getElementById('netdata-body');
  const badge = document.getElementById('netdata-badge');
  if (!body) return;
  if (!list?.length) {
    body.innerHTML = '<div class="ups-no-data">No netdata data</div>';
    if (badge) { badge.textContent = '—'; badge.className = 'nola-card__badge'; }
    return;
  }

  const maxAnom = Math.max(...list.map(f => f.anomaly_pct ?? 0));
  if (badge) {
    if (maxAnom >= 5)      { badge.textContent = 'anomaly'; badge.className = 'nola-card__badge crit'; }
    else if (maxAnom >= 1) { badge.textContent = 'watch';   badge.className = 'nola-card__badge warn'; }
    else                   { badge.textContent = `${list.length} up`; badge.className = 'nola-card__badge'; }
  }

  const fmtBw = k => k >= 1000 ? `${(k / 1000).toFixed(1)} Mb/s` : `${Math.round(k)} kb/s`;

  body.innerHTML = list.map(f => {
    const anomVal = f.anomaly_pct ?? 0;
    const anomCls = anomVal >= 5 ? 'crit' : anomVal >= 1 ? 'warn' : 'ok';
    const anomTxt = f.anomaly_pct != null ? f.anomaly_pct.toFixed(2) : '—';
    const tempCls = f.disk_temp_c == null ? '' : f.disk_temp_c >= 65 ? 'crit' : f.disk_temp_c >= 55 ? 'warn' : 'ok';
    const ifaces = f.interfaces?.length
      ? f.interfaces.map(i => `
          <div class="nd-iface">
            <span class="nd-iface-dev">${escHtml(i.dev)}</span>
            <span class="nd-iface-bw"><span class="nd-dn">↓ ${fmtBw(i.rx_kbps)}</span><span class="nd-up">↑ ${fmtBw(i.tx_kbps)}</span></span>
          </div>`).join('')
      : '<div class="nd-iface-idle">no active interfaces</div>';
    return `
      <div class="nd-unit">
        <div class="nd-head">
          <span class="nd-name">${escHtml(f.name)}</span>
          <span class="nd-anom ${anomCls}">anomaly ${anomTxt}%</span>
        </div>
        <div class="nd-stats">
          <div class="nd-stat"><span class="nd-stat-label">Load</span><span class="nd-stat-val">${f.load1 ?? '—'}</span></div>
          <div class="nd-stat"><span class="nd-stat-label">Disk °C</span><span class="nd-stat-val ${tempCls}">${f.disk_temp_c ?? '—'}</span></div>
        </div>
        <div class="nd-ifaces">${ifaces}</div>
      </div>`;
  }).join('');
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

// ─── Unraid Card ─────────────────────────────────────────
function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  const tb = n / 1e12;
  if (tb >= 1) return `${tb.toFixed(tb >= 10 ? 0 : 1)} TB`;
  const gb = n / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

function unraidMountRow(m) {
  const pct = m.pct != null ? Math.min(Math.max(m.pct, 0), 100) : 0;
  const cls = pct >= 90 ? 'crit' : pct >= 75 ? 'warn' : '';
  const temp = m.temp_c != null ? `${m.temp_c}°C` : '';
  const bad  = m.status && m.status !== 'DISK_OK';
  return `
    <div class="unraid-mount">
      <div class="unraid-mount-top">
        <span class="unraid-mount-name">${escHtml(m.name)}<span class="unraid-mount-tag">${escHtml(m.type)}</span></span>
        <span class="unraid-mount-meta ${bad ? 'crit' : ''}">${bad ? escHtml(m.status) + ' · ' : ''}${temp}</span>
      </div>
      <div class="unraid-bar"><div class="unraid-bar-fill ${cls}" style="width:${pct}%"></div></div>
      <div class="unraid-mount-vals">
        <span class="${cls}">${m.pct != null ? m.pct + '%' : '—'}</span>
        <span>${fmtBytes(m.used_bytes)} / ${fmtBytes(m.size_bytes)}</span>
      </div>
    </div>`;
}

function renderUnraid(u) {
  const body  = document.getElementById('unraid-body');
  const badge = document.getElementById('unraid-badge');
  const card  = document.getElementById('card-unraid');
  if (!body) return;

  if (!u) {
    body.innerHTML = '<div class="ctr-no-data">No Unraid data</div>';
    if (badge) badge.textContent = '—';
    if (card)  card.style.opacity = '0.4';
    return;
  }
  if (card)  card.style.opacity = '';

  const started = (u.state || '').toUpperCase() === 'STARTED';
  if (badge) {
    badge.textContent = u.state || '—';
    badge.className = `nola-card__badge ${started ? 'ok' : 'warn'}`;
  }

  const capPct = u.capacity?.pct != null ? Math.min(Math.max(u.capacity.pct, 0), 100) : 0;
  const capCls = capPct >= 90 ? 'crit' : capPct >= 75 ? 'warn' : '';
  const c = u.containers || {};

  const parityBad = (u.parity || []).filter(p => p.status && p.status !== 'DISK_OK');
  const parityTxt = (u.parity || []).length
    ? (parityBad.length ? `${parityBad.length} parity fault` : `Parity OK (${u.parity.length})`)
    : '';

  body.innerHTML = `
    <div class="unraid-summary">
      <span class="unraid-host">${escHtml(u.host || u.name || 'unraid')}</span>
      ${u.uptime ? `<span class="unraid-sep">·</span><span>up ${escHtml(u.uptime)}</span>` : ''}
      ${parityTxt ? `<span class="unraid-sep">·</span><span class="${parityBad.length ? 'crit' : ''}">${escHtml(parityTxt)}</span>` : ''}
    </div>

    <div class="unraid-cap">
      <div class="unraid-cap-top">
        <span class="unraid-cap-label">Array capacity</span>
        <span class="unraid-cap-vals"><span class="${capCls}">${u.capacity?.pct ?? '—'}%</span> · ${fmtBytes(u.capacity?.used_bytes)} / ${fmtBytes(u.capacity?.total_bytes)}</span>
      </div>
      <div class="unraid-bar tall"><div class="unraid-bar-fill ${capCls}" style="width:${capPct}%"></div></div>
    </div>

    <div class="unraid-mounts">${(u.mounts || []).map(unraidMountRow).join('') || '<div class="ctr-no-data">No mounts</div>'}</div>

    <div class="unraid-ctr">
      <span class="card-icon">🐋</span>
      <span class="unraid-ctr-total">${c.total ?? '—'} containers</span>
      <span class="unraid-ctr-run">${c.running ?? 0} running</span>
      <span class="unraid-ctr-stop">${c.stopped ?? 0} stopped</span>
    </div>`;
}

// ─── Containers Card ─────────────────────────────────────
function renderContainerRow(c) {
  const cpuPct  = Math.min(c.cpu_pct ?? 0, 100);
  const cpuCls  = cpuPct >= 80 ? 'crit' : cpuPct >= 50 ? 'warn' : '';
  const memPct  = c.mem_pct != null ? Math.min(c.mem_pct, 100) : 0;
  const memCls  = memPct  >= 90 ? 'crit' : memPct  >= 70 ? 'warn' : '';
  const memDisp = c.mem_mb >= 1024
    ? `${(c.mem_mb / 1024).toFixed(1)} GB`
    : `${c.mem_mb} MB`;
  return `<div class="ctr-row">
    <span class="ctr-name">${escHtml(c.name)}</span>
    <div class="ctr-metric">
      <div class="ctr-bar-wrap">
        <div class="ctr-bar-fill cpu ${cpuCls}" style="width:${cpuPct}%"></div>
      </div>
      <span class="ctr-val ${cpuCls}">${c.cpu_pct?.toFixed(1) ?? '—'}%</span>
    </div>
    <div class="ctr-metric">
      <div class="ctr-bar-wrap">
        <div class="ctr-bar-fill mem ${memCls}" style="width:${memPct}%"></div>
      </div>
      <span class="ctr-val ${memCls}">${memDisp}</span>
    </div>
  </div>`;
}

function renderContainers(ctr) {
  const body  = document.getElementById('containers-body');
  const badge = document.getElementById('container-count-badge');
  const card  = document.getElementById('card-containers');
  if (!body) return;

  if (!ctr?.containers?.length) {
    body.innerHTML = '<div class="ctr-no-data">No container data</div>';
    if (badge) badge.textContent = '—';
    if (card)  card.style.opacity = '0.4';
    return;
  }
  if (card) card.style.opacity = '';
  if (badge) badge.textContent = `${ctr.running} running`;

  if (ctr.by_host && Object.keys(ctr.by_host).length > 1) {
    const hostOrder = ['union', 'eagle', 'falcon', 'talon'];
    const hosts = [
      ...hostOrder.filter(h => ctr.by_host[h]),
      ...Object.keys(ctr.by_host).filter(h => !hostOrder.includes(h)).sort(),
    ];
    body.innerHTML = hosts.map(host => {
      const ctrs = ctr.by_host[host];
      return `<div class="ctr-host-section">
        <div class="ctr-host-label">${escHtml(host)} <span class="ctr-host-count">${ctrs.length}</span></div>
        <div class="ctr-grid">${ctrs.map(renderContainerRow).join('')}</div>
      </div>`;
    }).join('');
  } else {
    body.innerHTML = `<div class="ctr-grid">${ctr.containers.map(renderContainerRow).join('')}</div>`;
  }
}

// ─── Patching Card ───────────────────────────────────────
// Fed by /api/patching, which reads whatever the last homelab-patching run
// wrote on the control host. Deliberately independent of /api/data: a stale or
// missing patch report must never take the rest of the dashboard down with it.
async function loadPatching() {
  try {
    const res = await fetch('/api/patching');
    renderPatching(await res.json());
  } catch (err) {
    console.error('[nola] patch fetch error:', err);
    renderPatching({ ok: false, error: 'unreachable' });
  }
}

const PATCH_STATUS_CLS = {
  'clean': 'ok',
  'pending': 'warn',
  'updated': 'ok',
  'reboot-pending': 'warn',
  'rebooted': 'ok',
  'failed': 'crit',
  'unreachable': 'crit',
};

function renderPatching(p) {
  const body  = document.getElementById('patch-body');
  const badge = document.getElementById('patch-run-badge');
  const card  = document.getElementById('card-patch');
  if (!body) return;

  if (!p?.ok) {
    body.innerHTML = `<div class="patch-no-data">${escHtml(p?.error || 'No patch report')}</div>`;
    if (badge) { badge.textContent = '—'; badge.className = 'nola-card__badge patch-run-badge'; }
    if (card)  card.style.opacity = '0.4';
    return;
  }
  if (card) card.style.opacity = '';

  const t = p.totals || {};
  // A report older than 8 days means the weekly run stopped happening — that is
  // the failure this card exists to make visible, so it colours the badge.
  const stale = p.age_hours != null && p.age_hours > 192;
  if (badge) {
    badge.textContent = `${p.mode ?? 'run'} · ${fmtAge(p.age_hours)}`;
    badge.className = 'nola-card__badge patch-run-badge ' + (stale ? 'crit' : 'ok');
  }

  const stat = (label, val, cls) =>
    `<div class="patch-stat ${val ? cls : ''}">
       <span class="patch-stat-val">${val}</span>
       <span class="patch-stat-label">${label}</span>
     </div>`;

  const stats = `<div class="patch-stats">
    ${stat('pending', t.pending_packages ?? 0, 'warn')}
    ${stat('security', t.security_packages ?? 0, 'crit')}
    ${stat('need reboot', t.reboot_pending ?? 0, 'warn')}
    ${stat('unreachable', (t.unreachable ?? 0) + (t.failed ?? 0), 'crit')}
    ${stat('hosts', t.hosts ?? 0, '')}
  </div>`;

  const rows = (p.hosts || []).map(h => {
    const cls = PATCH_STATUS_CLS[h.status] || '';
    // A host that dropped out has nothing but zeros to show, so show why it
    // dropped out instead — the reason is the only useful thing about that row.
    const counts = (h.status === 'unreachable' || h.status === 'failed')
      ? `<span class="patch-host-counts muted">${escHtml(h.error ? shortErr(h.error) : 'no data')}</span>`
      : `<span class="patch-host-counts">
           <span class="${h.pending ? 'warn' : 'muted'}">${h.pending} pkg</span>
           ${h.security ? `<span class="crit">${h.security} sec</span>` : ''}
           ${h.reboot_required ? '<span class="warn">⟳ reboot</span>' : ''}
         </span>`;
    // Hovering a row lists what apt would actually pull in, so you can judge a
    // 14-package host without opening the full report.
    const tip = h.error ? ` title="${escHtml(h.error)}"`
      : h.packages?.length ? ` title="${escHtml(h.packages.join(', '))}"` : '';
    return `<div class="patch-host-row"${tip}>
      <span class="patch-host-name">${escHtml(h.host)}</span>
      <span class="patch-host-os">${escHtml(h.os || '')}</span>
      ${counts}
      <span class="patch-host-status ${cls}">${escHtml(h.status)}</span>
    </div>`;
  }).join('');

  const hist = (p.history || []).slice(0, 5).map(r =>
    `<div class="patch-hist-row">
       <span class="patch-hist-time">${new Date(r.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
       <span class="patch-hist-mode">${escHtml(r.mode)}</span>
       <span class="patch-hist-nums">${r.pending} pending · ${r.updated} updated${r.failed ? ` · ${r.failed} failed` : ''}</span>
     </div>`).join('');

  body.innerHTML = stats
    + `<div class="patch-host-list">${rows || '<div class="patch-no-data">No hosts in report</div>'}</div>`
    + (hist ? `<div class="patch-hist"><div class="patch-hist-title">Recent runs</div>${hist}</div>` : '');
}

// Ansible's messages are long and prefixed; the row has room for a phrase.
// The full text stays in the row's title attribute.
function shortErr(msg) {
  const m = String(msg);
  if (/sudo password/i.test(m)) return 'sudo not configured';
  if (/Permission denied/i.test(m)) return 'ssh key rejected';
  if (/Failed to connect|timed out|No route/i.test(m)) return 'no ssh';
  return m.replace(/^Task failed:\s*/i, '').slice(0, 40);
}

function fmtAge(hours) {
  if (hours == null) return 'unknown';
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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

  // ?kiosk&slide=N starts the rotation on a given slide. The NOC TV reloads this
  // tab every cycle, so without this a late slide is only ever on screen for a
  // second or two; a dedicated tab can point straight at the one it wants.
  const want = parseInt(new URLSearchParams(location.search).get('slide'), 10);
  const start = Number.isInteger(want) && want >= 0 && want < KIOSK_DURATIONS.length ? want : 0;

  kioskSlide = start;
  if (state) renderKiosk(state);
  activateSlide(start);
  document.documentElement.style.cursor = 'none';
  history.replaceState(null, '', start ? `?kiosk&slide=${start}` : '?kiosk');
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
  renderKioskUnraid(d.unraid);
  renderKioskWorkloads(d);
  renderKioskWan(d);
  renderKioskPower(d);
}

// Power slide. Totals come from the server already excluding downstream plugs
// (Dilithium is fed from a metered UPS), so this just presents them.
function renderKioskPower(d) {
  const blocks = document.getElementById('k-power-blocks');
  const list   = document.getElementById('k-power-plugs');
  if (!blocks || !list) return;

  const power = d.power;
  if (!power?.plugs?.length) {
    blocks.innerHTML = '<div class="kslide-empty">No power data</div>';
    list.innerHTML = '';
    return;
  }

  const money = n => (n == null ? '—' : `$${n.toFixed(2)}`);
  const block = (label, value, unit) => `
    <div class="kpower-block">
      <div class="kpower-value">${value}${unit ? `<span class="kpower-unit">${unit}</span>` : ''}</div>
      <div class="kpower-label">${label}</div>
    </div>`;

  blocks.innerHTML =
    block('Drawing now',    power.total_watts ?? '—', 'W') +
    block('Energy today',   power.kwh_today ?? '—', 'kWh') +
    block('Cost today',     money(power.cost_today)) +
    block('Projected / mo', money(power.proj_month_cost)) +
    block('Projected / yr', money(power.proj_year_cost));

  const upsEl = document.getElementById('k-power-ups');
  if (upsEl) {
    const ups = d.ups || [];
    upsEl.innerHTML = ups.length ? ups.map(u => {
      const cls = u.status === 'ONLINE' ? 'ok' : u.status === 'ONBATT' ? 'warn' : 'crit';
      // COMMLOST reports zeros for everything; don't render that as a flat battery.
      const detail = u.status === 'COMMLOST'
        ? '<span class="kpower-ups-note">monitoring link down</span>'
        : `<span class="kpower-ups-stat">${u.charge_pct ?? '—'}%</span>
           <span class="kpower-ups-stat">${u.load_pct != null ? u.load_pct + '% load' : '—'}</span>
           <span class="kpower-ups-stat">${u.line_volts != null ? u.line_volts + 'V' : '—'}</span>`;
      return `
      <div class="kpower-ups-unit">
        <span class="kpower-ups-name">${escHtml(u.name)}</span>
        <span class="kpower-ups-status ${cls}">${escHtml(u.status || 'UNKNOWN')}</span>
        ${detail}
      </div>`;
    }).join('') : '<div class="kslide-empty">No UPS data</div>';
  }

  const peak = Math.max(...power.plugs.map(p => p.watts ?? 0), 1);
  list.innerHTML = power.plugs.map(p => {
    const pct = Math.max(2, Math.round(((p.watts ?? 0) / peak) * 100));
    return `
    <div class="kpower-plug${p.downstream ? ' is-downstream' : ''}">
      <span class="kpower-plug-name">${escHtml(p.device)}</span>
      <span class="kpower-plug-bar"><span class="kpower-plug-fill" style="width:${pct}%"></span></span>
      <span class="kpower-plug-watts">${p.watts ?? '—'} W</span>
    </div>`;
  }).join('');
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


// ── Kiosk slide 4: Unraid array ──────────────────────────────────────────────
function renderKioskUnraid(u) {
  const stateEl = document.getElementById('k-unraid-state');
  const sumEl   = document.getElementById('k-unraid-summary');
  const disksEl = document.getElementById('k-unraid-disks');
  if (!stateEl) return;

  if (!u) {
    stateEl.textContent = '—';
    sumEl.textContent   = 'Unraid data unavailable';
    disksEl.innerHTML   = '';
    return;
  }

  stateEl.textContent = u.state ?? '—';
  const c = u.capacity || {};
  sumEl.innerHTML =
    `<span>used <strong>${fmtBytes(c.used_bytes)}</strong></span>` +
    `<span class="k-pve-sep">·</span>` +
    `<span>free <strong>${fmtBytes(c.free_bytes)}</strong></span>` +
    `<span class="k-pve-sep">·</span>` +
    `<span>of <strong>${fmtBytes(c.total_bytes)}</strong></span>` +
    `<span class="k-pve-sep">·</span>` +
    `<span>up <strong>${escHtml(u.uptime ?? '—')}</strong></span>`;

  // Reuse the main Unraid card's row markup so both views stay consistent.
  disksEl.innerHTML = (u.mounts || []).map(unraidMountRow).join('');
}

// ── Kiosk slide 5: containers & databases ───────────────────────────────────
function renderKioskWorkloads(d) {
  const blocks = document.getElementById('k-work-blocks');
  const ctrEl  = document.getElementById('k-work-containers');
  const dbEl   = document.getElementById('k-work-dbs');
  if (!blocks) return;

  const ctrs    = d.containers?.containers || [];
  const running = d.containers?.running ?? ctrs.length;
  const hosts   = new Set(ctrs.map(c => c.host)).size;
  const dbs     = d.databases || [];
  const down    = dbs.filter(x => !x.up);

  blocks.innerHTML = `
    <div class="kperf-block">
      <div class="kperf-label">📦 Containers</div>
      <div class="kperf-value cyan">${running}</div>
      <div class="kperf-unit">running · ${hosts} hosts</div>
    </div>
    <div class="kperf-block">
      <div class="kperf-label">🗄 Databases</div>
      <div class="kperf-value ${down.length ? 'red' : 'green'}">${dbs.length - down.length}/${dbs.length}</div>
      <div class="kperf-unit">reachable</div>
    </div>`;

  const byCpu = [...ctrs].filter(c => c.cpu_pct != null).sort((a, b) => b.cpu_pct - a.cpu_pct);
  ctrEl.innerHTML = byCpu.slice(0, 8).map(c =>
    `<div class="k-work-row">
       <span class="k-top-badge">${c.cpu_pct.toFixed(0)}%</span>
       <span>${escHtml(c.name)}</span>
       <span class="k-work-host">${escHtml(c.host)}</span>
     </div>`).join('') || '<div class="k-work-none">No container data</div>';

  dbEl.innerHTML = down.length
    ? down.slice(0, 8).map(x =>
        `<div class="k-work-row">
           <span class="k-top-badge">${escHtml(x.engine || 'db')}</span>
           <span>${escHtml(x.name)}</span>
         </div>`).join('') +
      (down.length > 8 ? `<div class="k-work-row"><span>+ ${down.length - 8} more</span></div>` : '')
    : '<div class="k-work-none">✓ All databases reachable</div>';
}

// ── Kiosk slide 6: WAN throughput & SNMP servers ────────────────────────────
function renderKioskWan(d) {
  const blocks = document.getElementById('k-wan-blocks');
  const srvEl  = document.getElementById('k-servers-list');
  if (!blocks) return;

  const series = d.wan?.series || [];
  blocks.innerHTML = series.length
    ? series.map(s => {
        const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);
        const peak = (arr) => (arr && arr.length ? Math.max(...arr) : null);
        const rx = last(s.rx_mbps), tx = last(s.tx_mbps);
        return `
          <div class="kperf-block">
            <div class="kperf-label">↓ ${escHtml(s.host)} RX</div>
            <div class="kperf-value cyan">${rx != null ? rx : '—'}</div>
            <div class="kperf-unit">Mbps · peak ${peak(s.rx_mbps) ?? '—'}</div>
          </div>
          <div class="kperf-block">
            <div class="kperf-label">↑ ${escHtml(s.host)} TX</div>
            <div class="kperf-value purple">${tx != null ? tx : '—'}</div>
            <div class="kperf-unit">Mbps · peak ${peak(s.tx_mbps) ?? '—'}</div>
          </div>`;
      }).join('')
    : '<div class="k-work-none">No WAN data</div>';

  // data.servers comes from LibreNMS and is null whenever that API is down.
  const servers = Array.isArray(d.servers) ? d.servers : (d.servers?.devices || []);
  srvEl.innerHTML = servers.length
    ? servers.map(sv => {
        const up = sv.up ?? sv.status;
        return `<div class="k-work-row">
          <span class="k-top-badge">${up ? 'UP' : 'DOWN'}</span>
          <span>${escHtml(sv.name || sv.hostname || '—')}</span>
          <span class="k-work-host">${escHtml(sv.site || sv.location || '')}</span>
        </div>`;
      }).join('')
    : `<div class="k-work-row"><span>LibreNMS unavailable${d.errors?.servers ? ' (' + escHtml(d.errors.servers) + ')' : ''}</span></div>`;
}
