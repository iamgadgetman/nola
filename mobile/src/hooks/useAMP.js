import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';
import { safeJson } from '../utils/api';

function abortSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

const REFRESH_INTERVAL = 10000;

export function useAMP() {
  const { settings } = useSettings();
  const [instances, setInstances]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [actionLoading, setActionLoading] = useState({});

  const authHeaders = useCallback(() => {
    const h = { 'Content-Type': 'application/json' };
    if (settings.dashboardToken) h['Authorization'] = `Bearer ${settings.dashboardToken}`;
    return h;
  }, [settings.dashboardToken]);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${settings.dashboardUrl}/api/amp/instances`, {
        headers: authHeaders(),
        signal: abortSignal(12000),
      });
      if (!res.ok) {
        const body = await res.text().then(t => { try { return JSON.parse(t); } catch { return {}; } });
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await safeJson(res);
      setInstances(Array.isArray(data) ? data : []);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.dashboardUrl, authHeaders]);

  const doAction = useCallback(async (instanceId, action) => {
    setActionLoading(prev => ({ ...prev, [instanceId]: action }));
    try {
      const res = await fetch(`${settings.dashboardUrl}/api/amp/action`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action, instanceId }),
      });
      if (!res.ok) {
        const body = await res.text().then(t => { try { return JSON.parse(t); } catch { return {}; } });
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setTimeout(refresh, 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setActionLoading(prev => ({ ...prev, [instanceId]: null }));
    }
  }, [settings.dashboardUrl, authHeaders, refresh]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [refresh]);

  return {
    instances,
    loading,
    error,
    lastUpdated,
    refresh,
    actionLoading,
    startInstance:   (id) => doAction(id, 'Start'),
    stopInstance:    (id) => doAction(id, 'Stop'),
    restartInstance: (id) => doAction(id, 'Restart'),
  };
}
