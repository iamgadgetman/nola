import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const anomalyColor = pct => (pct >= 5 ? '#ff4757' : pct >= 1 ? '#ffa502' : '#00d26a');
const tempColor    = c   => (c == null ? '#cfcfe0' : c >= 65 ? '#ff4757' : c >= 55 ? '#ffa502' : '#00d26a');

function fmtBw(k) {
  if (k == null) return '—';
  return k >= 1000 ? `${(k / 1000).toFixed(1)} Mb/s` : `${Math.round(k)} kb/s`;
}

function FirewallCard({ fw }) {
  const anom = fw.anomaly_pct ?? 0;
  const ifaces = fw.interfaces || [];
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.name} numberOfLines={1}>{fw.name}</Text>
        <Text style={[styles.anom, { color: anomalyColor(anom) }]}>
          anomaly {fw.anomaly_pct != null ? fw.anomaly_pct.toFixed(2) : '—'}%
        </Text>
      </View>

      <View style={styles.stats}>
        <Stat label="Load" value={fw.load1 != null ? fw.load1 : '—'} />
        <Stat label="Disk °C" value={fw.disk_temp_c ?? '—'} color={tempColor(fw.disk_temp_c)} />
      </View>

      <View style={styles.ifaces}>
        {ifaces.length ? ifaces.map((i, idx) => (
          <View key={i.dev || idx} style={styles.iface}>
            <Text style={styles.ifaceDev}>{i.dev}</Text>
            <View style={styles.ifaceBw}>
              <Text style={styles.rx}>↓ {fmtBw(i.rx_kbps)}</Text>
              <Text style={styles.tx}>↑ {fmtBw(i.tx_kbps)}</Text>
            </View>
          </View>
        )) : <Text style={styles.idle}>no active interfaces</Text>}
      </View>
    </View>
  );
}

function Stat({ label, value, color = '#cfcfe0' }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statVal, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function FirewallHealthSection({ netdata }) {
  const list = netdata || [];
  if (!list.length) return null;   // firewalls only appear while their netdata target is up
  return (
    <>
      {list.map((fw, i) => <FirewallCard key={fw.name || i} fw={fw} />)}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#12122a', borderRadius: 12, padding: 12, gap: 10, marginBottom: 8,
    borderLeftWidth: 3, borderLeftColor: '#ff7a45',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: '#e0e0e0', fontSize: 14, fontWeight: '600', flex: 1 },
  anom: { fontSize: 11, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 24 },
  stat: { alignItems: 'flex-start' },
  statVal: { fontSize: 15, fontWeight: '700' },
  statLabel: { color: '#666', fontSize: 10, marginTop: 1 },
  ifaces: { gap: 4 },
  iface: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ifaceDev: { color: '#888', fontSize: 12 },
  ifaceBw: { flexDirection: 'row', gap: 12 },
  rx: { color: '#00d26a', fontSize: 12 },
  tx: { color: '#ffa502', fontSize: 12 },
  idle: { color: '#555', fontSize: 12 },
});
