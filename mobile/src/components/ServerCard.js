import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const STATE_LABELS = {
  0: 'Stopped', 5: 'Pre-Start', 7: 'Configuring', 10: 'Starting',
  20: 'Running', 30: 'Restarting', 40: 'Stopping', 50: 'Sleeping', 100: 'Unknown',
};

function MetricBar({ label, value, max, units, percent }) {
  const pct = percent ?? (max > 0 ? (value / max) * 100 : 0);
  const barColor = pct > 80 ? '#ff4757' : pct > 50 ? '#ffa502' : '#00d26a';
  return (
    <View style={styles.metric}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>
          {units ? `${value}${units === '%' ? '%' : ` / ${max} ${units}`}` : `${value} / ${max}`}
        </Text>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

export default function ServerCard({ instance, actionLoading, onStart, onStop, onRestart }) {
  const running = instance.Running;
  const stateLabel = STATE_LABELS[instance.AppState] ?? `State ${instance.AppState}`;
  const metrics = instance.Metrics ?? {};
  const cpu = metrics['CPU Usage'];
  const mem = metrics['Memory Usage'];
  const players = metrics['Active Users'];
  const instanceId = instance.InstanceID;
  const busy = actionLoading?.[instanceId];

  return (
    <View style={[styles.card, running ? styles.cardRunning : styles.cardStopped]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.dot, running ? styles.dotGreen : styles.dotRed]} />
          <View>
            <Text style={styles.name}>{instance.FriendlyName}</Text>
            <Text style={styles.module}>{instance.Module} · {stateLabel}</Text>
          </View>
        </View>
        {instance.Group ? <Text style={styles.group}>{instance.Group}</Text> : null}
      </View>

      {running && (
        <View style={styles.metrics}>
          {cpu && <MetricBar label="CPU" value={cpu.RawValue} max={cpu.MaxValue} units={cpu.Units} percent={cpu.Percent} />}
          {mem && <MetricBar label="Memory" value={mem.RawValue} max={mem.MaxValue} units={mem.Units} percent={mem.Percent} />}
          {players && <MetricBar label="Players" value={players.RawValue} max={players.MaxValue} units="" percent={players.Percent} />}
        </View>
      )}

      {instance.DiskUsageMB != null && (
        <Text style={styles.disk}>Disk: {(instance.DiskUsageMB / 1024).toFixed(1)} GB</Text>
      )}

      <View style={styles.actions}>
        {!running ? (
          <ActionBtn icon="play-circle-outline" label="Start" color="#00d26a" loading={busy === 'Start'} onPress={() => onStart(instanceId)} />
        ) : (
          <>
            <ActionBtn icon="refresh-circle-outline" label="Restart" color="#ffa502" loading={busy === 'Restart'} onPress={() => onRestart(instanceId)} />
            <ActionBtn icon="stop-circle-outline" label="Stop" color="#ff4757" loading={busy === 'Stop'} onPress={() => onStop(instanceId)} />
          </>
        )}
      </View>
    </View>
  );
}

function ActionBtn({ icon, label, color, loading, onPress }) {
  return (
    <TouchableOpacity style={[styles.btn, { borderColor: color }]} onPress={onPress} disabled={loading}>
      {loading
        ? <ActivityIndicator size="small" color={color} />
        : <Ionicons name={icon} size={18} color={color} />
      }
      <Text style={[styles.btnLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4 },
  cardRunning: { backgroundColor: '#1a1a2e', borderLeftColor: '#00d26a' },
  cardStopped: { backgroundColor: '#1e1e1e', borderLeftColor: '#555' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  dotGreen: { backgroundColor: '#00d26a' },
  dotRed: { backgroundColor: '#555' },
  name: { color: '#e0e0e0', fontSize: 15, fontWeight: '600' },
  module: { color: '#888', fontSize: 12, marginTop: 1 },
  group: { color: '#7b7bff', fontSize: 11, backgroundColor: '#1a1a3e', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  metrics: { gap: 8, marginBottom: 8 },
  metric: { gap: 4 },
  metricHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  metricLabel: { color: '#888', fontSize: 11 },
  metricValue: { color: '#aaa', fontSize: 11 },
  barBg: { height: 4, backgroundColor: '#2a2a3e', borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  disk: { color: '#666', fontSize: 11, marginBottom: 10 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  btnLabel: { fontSize: 13, fontWeight: '500' },
});
