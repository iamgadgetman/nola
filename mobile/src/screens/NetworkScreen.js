import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Linking, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNetdata } from '../hooks/useNetdata';
import { useTraffic } from '../hooks/useTraffic';
import { usePatching } from '../hooks/usePatching';
import FirewallHealthSection from '../components/FirewallHealthSection';
import UnraidSection from '../components/UnraidSection';
import ServersSection from '../components/ServersSection';
import PatchSection from '../components/PatchSection';
import { MetricBar } from '../components/MiniChart';
import { GRAFANA_DASHBOARDS } from '../constants/config';

export default function NetworkScreen() {
  const { hosts, alerts, speedtests, crowdsec, pve, netdata, unraid, servers, loading: ndLoading, lastUpdated: ndUpdated, refresh: ndRefresh } = useNetdata();
  const { interfaces, loading: ntLoading, lastUpdated: ntUpdated, refresh: ntRefresh } = useTraffic();
  const {
    patching,
    loading: pLoading,
    error: pError,
    lastUpdated: pUpdated,
    refresh: pRefresh,
  } = usePatching();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([ndRefresh(), ntRefresh(), pRefresh()]);
    setRefreshing(false);
  };

  const grafanaUrl = 'https://grafana.example.com';
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

        {/* ── Alerts (Grafana) ── */}
        <SectionHeader
          title="Alerts"
          icon="notifications-outline"
          updated={fmt(ndUpdated)}
          loading={ndLoading && alerts.length === 0}
        />
        {alerts.length === 0 ? (
          !ndLoading ? (
            <View style={styles.allClear}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#00d26a" />
              <Text style={styles.allClearText}>No active alerts</Text>
            </View>
          ) : null
        ) : (
          alerts.map((a, i) => <AlertCard key={`${a.name}/${a.instance}/${i}`} alert={a} />)
        )}

        {/* ── Hosts (Prometheus) ── */}
        <SectionHeader
          title="Hosts"
          icon="hardware-chip-outline"
          updated={fmt(ndUpdated)}
          loading={ndLoading && hosts.length === 0}
        />
        {hosts.length === 0 && !ndLoading ? (
          <EmptyCard text="No host data — check Dashboard URL in Settings" />
        ) : (
          hosts.map(host => <HostCard key={host.name} host={host} />)
        )}

        {/* ── Servers — SNMP (LibreNMS) ── */}
        {servers.length > 0 || ndLoading ? (
          <>
            <SectionHeader
              title="Servers — SNMP"
              icon="server-outline"
              updated={fmt(ndUpdated)}
              loading={ndLoading && servers.length === 0}
            />
            <ServersSection servers={servers} loading={ndLoading} />
          </>
        ) : null}

        {/* ── Proxmox (PVE API) ── */}
        {pve ? (
          <>
            <SectionHeader
              title="Proxmox"
              icon="albums-outline"
              updated={fmt(ndUpdated)}
            />
            <ProxmoxSection pve={pve} />
          </>
        ) : null}

        {/* ── Unraid (Unraid Connect API) ── */}
        {unraid ? (
          <>
            <SectionHeader title="Unraid" icon="server-outline" updated={fmt(ndUpdated)} />
            <UnraidSection unraid={unraid} loading={ndLoading} />
          </>
        ) : null}

        {/* ── Firewall Health (netdata) ── */}
        {netdata && netdata.length > 0 ? (
          <>
            <SectionHeader title="Firewall Health" icon="flame-outline" updated={fmt(ndUpdated)} />
            <FirewallHealthSection netdata={netdata} />
          </>
        ) : null}

        {/* ── Internet Speed (Prometheus) ── */}
        <SectionHeader
          title="Internet Speed"
          icon="speedometer-outline"
          updated={fmt(ndUpdated)}
          loading={ndLoading && speedtests.length === 0}
        />
        {speedtests.length === 0 ? (
          !ndLoading ? <EmptyCard text="No speedtest data" /> : null
        ) : (
          <View style={styles.speedRow}>
            {speedtests.map((s, i) => <SpeedtestCard key={s.instance || i} s={s} />)}
          </View>
        )}

        {/* ── WAN Traffic (InfluxDB) ── */}
        <SectionHeader
          title="WAN Traffic"
          icon="wifi-outline"
          updated={fmt(ntUpdated)}
          loading={ntLoading && interfaces.length === 0}
        />
        {interfaces.length === 0 && !ntLoading ? (
          <EmptyCard text="No WAN data — InfluxDB may be unavailable" />
        ) : (
          interfaces.map(iface => <InterfaceCard key={iface.ifid} iface={iface} />)
        )}

        {/* ── Security (CrowdSec) ── */}
        <SectionHeader title="Security" icon="shield-checkmark-outline" />
        <View style={styles.banCard}>
          <Ionicons
            name={crowdsec?.active_bans > 0 ? 'ban' : 'shield-checkmark'}
            size={22}
            color={crowdsec?.active_bans > 0 ? '#ff4757' : '#00d26a'}
          />
          <Text style={styles.banCount}>{crowdsec?.active_bans ?? '—'}</Text>
          <Text style={styles.banLabel}>CrowdSec active bans</Text>
        </View>

        {/* ── Patch status (weekly Ansible audit) ── */}
        <SectionHeader
          title="Patch Status"
          icon="shield-outline"
          updated={fmt(pUpdated)}
          loading={pLoading && !patching}
        />
        <PatchSection patching={patching} loading={pLoading} error={pError} />

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
            { label: 'LibreNMS',       url: 'https://librenms.example.com',    icon: 'pulse-outline' },
            { label: 'ntopng (Hawk)',  url: 'http://stop.galaxy:3005',         icon: 'swap-horizontal-outline' },
            { label: 'ntopng (Fort)',  url: 'http://halt.universe:3005',       icon: 'swap-horizontal-outline' },
            { label: 'Netdata',        url: 'https://stopstats.example.com',   icon: 'analytics-outline' },
            { label: 'CheckCle',       url: 'https://checkcle.example.com',    icon: 'shield-checkmark-outline' },
            { label: 'NetBox',         url: 'https://netbox.example.com',      icon: 'cube-outline' },
            { label: 'Grafana',        url: grafanaUrl,                        icon: 'bar-chart-outline' },
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
        {host.disk !== null && (
          <MetricItem
            label="Disk"
            value={host.disk !== null ? `${host.disk}%` : '—'}
            pct={host.disk}
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

// Relative "firing for" label, mirrors the web dashboard's firingAgo()
function firingAgo(isoStr) {
  if (!isoStr) return '';
  const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (isNaN(secs) || secs < 0) return '';
  if (secs < 60)    return `${secs}s`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

const SEV_COLOR = { critical: '#ff4757', warning: '#ffa502', info: '#7b7bff' };

function AlertCard({ alert }) {
  const color = SEV_COLOR[alert.severity] || '#ffa502';
  const ago = firingAgo(alert.firing_since);
  return (
    <View style={[styles.alertCard, { borderLeftColor: color }]}>
      <View style={styles.alertTop}>
        <Text style={[styles.alertSev, { color }]}>{(alert.severity || 'warning').toUpperCase()}</Text>
        <Text style={styles.alertName} numberOfLines={1}>{alert.name}</Text>
      </View>
      {alert.instance ? <Text style={styles.alertInstance}>{alert.instance}</Text> : null}
      {alert.summary ? <Text style={styles.alertSummary} numberOfLines={2}>{alert.summary}</Text> : null}
      {ago ? <Text style={styles.alertTime}>firing for {ago}</Text> : null}
    </View>
  );
}

function SpeedtestCard({ s }) {
  return (
    <View style={styles.speedCard}>
      <View style={styles.speedHeader}>
        <Text style={styles.speedSite} numberOfLines={1}>{s.site}</Text>
        {s.isp ? <Text style={styles.speedIsp} numberOfLines={1}>{s.isp}</Text> : null}
      </View>
      <View style={styles.speedStats}>
        <View style={styles.speedStat}>
          <Ionicons name="arrow-down-outline" size={13} color="#00d26a" />
          <Text style={styles.speedVal}>{s.download_mbps ?? '—'}</Text>
          <Text style={styles.speedUnit}>Mbps</Text>
        </View>
        <View style={styles.speedStat}>
          <Ionicons name="arrow-up-outline" size={13} color="#ffa502" />
          <Text style={styles.speedVal}>{s.upload_mbps ?? '—'}</Text>
          <Text style={styles.speedUnit}>Mbps</Text>
        </View>
      </View>
    </View>
  );
}

function ProxmoxSection({ pve }) {
  const node = pve.node || {};
  return (
    <View style={styles.pveWrap}>
      {/* Node summary */}
      <View style={styles.pveNode}>
        <View style={styles.pveNodeTop}>
          <Text style={styles.pveNodeName}>{node.name || 'pve'}</Text>
          {node.version ? <Text style={styles.pveVersion}>PVE {node.version}</Text> : null}
          {node.uptime ? <Text style={styles.pveNodeUptime}>up {node.uptime}</Text> : null}
        </View>
        <View style={styles.pveNodeMetrics}>
          <MetricItem label="CPU" value={node.cpu_pct != null ? `${node.cpu_pct}%` : '—'} pct={node.cpu_pct ?? null} />
          <MetricItem
            label="RAM"
            value={`${node.mem_used_gb ?? '—'} / ${node.mem_total_gb ?? '—'} GB`}
            pct={node.mem_total_gb > 0 ? Math.round((node.mem_used_gb / node.mem_total_gb) * 100) : null}
          />
        </View>
      </View>

      {/* VMs */}
      {(pve.vms || []).map(vm => {
        const running = vm.status === 'running';
        const memPct = vm.mem_total_gb > 0 ? Math.round((vm.mem_used_gb / vm.mem_total_gb) * 100) : null;
        return (
          <View key={vm.vmid} style={styles.pveVm}>
            <View style={styles.pveVmHeader}>
              <View style={[styles.pveVmDot, { backgroundColor: running ? '#00d26a' : '#555' }]} />
              <Text style={styles.pveVmName} numberOfLines={1}>{vm.name}</Text>
              <Text style={styles.pveVmId}>{vm.vmid}</Text>
              {running && vm.uptime ? <Text style={styles.pveVmUptime}>↑{vm.uptime}</Text> : (
                !running ? <Text style={styles.pveVmStopped}>{vm.status}</Text> : null
              )}
            </View>
            {running ? (
              <View style={styles.pveVmMetrics}>
                <MetricItem label="CPU" value={vm.cpu_pct != null ? `${vm.cpu_pct}%` : '—'} pct={vm.cpu_pct ?? null} />
                <MetricItem
                  label="RAM"
                  value={`${vm.mem_used_gb ?? '—'} / ${vm.mem_total_gb ?? '—'} GB`}
                  pct={memPct}
                />
              </View>
            ) : null}
          </View>
        );
      })}

      {/* Storage */}
      {(pve.storage || []).map(st => {
        const color = st.pct >= 90 ? '#ff4757' : st.pct >= 75 ? '#ffa502' : '#7b7bff';
        return (
          <View key={st.name} style={styles.pveStor}>
            <View style={styles.pveStorHeader}>
              <Text style={styles.pveStorName} numberOfLines={1}>{st.name}</Text>
              <Text style={styles.pveStorType}>{st.type}</Text>
              <Text style={[styles.pveStorPct, { color }]}>{st.pct}%</Text>
            </View>
            <View style={styles.pveStorBarBg}>
              <View style={[styles.pveStorBarFill, { width: `${Math.min(st.pct, 100)}%`, backgroundColor: color }]} />
            </View>
            <Text style={styles.pveStorSizes}>{st.used_gb} / {st.total_gb} GB</Text>
          </View>
        );
      })}
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

  allClear: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0f1e14', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#153021',
  },
  allClearText: { color: '#00d26a', fontSize: 13 },

  alertCard: {
    backgroundColor: '#12122a', borderRadius: 12, padding: 12, gap: 3,
    borderLeftWidth: 3,
  },
  alertTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertSev: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  alertName: { flex: 1, color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  alertInstance: { color: '#888', fontSize: 12 },
  alertSummary: { color: '#aaa', fontSize: 12 },
  alertTime: { color: '#555', fontSize: 11, marginTop: 2 },


  speedRow: { flexDirection: 'row', gap: 8 },
  speedCard: {
    flex: 1, backgroundColor: '#12122a', borderRadius: 12, padding: 12, gap: 8,
    borderLeftWidth: 3, borderLeftColor: '#7b7bff',
  },
  speedHeader: { gap: 1 },
  speedSite: { color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  speedIsp: { color: '#555', fontSize: 10 },
  speedStats: { flexDirection: 'row', justifyContent: 'space-between' },
  speedStat: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  speedVal: { color: '#cfcfe0', fontSize: 15, fontWeight: '700' },
  speedUnit: { color: '#666', fontSize: 10 },

  banCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#12122a', borderRadius: 12, padding: 14,
    borderLeftWidth: 3, borderLeftColor: '#7b7bff',
  },
  banCount: { color: '#e0e0e0', fontSize: 20, fontWeight: '700' },
  banLabel: { color: '#888', fontSize: 13 },

  pveWrap: { gap: 8 },
  pveNode: {
    backgroundColor: '#12122a', borderRadius: 12, padding: 14, gap: 10,
    borderLeftWidth: 3, borderLeftColor: '#e67e22',
  },
  pveNodeTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pveNodeName: { flex: 1, color: '#e0e0e0', fontSize: 15, fontWeight: '600' },
  pveVersion: { color: '#e67e22', fontSize: 11, fontWeight: '600' },
  pveNodeUptime: { color: '#555', fontSize: 11 },
  pveNodeMetrics: { flexDirection: 'row', gap: 12 },
  pveVm: {
    backgroundColor: '#0f0f1e', borderRadius: 10, padding: 12, gap: 8,
    borderWidth: 1, borderColor: '#1a1a2e',
  },
  pveVmHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pveVmDot: { width: 8, height: 8, borderRadius: 4 },
  pveVmName: { color: '#e0e0e0', fontSize: 14, fontWeight: '500' },
  pveVmId: { flex: 1, color: '#555', fontSize: 11 },
  pveVmUptime: { color: '#555', fontSize: 11 },
  pveVmStopped: { color: '#666', fontSize: 11 },
  pveVmMetrics: { flexDirection: 'row', gap: 12 },
  pveStor: {
    backgroundColor: '#0f0f1e', borderRadius: 10, padding: 12, gap: 6,
    borderWidth: 1, borderColor: '#1a1a2e',
  },
  pveStorHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pveStorName: { color: '#e0e0e0', fontSize: 13, fontWeight: '500' },
  pveStorType: { flex: 1, color: '#555', fontSize: 11 },
  pveStorPct: { fontSize: 12, fontWeight: '600' },
  pveStorBarBg: { height: 5, backgroundColor: '#2a2a3e', borderRadius: 3, overflow: 'hidden' },
  pveStorBarFill: { height: '100%', borderRadius: 3 },
  pveStorSizes: { color: '#666', fontSize: 11 },
});
