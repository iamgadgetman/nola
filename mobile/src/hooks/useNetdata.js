import { useState, useCallback, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { safeJson } from '../utils/api';

function abortSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export function useNetdata() {
  const { settings } = useSettings();
  const [hosts, setHosts]             = useState([]);
  const [ups, setUps]                 = useState([]);
  const [alerts, setAlerts]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = settings.dashboardToken
        ? { Authorization: `Bearer ${settings.dashboardToken}` }
        : {};
      const res = await fetch(`${settings.dashboardUrl}/api/data`, {
        headers,
        signal: abortSignal(10000),
      });
      if (!res.ok) {
        const body = await res.text().then(t => { try { return JSON.parse(t); } catch { return {}; } });
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await safeJson(res);
      const mapped = (data.hosts || []).map(h => ({
        name:   h.name,
        type:   h.type,
        ok:     h.up,
        cpu:    h.cpu_pct,
        ram:    h.ram_pct,
        disk:   h.disk_pct,
        uptime: h.uptime || null,
        netIn:  null,
        netOut: null,
      }));
      setHosts(mapped);
      setUps(Array.isArray(data.ups) ? data.ups : []);
      setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.dashboardUrl, settings.dashboardToken]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  return { hosts, ups, alerts, loading, error, lastUpdated, refresh };
}
