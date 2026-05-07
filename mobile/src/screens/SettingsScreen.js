import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Switch, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings, DEFAULTS } from '../context/SettingsContext';

export default function SettingsScreen() {
  const { settings, saveSettings } = useSettings();
  const [draft, setDraft] = useState({ ...settings });
  const [saved, setSaved] = useState(false);
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});

  useEffect(() => { setDraft({ ...settings }); }, [settings]);

  const update = (key, value) => setDraft(prev => ({ ...prev, [key]: value }));

  const URL_FIELDS = {
    checkcleUrl: 'CheckCle URL',
    ampUrl:      'AMP URL',
    n8nWebhookUrl: 'n8n Webhook URL',
    ntopngUrl:   'ntopng URL',
    grafanaUrl:  'Grafana URL',
  };

  const save = async () => {
    // Validate URL fields before persisting
    for (const [key, label] of Object.entries(URL_FIELDS)) {
      const val = draft[key];
      if (!val) continue;
      try { new URL(val); } catch {
        Alert.alert('Invalid URL', `${label} is not a valid URL:\n"${val}"`);
        return;
      }
    }
    await saveSettings(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const reset = () => {
    Alert.alert('Reset to Defaults', 'This will restore all settings to their default values.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => {
        setDraft({ ...DEFAULTS });
        await saveSettings(DEFAULTS);
      }},
    ]);
  };

  const testConnection = async (key, label, testFn) => {
    setTesting(prev => ({ ...prev, [key]: true }));
    setTestResults(prev => ({ ...prev, [key]: null }));
    try {
      const result = await testFn();
      setTestResults(prev => ({ ...prev, [key]: { ok: true, msg: result } }));
    } catch (e) {
      setTestResults(prev => ({ ...prev, [key]: { ok: false, msg: e.message } }));
    } finally {
      setTesting(prev => ({ ...prev, [key]: false }));
    }
  };

  const testCheckcle = () => testConnection('checkcle', 'CheckCle', async () => {
    const res = await fetch(`${draft.checkcleUrl}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: draft.checkcleEmail, password: draft.checkclePassword }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
    return 'Auth successful';
  });

  const testAMP = () => testConnection('amp', 'AMP', async () => {
    const res = await fetch(`${draft.ampUrl}/API/Core/Login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: draft.ampUsername, password: draft.ampPassword, token: '', rememberMe: false }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.sessionID) throw new Error('No session returned');
    return 'Login successful';
  });

  const testN8N = () => testConnection('n8n', 'n8n', async () => {
    const res = await fetch(draft.n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatInput: 'ping' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status} OK`;
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <TouchableOpacity onPress={save} style={[styles.saveBtn, saved && styles.saveBtnDone]}>
          <Ionicons name={saved ? 'checkmark' : 'save-outline'} size={18} color={saved ? '#00d26a' : '#7b7bff'} />
          <Text style={[styles.saveBtnText, saved && styles.saveBtnTextDone]}>
            {saved ? 'Saved' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <Section title="CheckCle" icon="pulse-outline">
          <Field label="URL" value={draft.checkcleUrl} onChange={v => update('checkcleUrl', v)} autoCapitalize="none" keyboardType="url" />
          <Field label="Email" value={draft.checkcleEmail} onChange={v => update('checkcleEmail', v)} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Password" value={draft.checkclePassword} onChange={v => update('checkclePassword', v)} secure />
          <TestRow testKey="checkcle" label="Test CheckCle" onPress={testCheckcle} result={testResults.checkcle} loading={testing.checkcle} />
        </Section>

        <Section title="AMP (Game Servers)" icon="game-controller-outline">
          <Field label="URL" value={draft.ampUrl} onChange={v => update('ampUrl', v)} autoCapitalize="none" keyboardType="url" />
          <Field label="Username" value={draft.ampUsername} onChange={v => update('ampUsername', v)} autoCapitalize="none" />
          <Field label="Password" value={draft.ampPassword} onChange={v => update('ampPassword', v)} secure />
          <TestRow testKey="amp" label="Test AMP" onPress={testAMP} result={testResults.amp} loading={testing.amp} />
        </Section>

        <Section title="Network Monitoring" icon="wifi-outline">
          <Field label="Netdata Hosts" value={draft.netdataHosts} onChange={v => update('netdataHosts', v)} autoCapitalize="none" />
          <Field label="ntopng URL" value={draft.ntopngUrl} onChange={v => update('ntopngUrl', v)} autoCapitalize="none" keyboardType="url" />
          <Field label="ntopng Token" value={draft.ntopngToken} onChange={v => update('ntopngToken', v)} autoCapitalize="none" secure />
          <Field label="Grafana URL" value={draft.grafanaUrl} onChange={v => update('grafanaUrl', v)} autoCapitalize="none" keyboardType="url" />
        </Section>

        <Section title="NOLA Chat" icon="chatbubble-ellipses-outline">
          <Field label="n8n Webhook URL" value={draft.n8nWebhookUrl} onChange={v => update('n8nWebhookUrl', v)} autoCapitalize="none" keyboardType="url" />
          <TestRow testKey="n8n" label="Test Webhook" onPress={testN8N} result={testResults.n8n} loading={testing.n8n} />
        </Section>

        <Section title="Polling" icon="timer-outline">
          <Field
            label="Services refresh interval (seconds)"
            value={String(draft.pollIntervalSeconds ?? 30)}
            onChange={v => update('pollIntervalSeconds', parseInt(v) || 30)}
            keyboardType="number-pad"
          />
        </Section>

        <Section title="Debug" icon="bug-outline">
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Debug mode</Text>
            <Switch
              value={draft.debugMode}
              onValueChange={v => update('debugMode', v)}
              trackColor={{ false: '#2a2a3e', true: '#7b7bff' }}
              thumbColor={draft.debugMode ? '#fff' : '#888'}
            />
          </View>
          {draft.debugMode && (
            <View style={styles.debugInfo}>
              <DebugLine label="CheckCle URL" value={draft.checkcleUrl} />
              <DebugLine label="AMP URL" value={draft.ampUrl} />
              <DebugLine label="n8n Webhook" value={draft.n8nWebhookUrl} />
            </View>
          )}
        </Section>

        <TouchableOpacity style={styles.resetBtn} onPress={reset}>
          <Ionicons name="refresh-outline" size={16} color="#ff4757" />
          <Text style={styles.resetBtnText}>Reset to Defaults</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, icon, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={16} color="#7b7bff" />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Field({ label, value, onChange, secure, autoCapitalize, keyboardType }) {
  const [show, setShow] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputRow}>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          secureTextEntry={secure && !show}
          autoCapitalize={autoCapitalize || 'sentences'}
          keyboardType={keyboardType || 'default'}
          autoCorrect={false}
          placeholderTextColor="#444"
        />
        {secure && (
          <TouchableOpacity onPress={() => setShow(v => !v)} style={styles.showBtn}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={16} color="#555" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function TestRow({ testKey, label, onPress, result, loading }) {
  return (
    <View style={styles.testRow}>
      <TouchableOpacity style={styles.testBtn} onPress={onPress} disabled={loading}>
        {loading
          ? <ActivityIndicator size="small" color="#7b7bff" />
          : <Ionicons name="flash-outline" size={14} color="#7b7bff" />
        }
        <Text style={styles.testBtnText}>{label}</Text>
      </TouchableOpacity>
      {result && (
        <Text style={[styles.testResult, result.ok ? styles.testOk : styles.testFail]}>
          {result.ok ? '✓' : '✗'} {result.msg}
        </Text>
      )}
    </View>
  );
}

function DebugLine({ label, value }) {
  return (
    <View style={styles.debugLine}>
      <Text style={styles.debugLabel}>{label}:</Text>
      <Text style={styles.debugValue} numberOfLines={1}>{value}</Text>
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
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1a1a2e', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
  },
  saveBtnDone: { backgroundColor: '#0d2a1a' },
  saveBtnText: { color: '#7b7bff', fontWeight: '600', fontSize: 14 },
  saveBtnTextDone: { color: '#00d26a' },
  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 16 },
  section: { backgroundColor: '#0f0f20', borderRadius: 14, overflow: 'hidden' },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#12122a', borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  sectionTitle: { color: '#aaa', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  sectionBody: { padding: 14, gap: 12 },
  field: { gap: 4 },
  fieldLabel: { color: '#666', fontSize: 11, letterSpacing: 0.3 },
  fieldInputRow: { flexDirection: 'row', alignItems: 'center' },
  fieldInput: {
    flex: 1, backgroundColor: '#1a1a2e', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    color: '#e0e0e0', fontSize: 14,
  },
  showBtn: { position: 'absolute', right: 10 },
  testRow: { gap: 6 },
  testBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: '#2a2a4e', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  testBtnText: { color: '#7b7bff', fontSize: 13 },
  testResult: { fontSize: 12, paddingLeft: 2 },
  testOk: { color: '#00d26a' },
  testFail: { color: '#ff4757' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { color: '#e0e0e0', fontSize: 14 },
  debugInfo: { backgroundColor: '#0a0a18', borderRadius: 8, padding: 10, gap: 6 },
  debugLine: { flexDirection: 'row', gap: 8 },
  debugLabel: { color: '#555', fontSize: 11, minWidth: 80 },
  debugValue: { color: '#888', fontSize: 11, flex: 1 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14, marginTop: 4,
  },
  resetBtnText: { color: '#ff4757', fontSize: 14 },
});
