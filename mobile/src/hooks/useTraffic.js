import { useState, useCallback, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { safeJson } from '../utils/api';

function abortSignal(ms) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export function useTraffic() {
  const { settings } = useSettings();
  const [interfaces, setInterfaces]   = useState([]);
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

      if (!data.wan?.series?.length) {
        setInterfaces([]);
        return;
      }

      const mapped = data.wan.series.map(s => {
        const last  = s.rx_mbps.length - 1;
        const rxMbps = s.rx_mbps[last] ?? null;
        const txMbps = s.tx_mbps[last] ?? null;
        return {
          name:      s.host,
          ifid:      s.host,
          bpsIn:     rxMbps != null ? rxMbps * 1e6 / 8 : null,
          bpsOut:    txMbps != null ? txMbps * 1e6 / 8 : null,
          bpsInFmt:  rxMbps != null ? `${rxMbps.toFixed(1)} Mbps` : '—',
          bpsOutFmt: txMbps != null ? `${txMbps.toFixed(1)} Mbps` : '—',
          hosts:     null,
          flows:     null,
        };
      });
      setInterfaces(mapped);
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

  return { interfaces, loading, error, lastUpdated, refresh };
}
