import { useState, useCallback, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { safeJson } from '../utils/api';

function abortSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

const REFRESH_INTERVAL = 10000;

// Consumes the `containers` block that the dashboard already exposes on
// /api/data (server.js → fetchContainers, sourced from cAdvisor in Prometheus).
// Returns the flat top list, the per-host map, and the running count.
export function useContainers() {
  const { settings } = useSettings();
  const [byHost, setByHost]           = useState({});
  const [containers, setContainers]   = useState([]);
  const [running, setRunning]         = useState(null);
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
      const ctr = data.containers || null;
      setByHost(ctr?.by_host || {});
      setContainers(ctr?.containers || []);
      setRunning(ctr?.running ?? null);
      // Surface a container-specific fetch error even when the rest of /api/data succeeds
      setError(ctr ? null : (data.errors?.containers || null));
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.dashboardUrl, settings.dashboardToken]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(t);
  }, [refresh]);

  return { byHost, containers, running, loading, error, lastUpdated, refresh };
}
