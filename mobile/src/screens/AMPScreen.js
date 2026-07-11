import React from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAMP } from '../hooks/useAMP';
import ServerCard from '../components/ServerCard';

export default function AMPScreen() {
  const { instances, loading, error, lastUpdated, refresh, actionLoading, startInstance, stopInstance, restartInstance } = useAMP();

  const running = instances.filter(i => i.Running).length;
  const stopped = instances.length - running;
  const updated = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Game Servers</Text>
        <TouchableOpacity onPress={refresh} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color="#7b7bff" />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="warning-outline" size={16} color="#ff4757" />
          <Text style={styles.errorText}> {error}</Text>
        </View>
      ) : null}

      <View style={styles.statsBar}>
        <Stat label="Total" value={instances.length} color="#aaa" />
        <Stat label="Running" value={running} color="#00d26a" />
        <Stat label="Stopped" value={stopped} color="#888" />
        <View style={styles.statDivider} />
        <Text style={styles.updated}>Updated {updated}</Text>
      </View>

      <FlatList
        data={instances}
        keyExtractor={item => item.InstanceID}
        renderItem={({ item }) => (
          <ServerCard
            instance={item}
            actionLoading={actionLoading}
            onStart={startInstance}
            onStop={stopInstance}
            onRestart={restartInstance}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#7b7bff" />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="server-outline" size={40} color="#333" />
              <Text style={styles.emptyText}>No instances found</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function Stat({ label, value, color }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  errorBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#2a1a1a',
    marginHorizontal: 16, marginBottom: 12, padding: 10, borderRadius: 8,
    borderLeftWidth: 3, borderLeftColor: '#ff4757',
  },
  errorText: { color: '#ff4757', fontSize: 13 },
  statsBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e',
    marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 10, gap: 16,
  },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { color: '#666', fontSize: 10, marginTop: 1 },
  statDivider: { flex: 1 },
  updated: { color: '#444', fontSize: 10 },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: '#555', fontSize: 15 },
});
