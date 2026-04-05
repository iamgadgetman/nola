import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function StatsBar({ stats, lastUpdated }) {
  const pct = stats.total > 0 ? Math.round((stats.up / stats.total) * 100) : 0;
  const updated = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--';

  return (
    <View style={styles.container}>
      <Stat value={stats.total} label="Total" />
      <Stat value={stats.up} label="Up" color="#00d26a" />
      <Stat value={stats.down} label="Down" color={stats.down > 0 ? '#ff4757' : '#888'} />
      {stats.paused > 0 && <Stat value={stats.paused} label="Paused" color="#555" />}
      <Stat
        value={`${pct}%`}
        label="Uptime"
        color={pct === 100 ? '#00d26a' : pct >= 90 ? '#ffa502' : '#ff4757'}
      />
      <View style={styles.updatedBlock}>
        <Text style={styles.updatedLabel}>Updated</Text>
        <Text style={styles.updatedTime}>{updated}</Text>
      </View>
    </View>
  );
}

function Stat({ value, label, color = '#e0e0e0' }) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', backgroundColor: '#12122a', borderRadius: 12,
    padding: 14, marginBottom: 16, alignItems: 'center',
  },
  statBlock: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: 'bold' },
  statLabel: { color: '#666', fontSize: 11, marginTop: 2 },
  updatedBlock: { alignItems: 'center', paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: '#2a2a3e' },
  updatedLabel: { color: '#555', fontSize: 10 },
  updatedTime: { color: '#666', fontSize: 11, marginTop: 2 },
});
