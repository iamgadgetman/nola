import { useState, useCallback, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { safeJson } from '../utils/api';

function abortSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

// Consumes /api/patching (server.js → the weekly Ansible patch-audit report).
// Unlike the other blocks this lives on its own endpoint, not inside /api/data,
// and it refreshes on a slow cadence — the underlying report is written weekly,
// so polling it as often as the live metrics would be pure noise.
export function usePatching() {
  const { settings } = useSettings();
  const [patching, setPatching]       = useState(null);
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
      const res = await fetch(`${settings.dashboardUrl}/api/patching`, {
        headers,
        signal: abortSignal(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await safeJson(res);
      // The endpoint answers 200 with {ok:false, error} when the report is
      // missing, so a bad report has to be surfaced from the body, not the status.
      if (data && data.ok === false) {
        setPatching(null);
        setError(data.error || 'No patch report');
      } else {
        setPatching(data || null);
      }
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.dashboardUrl, settings.dashboardToken]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 300000);
    return () => clearInterval(t);
  }, [refresh]);

  return { patching, loading, error, lastUpdated, refresh };
}
