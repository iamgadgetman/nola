import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Uptime sparkline — one bar per check
export function UptimeSparkline({ data, height = 28 }) {
  if (!data || data.length === 0) return null;
  return (
    <View style={[styles.sparkRow, { height }]}>
      {data.map((item, i) => {
        const color = item.status === 'up' ? '#00d26a' : item.status === 'paused' ? '#444' : '#ff4757';
        return (
          <View
            key={i}
            style={[styles.sparkBar, { backgroundColor: color, height }]}
          />
        );
      })}
    </View>
  );
}

// Response time bar chart
export function ResponseTimeChart({ data, height = 48 }) {
  if (!data || data.length === 0) return null;
  const times = data.map(d => d.response_time || 0).filter(t => t > 0);
  if (times.length === 0) return null;
  const max = Math.max(...times);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);

  return (
    <View>
      <View style={[styles.barRow, { height }]}>
        {data.map((item, i) => {
          const t = item.response_time || 0;
          const pct = max > 0 ? t / max : 0;
          const barH = Math.max(2, Math.round(pct * height));
          const color = t > 1000 ? '#ff4757' : t > 400 ? '#ffa502' : '#7b7bff';
          return (
            <View key={i} style={[styles.barWrap, { height }]}>
              <View style={[styles.bar, { height: barH, backgroundColor: color }]} />
            </View>
          );
        })}
      </View>
      <View style={styles.chartFooter}>
        <Text style={styles.chartLabel}>avg {avg}ms</Text>
        <Text style={styles.chartLabel}>max {max}ms</Text>
      </View>
    </View>
  );
}

// Horizontal metric bar (CPU%, RAM%)
export function MetricBar({ value, max = 100, color, height = 6 }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const barColor = color || (pct > 80 ? '#ff4757' : pct > 60 ? '#ffa502' : '#00d26a');
  return (
    <View style={[styles.metricBg, { height }]}>
      <View style={[styles.metricFill, { width: `${pct}%`, backgroundColor: barColor, height }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  sparkRow: {
    flexDirection: 'row',
    gap: 2,
    alignItems: 'flex-end',
  },
  sparkBar: {
    flex: 1,
    borderRadius: 1,
    minWidth: 3,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  barWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    borderRadius: 2,
    minWidth: 3,
  },
  chartFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  chartLabel: {
    color: '#555',
    fontSize: 10,
  },
  metricBg: {
    backgroundColor: '#2a2a3e',
    borderRadius: 3,
    overflow: 'hidden',
    flex: 1,
  },
  metricFill: {
    borderRadius: 3,
  },
});
