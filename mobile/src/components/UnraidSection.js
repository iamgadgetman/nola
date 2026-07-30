import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Renders the Unraid block from /api/data (server.js → fetchUnraid, sourced from
// the Unraid Connect GraphQL API): array status + capacity, per-disk/cache mount
// usage with temps, parity health, and a container running/stopped rollup.

function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  const tb = n / 1e12;
  if (tb >= 1) return `${tb.toFixed(tb >= 10 ? 0 : 1)} TB`;
  const gb = n / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

const usageColor = pct => (pct == null ? '#7b7bff' : pct >= 90 ? '#ff4757' : pct >= 75 ? '#ffa502' : '#00d26a');
const tempColor  = c   => (c == null ? '#888' : c >= 55 ? '#ff4757' : c >= 45 ? '#ffa502' : '#888');

function Bar({ pct }) {
  const w = pct != null ? Math.min(Math.max(pct, 0), 100) : 0;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${w}%`, backgroundColor: usageColor(pct) }]} />
    </View>
  );
}

function Mount({ m }) {
  const bad = m.status && m.status !== 'DISK_OK';
  return (
    <View style={styles.mount}>
      <View style={styles.mountTop}>
        <Text style={styles.mountName}>
          {m.name}<Text style={styles.mountTag}>  {m.type}</Text>
        </Text>
        <Text style={styles.mountMeta}>
          {bad ? <Text style={styles.bad}>{m.status} · </Text> : null}
          <Text style={{ color: tempColor(m.temp_c) }}>{m.temp_c != null ? `${m.temp_c}°C` : ''}</Text>
        </Text>
      </View>
      <Bar pct={m.pct} />
      <View style={styles.mountVals}>
        <Text style={[styles.pct, { color: usageColor(m.pct) }]}>{m.pct != null ? `${m.pct}%` : '—'}</Text>
        <Text style={styles.sizes}>{fmtBytes(m.used_bytes)} / {fmtBytes(m.size_bytes)}</Text>
      </View>
    </View>
  );
}

export default function UnraidSection({ unraid, loading }) {
  if (!unraid) return null;   // only render once the Unraid API is reachable

  const cap = unraid.capacity || {};
  const c = unraid.containers || {};
  const parity = unraid.parity || [];
  const parityBad = parity.filter(p => p.status && p.status !== 'DISK_OK');
  const started = (unraid.state || '').toUpperCase() === 'STARTED';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="server-outline" size={16} color="#ffa502" />
          <Text style={styles.title}>{unraid.host || unraid.name || 'Unraid'}</Text>
        </View>
        <Text style={[styles.state, { color: started ? '#00d26a' : '#ffa502' }]}>
          {unraid.state || '—'}
        </Text>
      </View>

      <View style={styles.metaRow}>
        {unraid.uptime ? <Text style={styles.meta}>up {unraid.uptime}</Text> : null}
        {parity.length ? (
          <Text style={[styles.meta, parityBad.length ? styles.bad : null]}>
            {parityBad.length ? `${parityBad.length} parity fault` : `Parity OK (${parity.length})`}
          </Text>
        ) : null}
      </View>

      {/* Array capacity */}
      <View style={styles.capBlock}>
        <View style={styles.mountTop}>
          <Text style={styles.capLabel}>Array capacity</Text>
          <Text style={styles.sizes}>
            <Text style={{ color: usageColor(cap.pct) }}>{cap.pct != null ? `${cap.pct}%` : '—'}</Text>
            {'  '}{fmtBytes(cap.used_bytes)} / {fmtBytes(cap.total_bytes)}
          </Text>
        </View>
        <Bar pct={cap.pct} />
      </View>

      {/* Mounts */}
      {(unraid.mounts || []).map((m, i) => <Mount key={m.name || i} m={m} />)}

      {/* Container rollup */}
      <View style={styles.ctrRow}>
        <Ionicons name="cube-outline" size={14} color="#7b7bff" />
        <Text style={styles.ctrTotal}>{c.total ?? '—'} containers</Text>
        <Text style={styles.ctrRun}>{c.running ?? 0} running</Text>
        <Text style={styles.ctrStop}>{c.stopped ?? 0} stopped</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#12122a', borderRadius: 12, padding: 12, marginBottom: 8,
    borderLeftWidth: 3, borderLeftColor: '#ffa502',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  state: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  metaRow: { flexDirection: 'row', gap: 12, marginTop: 4, marginBottom: 10 },
  meta: { color: '#888', fontSize: 11 },
  bad: { color: '#ff4757' },
  capBlock: { marginBottom: 12 },
  capLabel: { color: '#888', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  barTrack: { height: 6, backgroundColor: '#2a2a3e', borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  barFill: { height: '100%', borderRadius: 3 },
  mount: { marginBottom: 10 },
  mountTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mountName: { color: '#e0e0e0', fontSize: 13 },
  mountTag: { color: '#7b7bff', fontSize: 10 },
  mountMeta: { fontSize: 11 },
  mountVals: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  pct: { fontSize: 11, fontWeight: '600' },
  sizes: { color: '#888', fontSize: 11 },
  ctrRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: '#2a2a3e',
  },
  ctrTotal: { color: '#e0e0e0', fontSize: 13, fontWeight: '600' },
  ctrRun: { color: '#00d26a', fontSize: 12 },
  ctrStop: { color: '#888', fontSize: 12 },
});
