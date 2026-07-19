import { useState, useCallback, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { safeJson } from '../utils/api';

function abortSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

const REFRESH_INTERVAL = 10000;

// Consumes the `databases` block from /api/data (server.js → fetchDatabases,
// sourced from mysqld_exporter / job="mysql" in Prometheus). One entry per DB.
export function useDatabases() {
  const { settings } = useSettings();
  const [databases, setDatabases]     = useState([]);
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
      const dbs = data.databases || null;
      setDatabases(Array.isArray(dbs) ? dbs : []);
      // Surface a DB-specific fetch note even when the rest of /api/data succeeds
      setError(dbs ? null : (data.errors?.databases || null));
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

  return { databases, loading, error, lastUpdated, refresh };
}
