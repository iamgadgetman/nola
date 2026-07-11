import React, { useState, useEffect } from 'react';
import { safeJson } from '../utils/api';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Switch, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings, DEFAULTS } from '../context/SettingsContext';

function abortSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export default function SettingsScreen() {
  const { settings, saveSettings } = useSettings();
  const [draft, setDraft]           = useState({ ...settings });
  const [saved, setSaved]           = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting]       = useState(false);

  useEffect(() => { setDraft({ ...settings }); }, [settings]);

  const update = (key, value) => setDraft(prev => ({ ...prev, [key]: value }));

  const save = async () => {
    const url = draft.dashboardUrl;
    if (url) {
      try { new URL(url); } catch {
        Alert.alert('Invalid URL', `Dashboard URL is not valid:\n"${url}"`);
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

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const headers = draft.dashboardToken
        ? { Authorization: `Bearer ${draft.dashboardToken}` }
        : {};
      const res = await fetch(`${draft.dashboardUrl}/api/health`, {
        headers,
        signal: abortSignal(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await safeJson(res);
      setTestResult({ ok: true, msg: `Connected — uptime ${data.uptime}s` });
    } catch (e) {
      setTestResult({ ok: false, msg: e.message });
    } finally {
      setTesting(false);
    }
  };

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

        <Section title="Dashboard" icon="server-outline">
          <Field
            label="Dashboard URL"
            value={draft.dashboardUrl}
            onChange={v => update('dashboardUrl', v)}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://nola.example.com"
          />
          <Field
            label="API Token"
            value={draft.dashboardToken}
            onChange={v => update('dashboardToken', v)}
            autoCapitalize="none"
            secure
            placeholder="Leave blank if AUTH_ENABLED=false"
          />
          <View style={styles.testRow}>
            <TouchableOpacity style={styles.testBtn} onPress={testConnection} disabled={testing}>
              {testing
                ? <ActivityIndicator size="small" color="#7b7bff" />
                : <Ionicons name="flash-outline" size={14} color="#7b7bff" />
              }
              <Text style={styles.testBtnText}>Test Connection</Text>
            </TouchableOpacity>
            {testResult && (
              <Text style={[styles.testResult, testResult.ok ? styles.testOk : styles.testFail]}>
                {testResult.ok ? '✓' : '✗'} {testResult.msg}
              </Text>
            )}
          </View>
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
              <DebugLine label="Dashboard URL" value={draft.dashboardUrl} />
              <DebugLine label="Token set"     value={draft.dashboardToken ? 'yes' : 'no'} />
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

function Field({ label, value, onChange, secure, autoCapitalize, keyboardType, placeholder }) {
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
          placeholder={placeholder || ''}
          placeholderTextColor="#333"
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
