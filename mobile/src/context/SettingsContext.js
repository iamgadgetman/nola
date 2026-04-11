import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// Keys stored in SecureStore (encrypted on-device) rather than plaintext AsyncStorage
const SENSITIVE_KEYS = ['checkclePassword', 'ampPassword', 'ntopngToken'];

const STORAGE_KEY = '@nola_settings';

export const DEFAULTS = {
  checkcleUrl:         'https://checkcle.galaxy.rip',
  checkcleEmail:       '',
  checkclePassword:    '',
  ampUrl:              'https://holodeck.galaxy.rip',
  ampUsername:         '',
  ampPassword:         '',
  n8nWebhookUrl:       '',
  netdataHosts:        '',
  ntopngUrl:           '',
  ntopngToken:         '',
  grafanaUrl:          'https://grafana.galaxy.rip',
  debugMode:           false,
  pollIntervalSeconds: 30,
};

async function loadAllSettings() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const stored = raw ? JSON.parse(raw) : {};

  const sensitive = {};
  await Promise.all(SENSITIVE_KEYS.map(async (key) => {
    const val = await SecureStore.getItemAsync(key);
    if (val !== null) sensitive[key] = val;
  }));

  return { ...DEFAULTS, ...stored, ...sensitive };
}

async function persistAllSettings(next) {
  // Non-sensitive → AsyncStorage
  const nonSensitive = { ...next };
  SENSITIVE_KEYS.forEach(k => delete nonSensitive[k]);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nonSensitive));

  // Sensitive → SecureStore
  await Promise.all(
    SENSITIVE_KEYS.map(k => SecureStore.setItemAsync(k, next[k] || ''))
  );
}

const SettingsContext = createContext({ settings: DEFAULTS, saveSettings: async () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadAllSettings()
      .then(all => setSettings(all))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const saveSettings = useCallback(async (updates) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    await persistAllSettings(next);
  }, [settings]);

  if (!loaded) return null;
  return (
    <SettingsContext.Provider value={{ settings, saveSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
