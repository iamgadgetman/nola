import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ContainerRow from './ContainerRow';

// Renders container CPU/memory for a single host (default: holodeck).
// The backend keys by_host on the Prometheus `instance` label, which may be a
// bare hostname ("holodeck"), an FQDN, or an IP — so we match by substring.
export default function ContainerSection({ byHost, running, loading, error, hostMatch = 'holodeck' }) {
  const hostKeys = Object.keys(byHost || {});
  const matched = hostKeys.filter(h => h.toLowerCase().includes(hostMatch.toLowerCase()));
  const containers = matched.flatMap(h => byHost[h]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="cube-outline" size={16} color="#7b7bff" />
          <Text style={styles.title}>Holodeck Containers</Text>
        </View>
        {containers.length > 0 ? (
          <Text style={styles.count}>{containers.length}</Text>
        ) : null}
      </View>

      {error ? (
        <View style={styles.noteRow}>
          <Ionicons name="warning-outline" size={13} color="#ff4757" />
          <Text style={styles.noteErr}> {error}</Text>
        </View>
      ) : containers.length > 0 ? (
        <>
          <View style={styles.colHeader}>
            <Text style={[styles.colLabel, { flex: 1.4 }]}>Container</Text>
            <Text style={[styles.colLabel, styles.colMetric]}>CPU</Text>
            <Text style={[styles.colLabel, styles.colMetric]}>Memory</Text>
          </View>
          {containers.map((c, i) => (
            <ContainerRow key={`${c.host}/${c.name}/${i}`} c={c} />
          ))}
        </>
      ) : loading ? (
        <ActivityIndicator size="small" color="#7b7bff" style={{ paddingVertical: 12 }} />
      ) : hostKeys.length > 0 ? (
        // cAdvisor is reporting, but not for holodeck — show what it did see, to aid setup
        <View style={styles.noteRow}>
          <Ionicons name="information-circle-outline" size={13} color="#f0a500" />
          <Text style={styles.note}>
            {' '}No cAdvisor data for “{hostMatch}”. Reporting hosts: {hostKeys.join(', ')}.
          </Text>
        </View>
      ) : (
        <View style={styles.noteRow}>
          <Ionicons name="information-circle-outline" size={13} color="#666" />
          <Text style={styles.note}> No container data — is cAdvisor scraped by Prometheus?</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a2e', marginHorizontal: 0, marginTop: 4, marginBottom: 12,
    padding: 12, borderRadius: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  count: { color: '#7b7bff', fontSize: 11, backgroundColor: '#1a1a3e', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  colHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#2a2a3e' },
  colLabel: { color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  colMetric: { flex: 1, textAlign: 'left' },
  noteRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  note: { color: '#888', fontSize: 12, flex: 1 },
  noteErr: { color: '#ff4757', fontSize: 12, flex: 1 },
});
