import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Color thresholds mirror the web dashboard (app.js → renderContainerRow):
//   CPU: ≥80 crit, ≥50 warn.   Memory: ≥90 crit, ≥70 warn.
const cpuColor = pct => (pct >= 80 ? '#ff4757' : pct >= 50 ? '#ffa502' : '#00d26a');
const memColor = pct => (pct >= 90 ? '#ff4757' : pct >= 70 ? '#ffa502' : '#00d26a');

function fmtMem(mb) {
  if (mb == null) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

function Bar({ pct, color }) {
  return (
    <View style={styles.barBg}>
      <View style={[styles.barFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

function ContainerRow({ c }) {
  const cpuPct = Math.min(c.cpu_pct ?? 0, 100);
  // mem_pct is null when the container has no memory limit set — show usage without a % bar
  const hasMemPct = c.mem_pct != null;
  const memPct = hasMemPct ? Math.min(c.mem_pct, 100) : 0;

  return (
    <View style={styles.row}>
      <Text style={styles.name} numberOfLines={1}>{c.name}</Text>

      <View style={styles.metric}>
        <Bar pct={cpuPct} color={cpuColor(cpuPct)} />
        <Text style={[styles.val, { color: cpuColor(cpuPct) }]}>
          {c.cpu_pct != null ? `${c.cpu_pct.toFixed(1)}%` : '—'}
        </Text>
      </View>

      <View style={styles.metric}>
        <Bar pct={memPct} color={hasMemPct ? memColor(memPct) : '#3a3a4e'} />
        <Text style={[styles.val, { color: hasMemPct ? memColor(memPct) : '#aaa' }]}>
          {fmtMem(c.mem_mb)}
        </Text>
      </View>
    </View>
  );
}

// Memoize — container lists refresh every 10s and rows rarely change identity
export default React.memo(ContainerRow);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 },
  name: { color: '#cfcfe0', fontSize: 12, flex: 1.4 },
  metric: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  barBg: { flex: 1, height: 4, backgroundColor: '#2a2a3e', borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  val: { fontSize: 10, width: 52, textAlign: 'right' },
});
