import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Linking, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNetdata } from '../hooks/useNetdata';
import { useTraffic } from '../hooks/useTraffic';
import { useSettings } from '../context/SettingsContext';
import { MetricBar } from '../components/MiniChart';

const GRAFANA_DASHBOARDS = [
  { name: 'Infrastructure Overview', icon: 'server-outline', path: '/d/homelab' },
  { name: 'Network Traffic',         icon: 'analytics-outline', path: '/d/network' },
  { name: 'System Metrics',          icon: 'speedometer-outline', path: '/d/system' },
  { name: 'All Dashboards',          icon: 'grid-outline', path: '/dashboards' },
];

export default function NetworkScreen() {
  const { settings } = useSettings();
  const { hosts, loading: ndLoading, lastUpdated: ndUpdated, refresh: ndRefresh } = useNetdata();
  const { interfaces, loading: ntLoading, lastUpdated: ntUpdated, refresh: ntRefresh } = useTraffic();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([ndRefresh(), ntRefresh()]);
    setRefreshing(false);
  };

  const grafanaUrl = settings.grafanaUrl || 'https://grafana.galaxy.rip';
  const fmt = (d) => d
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Network</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color="#7b7bff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7b7bff" />}
      >

        {/* ── Hosts (Netdata) ── */}
        <SectionHeader
          title="Hosts"
          icon="hardware-chip-outline"
          updated={fmt(ndUpdated)}
          loading={ndLoading && hosts.length === 0}
        />
        {hosts.length === 0 && !ndLoading ? (
          <EmptyCard text="No Netdata hosts configured — add them in Settings" />
        ) : (
          hosts.map(host => <HostCard key={host.name} host={host} />)
        )}

        {/* ── Traffic (ntopng) ── */}
        <SectionHeader
          title="Traffic"
          icon="wifi-outline"
          updated={fmt(ntUpdated)}
          loading={ntLoading && interfaces.length === 0}
        />
        {interfaces.length === 0 && !ntLoading ? (
          <EmptyCard text="No ntopng data — check ntopng URL and token in Settings" />
        ) : (
          interfaces.map(iface => <InterfaceCard key={iface.ifid} iface={iface} />)
        )}

        {/* ── Grafana ── */}
        <SectionHeader title="Grafana" icon="bar-chart-outline" />
        <View style={styles.grafanaGrid}>
          {GRAFANA_DASHBOARDS.map(db => (
            <TouchableOpacity
              key={db.path}
              style={styles.grafanaCard}
              onPress={() => Linking.openURL(grafanaUrl + db.path)}
            >
              <Ionicons name={db.icon} size={22} color="#7b7bff" />
              <Text style={styles.grafanaLabel}>{db.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Quick links */}
        <SectionHeader title="Quick Links" icon="link-outline" />
        <View style={styles.linkRow}>
          {[
            { label: 'LibreNMS', url: 'https://librenms.galaxy.rip', icon: 'pulse-outline' },
            { label: 'ntopng', url: settings.ntopngUrl || 'http://10.0.16.100:3005', icon: 'swap-horizontal-outline' },
            { label: 'Netdata', url: 'https://stopstats.galaxy.rip', icon: 'analytics-outline' },
            { label: 'CheckCle', url: settings.checkcleUrl, icon: 'shield-checkmark-outline' },
          ].map(l => (
            <TouchableOpacity key={l.label} style={styles.linkChip} onPress={() => Linking.openURL(l.url)}>
              <Ionicons name={l.icon} size={14} color="#7b7bff" />
              <Text style={styles.linkChipText}>{l.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title, icon, updated, loading }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={15} color="#7b7bff" />
      <Text style={styles.sectionTitle}>{title}</Text>
      {loading && <ActivityIndicator size="small" color="#7b7bff" style={{ marginLeft: 6 }} />}
      {updated && <Text style={styles.sectionUpdated}>· {updated}</Text>}
    </View>
  );
}

function HostCard({ host }) {
  if (!host.ok) {
    return (
      <View style={[styles.hostCard, styles.hostCardError]}>
        <Text style={styles.hostName}>{host.name}</Text>
        <Text style={styles.hostError}>unreachable</Text>
      </View>
    );
  }

  return (
    <View style={styles.hostCard}>
      <View style={styles.hostHeader}>
        <View style={styles.hostOnline} />
        <Text style={styles.hostName}>{host.name}</Text>
        {host.uptime && <Text style={styles.hostUptime}>up {host.uptime}</Text>}
      </View>

      <View style={styles.metricsGrid}>
        <MetricItem
          label="CPU"
          value={host.cpu !== null ? `${host.cpu}%` : '—'}
          pct={host.cpu}
        />
        <MetricItem
          label="RAM"
          value={host.ram !== null ? `${host.ram}%` : '—'}
          pct={host.ram}
        />
        {host.netIn !== null && (
          <MetricItem
            label="Net ↓"
            value={formatBytes(host.netIn)}
            pct={null}
            color="#7b7bff"
          />
        )}
        {host.netOut !== null && (
          <MetricItem
            label="Net ↑"
            value={formatBytes(host.netOut)}
            pct={null}
            color="#ffa502"
          />
        )}
      </View>
    </View>
  );
}

function MetricItem({ label, value, pct, color }) {
  const barColor = color || (pct > 80 ? '#ff4757' : pct > 60 ? '#ffa502' : '#00d26a');
  return (
    <View style={styles.metricItem}>
      <View style={styles.metricLabelRow}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, pct !== null && { color: barColor }]}>{value}</Text>
      </View>
      {pct !== null && <MetricBar value={pct} height={4} color={barColor} />}
    </View>
  );
}

function InterfaceCard({ iface }) {
  return (
    <View style={styles.ifaceCard}>
      <View style={styles.ifaceHeader}>
        <Text style={styles.ifaceName}>{iface.name}</Text>
        <View style={styles.ifaceStats}>
          {iface.hosts !== null && <Text style={styles.ifaceStat}>{iface.hosts} hosts</Text>}
          {iface.flows !== null && <Text style={styles.ifaceStat}>{iface.flows} flows</Text>}
        </View>
      </View>
      <View style={styles.trafficRow}>
        <View style={styles.trafficItem}>
          <Ionicons name="arrow-down-outline" size={12} color="#00d26a" />
          <Text style={styles.trafficIn}>{iface.bpsInFmt}</Text>
        </View>
        <View style={styles.trafficItem}>
          <Ionicons name="arrow-up-outline" size={12} color="#ffa502" />
          <Text style={styles.trafficOut}>{iface.bpsOutFmt}</Text>
        </View>
      </View>
    </View>
  );
}

function EmptyCard({ text }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function formatBytes(bps) {
  if (!bps && bps !== 0) return '—';
  const abs = Math.abs(bps);
  if (abs >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (abs >= 1e3) return `${(bps / 1e3).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0d0d1a' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { color: '#e0e0e0', fontSize: 24, fontWeight: 'bold', letterSpacing: 1 },
  refreshBtn: { padding: 6 },
  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8, marginBottom: 4,
  },
  sectionTitle: { color: '#aaa', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  sectionUpdated: { color: '#444', fontSize: 11, marginLeft: 2 },
  hostCard: {
    backgroundColor: '#12122a', borderRadius: 12, padding: 14, gap: 10,
    borderLeftWidth: 3, borderLeftColor: '#00d26a',
  },
  hostCardError: { borderLeftColor: '#444', opacity: 0.6 },
  hostHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hostOnline: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00d26a' },
  hostName: { flex: 1, color: '#e0e0e0', fontSize: 15, fontWeight: '600' },
  hostUptime: { color: '#555', fontSize: 11 },
  hostError: { color: '#555', fontSize: 12, marginTop: 4 },
  metricsGrid: { flexDirection: 'row', gap: 12 },
  metricItem: { flex: 1, gap: 4 },
  metricLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metricLabel: { color: '#666', fontSize: 11 },
  metricValue: { color: '#aaa', fontSize: 11, fontWeight: '600' },
  ifaceCard: {
    backgroundColor: '#12122a', borderRadius: 12, padding: 12,
    borderLeftWidth: 3, borderLeftColor: '#7b7bff',
  },
  ifaceHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  ifaceName: { flex: 1, color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  ifaceStats: { flexDirection: 'row', gap: 10 },
  ifaceStat: { color: '#555', fontSize: 11 },
  trafficRow: { flexDirection: 'row', gap: 20 },
  trafficItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trafficIn: { color: '#00d26a', fontSize: 14, fontWeight: '600' },
  trafficOut: { color: '#ffa502', fontSize: 14, fontWeight: '600' },
  grafanaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grafanaCard: {
    flex: 1, minWidth: '45%', backgroundColor: '#12122a', borderRadius: 12,
    padding: 14, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#1a1a3e',
  },
  grafanaLabel: { color: '#aaa', fontSize: 12, textAlign: 'center' },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  linkChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#12122a', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#1a1a3e',
  },
  linkChipText: { color: '#aaa', fontSize: 13 },
  emptyCard: {
    backgroundColor: '#0f0f1e', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#1a1a2e',
  },
  emptyText: { color: '#444', fontSize: 13, textAlign: 'center' },
});
