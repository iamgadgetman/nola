import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const connColor = pct => (pct >= 90 ? '#ff4757' : pct >= 70 ? '#ffa502' : '#00d26a');
// Healthy InnoDB buffer-pool hit ratio sits well above 99%.
const hitColor  = pct => (pct >= 99 ? '#00d26a' : pct >= 95 ? '#ffa502' : '#ff4757');

function Stat({ label, value, color = '#cfcfe0' }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DatabaseCard({ db }) {
  const up = db.up;
  const connPct = db.conn_pct ?? 0;

  return (
    <View style={[styles.card, up ? styles.cardUp : styles.cardDown]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.dot, { backgroundColor: up ? '#00d26a' : '#ff4757' }]} />
          <Text style={styles.dbName} numberOfLines={1}>{db.name}</Text>
          {db.engine ? (
            <Text style={[styles.engine,
              db.engine === 'redis' ? styles.engineRedis
              : db.engine === 'postgres' ? styles.enginePostgres
              : styles.engineMysql]}>
              {db.engine}
            </Text>
          ) : null}
        </View>
        <Text style={styles.uptime}>{up ? (db.uptime || '') : 'offline'}</Text>
      </View>

      {up ? (
        <>
          <View style={styles.connRow}>
            <Text style={styles.connLabel}>Connections</Text>
            <Text style={styles.connVal}>
              {db.connections ?? '—'}{db.max_conn ? ` / ${db.max_conn}` : ''}
              {db.conn_pct != null ? `  (${db.conn_pct}%)` : ''}
            </Text>
          </View>
          <View style={styles.barBg}>
            <View style={[styles.barFill, { width: `${Math.min(connPct, 100)}%`, backgroundColor: connColor(connPct) }]} />
          </View>

          <View style={styles.stats}>
            <Stat label="Queries/s" value={db.qps != null ? db.qps : '—'} />
            <Stat
              label="Slow/s"
              value={db.slow_qps != null ? db.slow_qps : '—'}
              color={db.slow_qps > 0 ? '#ffa502' : '#cfcfe0'}
            />
            <Stat
              label="Cache hit"
              value={db.buffer_hit_pct != null ? `${db.buffer_hit_pct}%` : '—'}
              color={db.buffer_hit_pct != null ? hitColor(db.buffer_hit_pct) : '#cfcfe0'}
            />
            <Stat label="Threads" value={db.threads_running != null ? db.threads_running : '—'} />
          </View>
        </>
      ) : null}
    </View>
  );
}

export default function DatabaseSection({ databases, loading, error }) {
  const list = databases || [];

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="server-outline" size={16} color="#7b7bff" />
          <Text style={styles.title}>Databases</Text>
        </View>
        {list.length > 0 ? <Text style={styles.count}>{list.length}</Text> : null}
      </View>

      {error ? (
        <View style={styles.noteRow}>
          <Ionicons name="warning-outline" size={13} color="#ff4757" />
          <Text style={styles.noteErr}> {error}</Text>
        </View>
      ) : list.length > 0 ? (
        list.map((db, i) => <DatabaseCard key={db.instance || `${db.name}/${i}`} db={db} />)
      ) : loading ? (
        <ActivityIndicator size="small" color="#7b7bff" style={{ paddingVertical: 12 }} />
      ) : (
        <View style={styles.noteRow}>
          <Ionicons name="information-circle-outline" size={13} color="#666" />
          <Text style={styles.note}> No database metrics — is mysqld_exporter scraped (job="mysql")?</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4, marginBottom: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  count: { color: '#7b7bff', fontSize: 11, backgroundColor: '#1a1a3e', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },

  card: { backgroundColor: '#1a1a2e', padding: 12, borderRadius: 10, marginBottom: 10, borderLeftWidth: 4 },
  cardUp: { borderLeftColor: '#00d26a' },
  cardDown: { borderLeftColor: '#ff4757' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dbName: { color: '#e0e0e0', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  engine: {
    fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5,
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden',
  },
  engineMysql: { color: '#7b7bff', backgroundColor: '#1a1a3e' },
  engineRedis: { color: '#ff7a45', backgroundColor: '#2e1a12' },
  enginePostgres: { color: '#5b9bd5', backgroundColor: '#122130' },
  uptime: { color: '#666', fontSize: 11 },

  connRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  connLabel: { color: '#888', fontSize: 11 },
  connVal: { color: '#aaa', fontSize: 11 },
  barBg: { height: 4, backgroundColor: '#2a2a3e', borderRadius: 2, overflow: 'hidden', marginBottom: 10 },
  barFill: { height: '100%', borderRadius: 2 },

  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 15, fontWeight: '700' },
  statLabel: { color: '#666', fontSize: 9, marginTop: 2 },

  noteRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  note: { color: '#888', fontSize: 12, flex: 1 },
  noteErr: { color: '#ff4757', fontSize: 12, flex: 1 },
});
