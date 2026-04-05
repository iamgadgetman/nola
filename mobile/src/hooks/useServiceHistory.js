import { useState, useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';

export function useServiceHistory() {
  const { settings } = useSettings();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHistory = useCallback(async (serviceId, limit = 60) => {
    setLoading(true);
    setError(null);
    try {
      const authRes = await fetch(
        `${settings.checkcleUrl}/api/collections/_superusers/auth-with-password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identity: settings.checkcleEmail, password: settings.checkclePassword }),
        }
      );
      if (!authRes.ok) throw new Error('Auth failed');
      const { token } = await authRes.json();

      const res = await fetch(
        `${settings.checkcleUrl}/api/collections/uptime_data/records?filter=service_id%3D'${serviceId}'&sort=-created&perPage=${limit}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      setHistory(data.items.reverse()); // chronological order
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.checkcleUrl, settings.checkcleEmail, settings.checkclePassword]);

  const toggleMonitor = useCallback(async (serviceId, active) => {
    const authRes = await fetch(
      `${settings.checkcleUrl}/api/collections/_superusers/auth-with-password`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: settings.checkcleEmail, password: settings.checkclePassword }),
      }
    );
    if (!authRes.ok) throw new Error('Auth failed');
    const { token } = await authRes.json();

    const res = await fetch(
      `${settings.checkcleUrl}/api/collections/services/records/${serviceId}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      }
    );
    if (!res.ok) throw new Error('Failed to update monitor');
    return res.json();
  }, [settings.checkcleUrl, settings.checkcleEmail, settings.checkclePassword]);

  return { history, loading, error, fetchHistory, toggleMonitor };
}
