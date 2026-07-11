import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from '../context/SettingsContext';
import { SERVICE_GROUPS } from '../constants/config';
import { safeJson } from '../utils/api';

function abortSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

const CACHE_KEY = '@nola_services_cache';

export function useServices() {
  const { settings } = useSettings();
  const [services, setServices]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [isStale, setIsStale]         = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const pollMs = 30 * 1000;

  const authHeaders = useCallback(() => {
    const h = { 'Content-Type': 'application/json' };
    if (settings.dashboardToken) h['Authorization'] = `Bearer ${settings.dashboardToken}`;
    return h;
  }, [settings.dashboardToken]);

  const loadFromCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const { items, timestamp } = JSON.parse(raw);
      setServices(items);
      setLastUpdated(new Date(timestamp));
      setIsStale(true);
      return true;
    } catch {
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${settings.dashboardUrl}/api/checkcle/services`, {
        headers: authHeaders(),
        signal: abortSignal(10000),
      });
      if (!res.ok) {
        const body = await res.text().then(t => { try { return JSON.parse(t); } catch { return {}; } });
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await safeJson(res);
      const enriched = (data.items || []).map(s => ({
        ...s,
        group: SERVICE_GROUPS[s.name] || 'Other',
      }));
      setServices(enriched);
      setLastUpdated(new Date());
      setIsStale(false);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
        items: enriched,
        timestamp: Date.now(),
      }));
    } catch (e) {
      setError(e.message);
      await loadFromCache();
    } finally {
      setLoading(false);
    }
  }, [settings.dashboardUrl, authHeaders, loadFromCache]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
  }, [refresh]);

  const stats = {
    total:  services.length,
    up:     services.filter(s => s.status === 'up').length,
    down:   services.filter(s => s.status === 'down').length,
    paused: services.filter(s => s.status === 'paused').length,
  };

  return { services, loading, error, isStale, lastUpdated, refresh, stats };
}
