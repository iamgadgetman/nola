import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Linking, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServiceHistory } from '../hooks/useServiceHistory';
import { UptimeSparkline, ResponseTimeChart } from '../components/MiniChart';
import { SERVICE_URLS } from '../constants/config';

export default function ServiceDetailScreen({ service, visible, onClose, onStatusChange }) {
  const { history, loading, error, fetchHistory, toggleMonitor } = useServiceHistory();
  const [toggling, setToggling] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(service?.status);

  useEffect(() => {
    if (visible && service) {
      setCurrentStatus(service.status);
      fetchHistory(service.id, 60);
    }
  }, [visible, service?.id]);

  if (!service) return null;

  const isPaused = currentStatus === 'paused';
  const isUp = currentStatus === 'up';
  const url = SERVICE_URLS[service.name] || service.url;

  const statusColor = isUp ? '#00d26a' : isPaused ? '#555' : '#ff4757';
  const statusLabel = isUp ? 'UP' : isPaused ? 'PAUSED' : 'DOWN';

  const handleToggle = async () => {
    setToggling(true);
    try {
      await toggleMonitor(service.id, isPaused);
      const newStatus = isPaused ? 'up' : 'paused';
      setCurrentStatus(newStatus);
      onStatusChange?.(service.id, newStatus);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setToggling(false);
    }
  };

  const uptimePercent = history.length > 0
    ? Math.round((history.filter(h => h.status === 'up').length / history.length) * 100)
    : null;

  const recentChecks = [...history].reverse().slice(0, 8);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="chevron-down" size={24} color="#888" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{service.name}</Text>
          <View style={styles.headerActions}>
            {url ? (
              <TouchableOpacity onPress={() => Linking.openURL(url)} style={styles.iconBtn}>
                <Ionicons name="open-outline" size={20} color="#7b7bff" />
              </TouchableOpacity>
            ) : <View style={styles.iconBtn} />}
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Status pill */}
          <View style={styles.statusRow}>
            <View style={[styles.statusPill, { backgroundColor: statusColor + '22', borderColor: statusColor }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            {service.response_time > 0 && (
              <Text style={styles.responseTime}>{service.response_time}ms</Text>
            )}
            {uptimePercent !== null && (
              <Text style={styles.uptimePct}>{uptimePercent}% uptime</Text>
            )}
          </View>

          {/* Uptime sparkline */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Last {history.length} Checks</Text>
            {loading ? (
              <ActivityIndicator color="#7b7bff" style={{ marginVertical: 12 }} />
            ) : error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : (
              <UptimeSparkline data={history} height={32} />
            )}
          </View>

          {/* Response time chart */}
          {!loading && history.some(h => h.response_time > 0) && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Response Time</Text>
              <ResponseTimeChart data={history} height={52} />
            </View>
          )}

          {/* Monitor config */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Monitor Config</Text>
            <ConfigRow label="Type" value={service.service_type || '—'} />
            <ConfigRow label="URL" value={service.url || service.host || '—'} mono />
            <ConfigRow label="Interval" value={service.heartbeat_interval ? `${service.heartbeat_interval}s` : '—'} />
            <ConfigRow label="Max retries" value={service.max_retries ?? '—'} />
            {service.status_codes ? <ConfigRow label="Status codes" value={service.status_codes} /> : null}
            {service.last_checked ? (
              <ConfigRow label="Last checked" value={new Date(service.last_checked).toLocaleTimeString()} />
            ) : null}
          </View>

          {/* Recent check log */}
          {recentChecks.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent Checks</Text>
              {recentChecks.map((check, i) => (
                <View key={i} style={styles.checkRow}>
                  <Ionicons
                    name={check.status === 'up' ? 'checkmark-circle' : 'close-circle'}
                    size={16}
                    color={check.status === 'up' ? '#00d26a' : '#ff4757'}
                  />
                  <Text style={styles.checkTime}>
                    {new Date(check.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {check.response_time > 0 && (
                    <Text style={styles.checkMs}>{check.response_time}ms</Text>
                  )}
                  <Text style={styles.checkDetail} numberOfLines={1}>
                    {check.details?.replace(/^[✅❌🔴⚠️]\s*/, '') || ''}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, isPaused ? styles.actionResume : styles.actionPause]}
              onPress={handleToggle}
              disabled={toggling}
            >
              {toggling ? (
                <ActivityIndicator size="small" color={isPaused ? '#00d26a' : '#ffa502'} />
              ) : (
                <Ionicons
                  name={isPaused ? 'play-circle-outline' : 'pause-circle-outline'}
                  size={18}
                  color={isPaused ? '#00d26a' : '#ffa502'}
                />
              )}
              <Text style={[styles.actionText, { color: isPaused ? '#00d26a' : '#ffa502' }]}>
                {isPaused ? 'Resume Monitor' : 'Pause Monitor'}
              </Text>
            </TouchableOpacity>

            {url && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionOpen]}
                onPress={() => Linking.openURL(url)}
              >
                <Ionicons name="open-outline" size={18} color="#7b7bff" />
                <Text style={[styles.actionText, { color: '#7b7bff' }]}>Open in Browser</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ConfigRow({ label, value, mono }) {
  return (
    <View style={styles.configRow}>
      <Text style={styles.configLabel}>{label}</Text>
      <Text style={[styles.configValue, mono && styles.configMono]} numberOfLines={1}>{String(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0d0d1a' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  closeBtn: { padding: 4, marginRight: 8 },
  headerTitle: { flex: 1, color: '#e0e0e0', fontSize: 17, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 4 },
  iconBtn: { padding: 6, width: 34 },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  responseTime: { color: '#888', fontSize: 14 },
  uptimePct: { color: '#555', fontSize: 13, marginLeft: 'auto' },
  card: { backgroundColor: '#12122a', borderRadius: 12, padding: 14, gap: 10 },
  cardTitle: { color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  errorText: { color: '#ff4757', fontSize: 13 },
  configRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  configLabel: { color: '#555', fontSize: 12, width: 90 },
  configValue: { flex: 1, color: '#aaa', fontSize: 13 },
  configMono: { fontFamily: 'monospace', fontSize: 12, color: '#7b7bff' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  checkTime: { color: '#666', fontSize: 12, width: 48 },
  checkMs: { color: '#555', fontSize: 12, width: 44 },
  checkDetail: { flex: 1, color: '#555', fontSize: 11 },
  actions: { gap: 10, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  actionResume: { backgroundColor: '#0d1a0d', borderColor: '#00d26a33' },
  actionPause: { backgroundColor: '#1a1500', borderColor: '#ffa50233' },
  actionOpen: { backgroundColor: '#0d0d2a', borderColor: '#7b7bff33' },
  actionText: { fontSize: 15, fontWeight: '600' },
});
