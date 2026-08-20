import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Extracted from NetworkScreen when the UPS moved to the Power tab, so both the
// Power screen and anything else can render a UPS without importing a screen.
export default function UpsCard({ ups }) {
  const online = ups.status === 'ONLINE';
  const onBatt = ups.status === 'ONBATT';
  const statusColor = online ? '#00d26a' : onBatt ? '#ff4757' : '#ffa502';
  const charge = ups.charge_pct ?? 0;
  const chargeColor = charge < 20 ? '#ff4757' : charge < 50 ? '#ffa502' : '#00d26a';
  const runtime = ups.time_left_m != null
    ? (ups.time_left_m >= 60 ? `${Math.floor(ups.time_left_m / 60)}h ${ups.time_left_m % 60}m` : `${ups.time_left_m}m`)
    : '—';

  // A UPS that has lost its monitoring link reports zero for everything; say so
  // rather than letting it read as a flat/empty battery.
  const commlost = ups.status === 'COMMLOST';

  return (
    <View style={[styles.upsCard, { borderLeftColor: statusColor }]}>
      <View style={styles.upsHeader}>
        <View style={[styles.upsDot, { backgroundColor: statusColor }]} />
        <Text style={styles.upsName} numberOfLines={1}>{ups.name}{ups.model ? ` · ${ups.model}` : ''}</Text>
        <Text style={[styles.upsStatus, { color: statusColor }]}>{ups.status || 'UNKNOWN'}</Text>
      </View>

      {commlost ? (
        <Text style={styles.upsCommlost}>
          Monitoring link down — readings unavailable. This does not mean the battery is empty.
        </Text>
      ) : (
        <>
          <View style={styles.upsChargeRow}>
            <Text style={styles.upsChargeLabel}>Battery</Text>
            <View style={styles.upsBarBg}>
              <View style={[styles.upsBarFill, { width: `${Math.min(charge, 100)}%`, backgroundColor: chargeColor }]} />
            </View>
            <Text style={[styles.upsChargeVal, { color: chargeColor }]}>{ups.charge_pct ?? '—'}%</Text>
          </View>

          <View style={styles.upsStats}>
            <UpsStat label="Runtime" value={runtime} />
            <UpsStat label="Load" value={ups.load_pct != null ? `${ups.load_pct}%` : '—'} />
            <UpsStat label="Line" value={ups.line_volts != null ? `${ups.line_volts}V` : '—'} />
          </View>
        </>
      )}
    </View>
  );
}

function UpsStat({ label, value }) {
  return (
    <View style={styles.upsStat}>
      <Text style={styles.upsStatVal}>{value}</Text>
      <Text style={styles.upsStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  upsCard: {
    backgroundColor: '#12121f',
    borderRadius: 10,
    borderLeftWidth: 3,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  upsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  upsDot: { width: 8, height: 8, borderRadius: 4 },
  upsName: { flex: 1, color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  upsStatus: { fontSize: 11, fontWeight: '700' },
  upsCommlost: { color: '#ffa502', fontSize: 11, lineHeight: 16 },
  upsChargeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  upsChargeLabel: { color: '#888', fontSize: 11, width: 48 },
  upsBarBg: { flex: 1, height: 5, backgroundColor: '#2a2a3e', borderRadius: 3, overflow: 'hidden' },
  upsBarFill: { height: '100%', borderRadius: 3 },
  upsChargeVal: { fontSize: 12, fontWeight: '600', width: 42, textAlign: 'right' },
  upsStats: { flexDirection: 'row', justifyContent: 'space-between' },
  upsStat: { alignItems: 'center', flex: 1 },
  upsStatVal: { color: '#cfcfe0', fontSize: 14, fontWeight: '700' },
  upsStatLabel: { color: '#666', fontSize: 10, marginTop: 2 },
});
