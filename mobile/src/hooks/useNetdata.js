import { useState, useCallback, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';

export function useNetdata() {
  const { settings } = useSettings();
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const hostString = settings.netdataHosts || '';
      if (!hostString.trim()) { setHosts([]); return; }

      const parsed = {};
      hostString.split(',').forEach(h => {
        const idx = h.indexOf(':http');
        if (idx > 0) {
          parsed[h.slice(0, idx).trim()] = 'http' + h.slice(idx + 1).trim();
        }
      });

      const results = await Promise.all(
        Object.entries(parsed).map(async ([name, baseUrl]) => {
          try {
            const res = await fetch(`${baseUrl}/api/v1/allmetrics?format=json`, {
              signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const d = await res.json();

            const cpuIdle = d?.['system.cpu']?.dimensions?.idle?.value;
            const cpu = cpuIdle !== undefined ? parseFloat((100 - cpuIdle).toFixed(1)) : null;

            const ramUsed = d?.['system.ram']?.dimensions?.used?.value;
            const ramFree = d?.['system.ram']?.dimensions?.free?.value;
            const ramBuff = (d?.['system.ram']?.dimensions?.buffers?.value || 0)
              + (d?.['system.ram']?.dimensions?.cached?.value || 0);
            let ram = null, ramTotal = null;
            if (ramUsed !== undefined && ramFree !== undefined) {
              ramTotal = ramUsed + ramFree + ramBuff;
              ram = ramTotal > 0 ? parseFloat(((ramUsed / ramTotal) * 100).toFixed(1)) : 0;
            }

            const uptime = d?.['system.uptime']?.dimensions?.uptime?.value;
            const uptimeStr = uptime !== undefined
              ? uptime > 86400
                ? `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h`
                : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
              : null;

            const netIn = d?.['system.net']?.dimensions?.received?.value;
            const netOut = d?.['system.net']?.dimensions?.sent?.value;

            return { name, baseUrl, cpu, ram, ramUsed, ramTotal, uptime: uptimeStr, netIn, netOut, ok: true };
          } catch (e) {
            return { name, baseUrl, ok: false, error: e.message };
          }
        })
      );

      setHosts(results);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.netdataHosts]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  return { hosts, loading, error, lastUpdated, refresh };
}
