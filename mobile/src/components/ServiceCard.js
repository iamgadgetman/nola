import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SERVICE_URLS } from '../constants/config';

export default function ServiceCard({ service, onPress }) {
  const isUp = service.status === 'up';
  const isPaused = service.status === 'paused';
  const url = SERVICE_URLS[service.name];

  const cardStyle = isUp ? styles.cardUp : isPaused ? styles.cardPaused : styles.cardDown;
  const dotStyle = isUp ? styles.dotUp : isPaused ? styles.dotPaused : styles.dotDown;
  const metaLabel = isUp ? `${service.response_time}ms` : isPaused ? 'paused' : 'DOWN';

  return (
    <TouchableOpacity
      style={[styles.card, cardStyle]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.row}>
        <View style={[styles.dot, dotStyle]} />
        <Text style={styles.name} numberOfLines={1}>{service.name}</Text>
        <Ionicons name="chevron-forward" size={14} color="#333" style={styles.linkIcon} />
      </View>
      <View style={styles.meta}>
        <Text style={styles.metaText}>{metaLabel}</Text>
        {service.service_type === 'ping' && <Text style={styles.badge}>ping</Text>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 4 },
  cardUp: { backgroundColor: '#1a1a2e', borderLeftColor: '#00d26a' },
  cardDown: { backgroundColor: '#2a1a1a', borderLeftColor: '#ff4757' },
  cardPaused: { backgroundColor: '#161622', borderLeftColor: '#444' },
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  dotUp: { backgroundColor: '#00d26a' },
  dotDown: { backgroundColor: '#ff4757' },
  dotPaused: { backgroundColor: '#444' },
  name: { flex: 1, color: '#e0e0e0', fontSize: 14, fontWeight: '500' },
  linkIcon: { marginLeft: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, paddingLeft: 16 },
  metaText: { color: '#888', fontSize: 12 },
  badge: {
    marginLeft: 8, color: '#666', fontSize: 11,
    backgroundColor: '#2a2a3e', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
  },
});
