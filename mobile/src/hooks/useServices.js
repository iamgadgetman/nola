import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from '../context/SettingsContext';
import { SERVICE_GROUPS } from '../constants/config';

const CACHE_KEY = '@nola_services_cache';

async function fetchWithToken(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return res;
}

async function authenticate(checkcleUrl, email, password) {
  const res = await fetch(`${checkcleUrl}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) throw new Error('CheckCle auth failed');
  const { token } = await res.json();
  return token;
}

export function useServices() {
  const { settings } = useSettings();
  const [services, setServices]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [isStale, setIsStale]       = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const pollMs = (settings.pollIntervalSeconds || 30) * 1000;

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

    const { checkcleUrl, checkcleEmail, checkclePassword } = settings;

    try {
      let token = await authenticate(checkcleUrl, checkcleEmail, checkclePassword);

      let svcsRes = await fetchWithToken(
        `${checkcleUrl}/api/collections/services/records?perPage=200`, token
      );

      // On 401: re-authenticate once and retry
      if (svcsRes.status === 401) {
        token = await authenticate(checkcleUrl, checkcleEmail, checkclePassword);
        svcsRes = await fetchWithToken(
          `${checkcleUrl}/api/collections/services/records?perPage=200`, token
        );
      }

      if (!svcsRes.ok) throw new Error(`Failed to fetch services (${svcsRes.status})`);

      const data = await svcsRes.json();
      const enriched = data.items.map(s => ({
        ...s,
        group: SERVICE_GROUPS[s.name] || 'Other',
      }));

      setServices(enriched);
      setLastUpdated(new Date());
      setIsStale(false);

      // Cache for offline fallback
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
        items: enriched,
        timestamp: Date.now(),
      }));
    } catch (e) {
      setError(e.message);
      // Fall back to cached data if available
      await loadFromCache();
    } finally {
      setLoading(false);
    }
  }, [
    settings.checkcleUrl,
    settings.checkcleEmail,
    settings.checkclePassword,
    loadFromCache,
  ]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  const stats = {
    total:  services.length,
    up:     services.filter(s => s.status === 'up').length,
    down:   services.filter(s => s.status === 'down').length,
    paused: services.filter(s => s.status === 'paused').length,
  };

  return { services, loading, error, isStale, lastUpdated, refresh, stats };
}
