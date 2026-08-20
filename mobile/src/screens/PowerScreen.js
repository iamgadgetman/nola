import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNetdata } from '../hooks/useNetdata';
import UpsCard from '../components/UpsCard';

export default function PowerScreen() {
  const { ups, power, loading, lastUpdated, refresh } = useNetdata();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const fmt = (d) => d
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--';
  const money = (n) => (n == null ? '—' : `$${n.toFixed(2)}`);

  // Scale the bars to the biggest plug so the small ones still read.
  const peak = power?.plugs?.length
    ? Math.max(...power.plugs.map(p => p.watts ?? 0), 1)
    : 1;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Power</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={20} color="#7b7bff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7b7bff" />}
      >
        <SectionHeader
          title="Fleet"
          icon="flash-outline"
          updated={fmt(lastUpdated)}
          badge={power ? `${power.rate_cents}¢/kWh` : null}
        />

        {!power ? (
          loading ? <ActivityIndicator color="#7b7bff" style={{ marginVertical: 16 }} />
                  : <EmptyCard text="No power data — the Kasa exporter may be unavailable" />
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile label="Drawing now"    value={`${power.total_watts ?? '—'}`} unit="W" />
              <Tile label="Energy today"   value={`${power.kwh_today ?? '—'}`}  unit="kWh" />
              <Tile label="Cost today"     value={money(power.cost_today)} />
              <Tile label="Month to date"  value={money(power.cost_month_todate)} />
              <Tile label="Projected / mo" value={money(power.proj_month_cost)} sub={`${power.proj_month_kwh ?? '—'} kWh`} />
              <Tile label="Projected / yr" value={money(power.proj_year_cost)} />
            </View>

            {power.excluded?.length ? (
              <Text style={styles.note}>
                Totals exclude {power.excluded.join(', ')} — fed from an already-metered UPS, so
                counting both would double-count. Raw sum of all plugs: {power.total_watts_raw} W.
              </Text>
            ) : null}

            <SectionHeader title="Metered plugs" icon="flash" badge={`${power.plugs.filter(p => !p.downstream).length} metered`} />
            {power.plugs.map((p) => {
              const w = p.watts ?? 0;
              const pct = Math.max(2, Math.round((w / peak) * 100));
              return (
                <View key={p.device} style={[styles.plug, p.downstream && styles.plugDownstream]}>
                  <View style={styles.plugHead}>
                    <Text style={styles.plugName} numberOfLines={1}>{p.device}</Text>
                    <Text style={styles.plugWatts}>{p.watts ?? '—'} W</Text>
                  </View>
                  <View style={styles.plugBarBg}>
                    <View style={[
                      styles.plugBarFill,
                      { width: `${pct}%`, backgroundColor: p.downstream ? '#3a3a55' : '#7b7bff' },
                    ]} />
                  </View>
                  <View style={styles.plugMeta}>
                    <Text style={styles.plugMetaText}>{p.kwh_today ?? '—'} kWh today</Text>
                    <Text style={styles.plugMetaText}>
                      {p.downstream ? 'downstream' : [p.model, p.ip].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
              );
            })}
          </>
        )}

        <SectionHeader
          title="UPS"
          icon="battery-charging-outline"
          updated={fmt(lastUpdated)}
          loading={loading && ups.length === 0}
        />
        {ups.length === 0 ? (
          !loading ? <EmptyCard text="No UPS data — apcupsd exporter may be unavailable" /> : null
        ) : (
          ups.map((u, i) => <UpsCard key={u.name || i} ups={u} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ label, value, unit, sub }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>
        {value}{unit ? <Text style={styles.tileUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

function SectionHeader({ title, icon, updated, badge, loading }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={15} color="#7b7bff" />
      <Text style={styles.sectionTitle}>{title}</Text>
      {badge ? <Text style={styles.sectionBadge}>{badge}</Text> : null}
      {loading ? <ActivityIndicator size="small" color="#7b7bff" /> : null}
      {updated ? <Text style={styles.sectionUpdated}>{updated}</Text> : null}
    </View>
  );
}

function EmptyCard({ text }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0d0d1a' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  title: { color: '#e0e0e0', fontSize: 22, fontWeight: '700' },
  refreshBtn: { padding: 6 },
  scroll: { padding: 12, paddingBottom: 32 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, marginBottom: 8 },
  sectionTitle: { color: '#e0e0e0', fontSize: 15, fontWeight: '700', flex: 1 },
  sectionBadge: {
    color: '#7b7bff', fontSize: 10, fontWeight: '700',
    borderWidth: 1, borderColor: '#2a2a4e', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1,
  },
  sectionUpdated: { color: '#555', fontSize: 10 },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1, flexBasis: '30%',
    backgroundColor: '#12121f', borderRadius: 10, padding: 10, alignItems: 'center',
  },
  tileValue: { color: '#7b7bff', fontSize: 18, fontWeight: '700' },
  tileUnit: { color: '#7b7bff', fontSize: 11, fontWeight: '600' },
  tileLabel: { color: '#888', fontSize: 10, marginTop: 3, textAlign: 'center' },
  tileSub: { color: '#555', fontSize: 9, marginTop: 1 },

  note: {
    marginTop: 10, padding: 9,
    backgroundColor: '#16162a', borderLeftWidth: 2, borderLeftColor: '#7b7bff',
    borderRadius: 4, color: '#8888aa', fontSize: 11, lineHeight: 16,
  },

  plug: { backgroundColor: '#12121f', borderRadius: 10, padding: 12, marginBottom: 8, gap: 6 },
  plugDownstream: { opacity: 0.58 },
  plugHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  plugName: { flex: 1, color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  plugWatts: { color: '#7b7bff', fontSize: 14, fontWeight: '700' },
  plugBarBg: { height: 5, backgroundColor: '#2a2a3e', borderRadius: 3, overflow: 'hidden' },
  plugBarFill: { height: '100%', borderRadius: 3 },
  plugMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  plugMetaText: { color: '#666', fontSize: 10 },

  empty: { backgroundColor: '#12121f', borderRadius: 10, padding: 14 },
  emptyText: { color: '#666', fontSize: 12, textAlign: 'center' },
});
