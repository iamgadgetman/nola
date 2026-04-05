import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@nola_settings';

export const DEFAULTS = {
  checkcleUrl: 'https://checkcle.galaxy.rip',
  checkcleEmail: 'gadgetmansemail@gmail.com',
  checkclePassword: 'mcu8mC@4',
  ampUrl: 'https://holodeck.galaxy.rip',
  ampUsername: 'gadget',
  ampPassword: 'mcu8mC@4',
  n8nWebhookUrl: 'https://n8n.gadgetman.cloud/webhook/jeeves',
  netdataHosts: 'hawk:http://10.0.11.100:19999,fort:http://10.0.18.100:19999',
  ntopngUrl: 'http://10.0.16.100:3005',
  ntopngToken: '06cb62d85766b74e0b5404060e52cfb4',
  grafanaUrl: 'https://grafana.galaxy.rip',
  debugMode: false,
};

const SettingsContext = createContext({ settings: DEFAULTS, saveSettings: async () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try {
          setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
        } catch (_) {}
      }
      setLoaded(true);
    });
  }, []);

  const saveSettings = useCallback(async (updates) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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
