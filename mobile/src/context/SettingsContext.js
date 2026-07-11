import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@nola_settings';

export const DEFAULTS = {
  dashboardUrl:   'https://nola.example.com',
  dashboardToken: '',
  debugMode:      false,
};

async function loadAllSettings() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
}

async function persistAllSettings(next) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

const SettingsContext = createContext({ settings: DEFAULTS, saveSettings: async () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loaded, setLoaded]     = useState(false);

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
