import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';
import { SERVICE_GROUPS } from '../constants/config';

const REFRESH_INTERVAL = 30000;

export function useServices() {
  const { settings } = useSettings();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const authRes = await fetch(
        `${settings.checkcleUrl}/api/collections/_superusers/auth-with-password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identity: settings.checkcleEmail,
            password: settings.checkclePassword,
          }),
        }
      );
      if (!authRes.ok) throw new Error('CheckCle auth failed');
      const { token } = await authRes.json();

      const svcsRes = await fetch(
        `${settings.checkcleUrl}/api/collections/services/records?perPage=200`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!svcsRes.ok) throw new Error('Failed to fetch services');
      const data = await svcsRes.json();

      const enriched = data.items.map(s => ({
        ...s,
        group: SERVICE_GROUPS[s.name] || 'Other',
      }));
      setServices(enriched);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.checkcleUrl, settings.checkcleEmail, settings.checkclePassword]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [refresh]);

  const stats = {
    total: services.length,
    up: services.filter(s => s.status === 'up').length,
    down: services.filter(s => s.status === 'down').length,
    paused: services.filter(s => s.status === 'paused').length,
  };

  return { services, loading, error, lastUpdated, refresh, stats };
}
