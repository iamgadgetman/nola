import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices } from '../hooks/useServices';
import ServiceCard from '../components/ServiceCard';
import StatsBar from '../components/StatsBar';
import ServiceDetailScreen from './ServiceDetailScreen';
import { GROUPS } from '../constants/config';

export default function DashboardScreen() {
  const { services, loading, error, lastUpdated, refresh, stats } = useServices();
  const [search, setSearch] = useState('');
  const [activeGroup, setActiveGroup] = useState('All');
  const [showDownOnly, setShowDownOnly] = useState(false);
  const [selectedService, setSelectedService] = useState(null);

  const groups = ['All', ...GROUPS];

  const filtered = useMemo(() => services.filter(s => {
    if (showDownOnly && s.status !== 'down' && s.status !== 'paused') return false;
    if (activeGroup !== 'All' && s.group !== activeGroup) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [services, search, activeGroup, showDownOnly]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Services</Text>
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

      <StatsBar stats={stats} lastUpdated={lastUpdated} />

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color="#555" style={{ marginRight: 6 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search services..."
            placeholderTextColor="#555"
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color="#555" />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, showDownOnly && styles.filterBtnActive]}
          onPress={() => setShowDownOnly(v => !v)}
        >
          <Ionicons name="alert-circle-outline" size={18} color={showDownOnly ? '#ff4757' : '#555'} />
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.groupScroll}
        contentContainerStyle={styles.groupRow}
      >
        {groups.map(g => (
          <TouchableOpacity
            key={g}
            style={[styles.groupChip, activeGroup === g && styles.groupChipActive]}
            onPress={() => setActiveGroup(g)}
          >
            <Text style={[styles.groupChipText, activeGroup === g && styles.groupChipTextActive]}>{g}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <ServiceCard service={item} onPress={() => setSelectedService(item)} />
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#7b7bff" />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-circle-outline" size={40} color="#00d26a" />
              <Text style={styles.emptyText}>
                {showDownOnly ? 'All services are up!' : 'No services found'}
              </Text>
            </View>
          ) : null
        }
      />

      <ServiceDetailScreen
        service={selectedService}
        visible={!!selectedService}
        onClose={() => setSelectedService(null)}
        onStatusChange={(id, status) => {
          // Optimistically update the service list
          refresh();
        }}
      />
    </SafeAreaView>
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
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10, gap: 8 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchInput: { flex: 1, color: '#e0e0e0', fontSize: 14 },
  filterBtn: { backgroundColor: '#1a1a2e', borderRadius: 10, padding: 10 },
  filterBtnActive: { backgroundColor: '#2a1a1a' },
  groupScroll: { maxHeight: 44, marginBottom: 10 },
  groupRow: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  groupChip: { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: '#1a1a2e', borderRadius: 20 },
  groupChipActive: { backgroundColor: '#7b7bff' },
  groupChipText: { color: '#888', fontSize: 13 },
  groupChipTextActive: { color: '#fff', fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: '#555', fontSize: 15 },
});
