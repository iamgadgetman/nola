import { useState, useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';
import { safeJson } from '../utils/api';

function abortSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export function useServiceHistory() {
  const { settings } = useSettings();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const authHeaders = useCallback(() => {
    const h = { 'Content-Type': 'application/json' };
    if (settings.dashboardToken) h['Authorization'] = `Bearer ${settings.dashboardToken}`;
    return h;
  }, [settings.dashboardToken]);

  const fetchHistory = useCallback(async (serviceId, limit = 60) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${settings.dashboardUrl}/api/checkcle/history/${serviceId}?limit=${limit}`,
        { headers: authHeaders(), signal: abortSignal(10000) }
      );
      if (!res.ok) {
        const body = await res.text().then(t => { try { return JSON.parse(t); } catch { return {}; } });
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await safeJson(res);
      setHistory((data.items || []).reverse());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.dashboardUrl, authHeaders]);

  const toggleMonitor = useCallback(async (serviceId, active) => {
    const res = await fetch(
      `${settings.dashboardUrl}/api/checkcle/services/${serviceId}`,
      {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ active }),
      }
    );
    if (!res.ok) {
      const body = await res.text().then(t => { try { return JSON.parse(t); } catch { return {}; } });
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }, [settings.dashboardUrl, authHeaders]);

  return { history, loading, error, fetchHistory, toggleMonitor };
}
