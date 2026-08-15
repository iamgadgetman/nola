import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Renders the `servers` block from /api/data (server.js → fetchServers, sourced
// from the LibreNMS API over SNMP): CPU/RAM/disk per polled server, keyed by site.
// Mirrors the web dashboard's "Servers — SNMP" card.

function fmtBytes(b) {
  if (b == null || isNaN(b)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  b = Number(b);
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b >= 100 ? b.toFixed(0) : b.toFixed(1)} ${u[i]}`;
}

function fmtUptime(s) {
  if (s == null) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h`;
}

const barColor = p => (p == null ? '#555' : p >= 90 ? '#ff4757' : p >= 75 ? '#ffa502' : '#00d26a');

function Bar({ label, pct, sub }) {
  const w = pct != null ? Math.min(Math.max(pct, 0), 100) : 0;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${w}%`, backgroundColor: barColor(pct) }]} />
      </View>
      <View style={styles.barVals}>
        <Text style={[styles.barPct, { color: barColor(pct) }]}>
          {pct == null ? '—' : `${pct}%`}
        </Text>
        {sub ? <Text style={styles.barSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

function ServerUnit({ s }) {
  const up = s.status === 'UP';
  return (
    <View style={styles.unit}>
      <View style={styles.unitHead}>
        <Text style={styles.unitName}>
          {s.name}
          {s.site ? <Text style={styles.unitSite}>  {s.site}</Text> : null}
        </Text>
        <Text style={[styles.unitStatus, { color: up ? '#00d26a' : '#ff4757' }]}>
          {s.status || '—'}
        </Text>
      </View>

      <Bar label="CPU"  pct={s.cpu_pct} />
      <Bar
        label="RAM"
        pct={s.ram?.pct}
        sub={s.ram ? `${fmtBytes(s.ram.used)} / ${fmtBytes(s.ram.total)}` : null}
      />
      <Bar
        label="Disk"
        pct={s.disk?.pct}
        sub={s.disk ? `${fmtBytes(s.disk.used)} / ${fmtBytes(s.disk.size)}` : null}
      />

      <View style={styles.metaRow}>
        <Text style={styles.meta}>up {fmtUptime(s.uptime_s)}</Text>
        {s.disk?.mount ? <Text style={styles.meta}>{s.disk.mount}</Text> : null}
        {s.os ? <Text style={styles.meta} numberOfLines={1}>{s.os}</Text> : null}
      </View>
    </View>
  );
}

export default function ServersSection({ servers, loading }) {
  if (!servers?.length) {
    return (
      <View style={styles.card}>
        <Text style={styles.noData}>
          {loading ? 'Loading SNMP servers…' : 'No SNMP server data — check the LibreNMS token'}
        </Text>
      </View>
    );
  }

  const down = servers.filter(s => s.status !== 'UP');

  return (
    <View style={styles.card}>
      {/* The screen's SectionHeader already says "Servers — SNMP", so this row
          names the data source instead of echoing it (same shape as UnraidSection,
          whose header names the host rather than the section). */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="hardware-chip-outline" size={16} color="#00d26a" />
          <Text style={styles.title}>LibreNMS</Text>
        </View>
        <Text style={[styles.badge, { color: down.length ? '#ff4757' : '#00d26a' }]}>
          {down.length ? `${down.length} ⚠` : `${servers.length} OK`}
        </Text>
      </View>

      {/* Two OMV boxes share the name "OMV" and differ only by site, so the key
          has to include the site or React collapses them into one row. */}
      {servers.map((s, i) => <ServerUnit key={`${s.name}/${s.site}/${i}`} s={s} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#12122a', borderRadius: 12, padding: 12, marginBottom: 8,
    borderLeftWidth: 3, borderLeftColor: '#00d26a',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  badge: { fontSize: 11, fontWeight: '700' },
  noData: { color: '#888', fontSize: 12, textAlign: 'center', paddingVertical: 6 },
  unit: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#2a2a3e' },
  unitHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  unitName: { color: '#e0e0e0', fontSize: 13, fontWeight: '600' },
  unitSite: { color: '#7b7bff', fontSize: 10, fontWeight: '400' },
  unitStatus: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  barRow: { marginBottom: 6 },
  barLabel: { color: '#888', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  barTrack: { height: 6, backgroundColor: '#2a2a3e', borderRadius: 3, overflow: 'hidden', marginTop: 3 },
  barFill: { height: '100%', borderRadius: 3 },
  barVals: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  barPct: { fontSize: 11, fontWeight: '600' },
  barSub: { color: '#888', fontSize: 11 },
  metaRow: { flexDirection: 'row', gap: 12, marginTop: 4, flexWrap: 'wrap' },
  meta: { color: '#666', fontSize: 11 },
});
