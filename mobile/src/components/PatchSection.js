import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Renders the patch block from /api/patching (server.js → the weekly Ansible
// patch-audit run): pending/security package rollup plus a per-host breakdown.
// Mirrors the web dashboard's Patch card.

const STATUS_COLOR = {
  'clean':           '#00d26a',
  'updated':         '#00d26a',
  'rebooted':        '#00d26a',
  'pending':         '#ffa502',
  'reboot-pending':  '#ffa502',
  'failed':          '#ff4757',
  'unreachable':     '#ff4757',
};

function fmtAge(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Ansible errors are multi-line SSH dumps; only the first line is readable here.
function shortErr(e) {
  const first = String(e).split('\n')[0].trim();
  return first.length > 48 ? `${first.slice(0, 46)}…` : first;
}

function Stat({ label, value, color }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statVal, value ? { color } : null]}>{value ?? 0}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function HostRow({ h, expanded, onPress }) {
  const dead = h.status === 'unreachable' || h.status === 'failed';
  const color = STATUS_COLOR[h.status] || '#888';
  // Tapping a host reveals what apt would actually pull in — the web card puts
  // this in a hover tooltip, which has no equivalent on touch.
  const canExpand = !dead && h.packages?.length > 0;

  return (
    <TouchableOpacity
      style={styles.hostRow}
      onPress={canExpand ? onPress : undefined}
      activeOpacity={canExpand ? 0.6 : 1}
    >
      <View style={styles.hostTop}>
        <Text style={styles.hostName} numberOfLines={1}>{h.host}</Text>
        <Text style={[styles.hostStatus, { color }]}>{h.status}</Text>
      </View>
      <View style={styles.hostMeta}>
        <Text style={styles.hostOs} numberOfLines={1}>{h.os || ''}</Text>
        {dead ? (
          <Text style={styles.hostErr} numberOfLines={1}>
            {h.error ? shortErr(h.error) : 'no data'}
          </Text>
        ) : (
          <View style={styles.counts}>
            <Text style={[styles.count, h.pending ? styles.warn : styles.muted]}>{h.pending} pkg</Text>
            {h.security ? <Text style={[styles.count, styles.crit]}>{h.security} sec</Text> : null}
            {h.reboot_required ? <Text style={[styles.count, styles.warn]}>⟳ reboot</Text> : null}
            {canExpand ? (
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={12}
                color="#555"
              />
            ) : null}
          </View>
        )}
      </View>
      {expanded && canExpand ? (
        <Text style={styles.pkgList}>{h.packages.join(', ')}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function PatchSection({ patching, loading, error }) {
  const [openHost, setOpenHost] = useState(null);

  if (!patching) {
    return (
      <View style={styles.card}>
        <Text style={styles.noData}>
          {loading ? 'Loading patch report…' : (error || 'No patch report')}
        </Text>
      </View>
    );
  }

  const t = patching.totals || {};
  // A report older than 8 days means the weekly run stopped happening — that is
  // the failure this card exists to make visible.
  const stale = patching.age_hours != null && patching.age_hours > 192;
  const hosts = patching.hosts || [];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="shield-outline" size={16} color="#7b7bff" />
          <Text style={styles.title}>Patch status</Text>
        </View>
        <Text style={[styles.badge, stale ? styles.crit : styles.ok]}>
          {patching.mode || 'run'} · {fmtAge(patching.age_hours)}
        </Text>
      </View>

      <View style={styles.stats}>
        <Stat label="pending"     value={t.pending_packages}  color="#ffa502" />
        <Stat label="security"    value={t.security_packages} color="#ff4757" />
        <Stat label="need reboot" value={t.reboot_pending}    color="#ffa502" />
        <Stat label="unreachable" value={(t.unreachable ?? 0) + (t.failed ?? 0)} color="#ff4757" />
        <Stat label="hosts"       value={t.hosts}             color="#e0e0e0" />
      </View>

      <View style={styles.hostList}>
        {hosts.map(h => (
          <HostRow
            key={h.host}
            h={h}
            expanded={openHost === h.host}
            onPress={() => setOpenHost(openHost === h.host ? null : h.host)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#12122a', borderRadius: 12, padding: 12, marginBottom: 8,
    borderLeftWidth: 3, borderLeftColor: '#7b7bff',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  badge: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  ok: { color: '#00d26a' },
  crit: { color: '#ff4757' },
  warn: { color: '#ffa502' },
  muted: { color: '#888' },
  noData: { color: '#888', fontSize: 12, textAlign: 'center', paddingVertical: 6 },
  stats: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 12, marginBottom: 4, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#2a2a3e',
  },
  stat: { alignItems: 'center', flex: 1 },
  statVal: { color: '#555', fontSize: 17, fontWeight: '700' },
  statLabel: { color: '#888', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 },
  hostList: { marginTop: 4 },
  hostRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1c1c33' },
  hostTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hostName: { color: '#e0e0e0', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  hostStatus: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  hostMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  hostOs: { color: '#666', fontSize: 11, flexShrink: 1, marginRight: 8 },
  hostErr: { color: '#888', fontSize: 11, flexShrink: 1 },
  counts: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  count: { fontSize: 11 },
  pkgList: { color: '#7b7bff', fontSize: 11, lineHeight: 16, marginTop: 6 },
});
