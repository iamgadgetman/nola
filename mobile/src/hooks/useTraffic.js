import { useState, useCallback, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';

function formatBits(bps) {
  if (!bps && bps !== 0) return '—';
  const abs = Math.abs(bps);
  if (abs >= 1e9) return `${(bps / 1e9).toFixed(1)} Gbps`;
  if (abs >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  if (abs >= 1e3) return `${(bps / 1e3).toFixed(1)} Kbps`;
  return `${bps} bps`;
}

export function useTraffic() {
  const { settings } = useSettings();
  const [interfaces, setInterfaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = settings.ntopngUrl || '';
      const token = settings.ntopngToken || '';
      if (!url || !token) { setInterfaces([]); return; }

      const headers = { Authorization: `Token ${token}` };

      const ifRes = await fetch(`${url}/lua/rest/v2/get/ntopng/interfaces.lua`, {
        headers, signal: AbortSignal.timeout(8000),
      });
      if (!ifRes.ok) throw new Error(`ntopng HTTP ${ifRes.status}`);
      const ifData = await ifRes.json();
      const ifList = ifData?.rsp ?? [];

      const results = await Promise.all(
        ifList.map(async (iface) => {
          try {
            const dRes = await fetch(
              `${url}/lua/rest/v2/get/interface/data.lua?ifid=${iface.ifid}`,
              { headers, signal: AbortSignal.timeout(5000) }
            );
            if (!dRes.ok) return null;
            const d = await dRes.json();
            const rsp = d?.rsp ?? {};
            return {
              name: iface.ifname || iface.name || `if${iface.ifid}`,
              ifid: iface.ifid,
              bpsIn: rsp.bytes_download ?? null,
              bpsOut: rsp.bytes_upload ?? null,
              bpsInFmt: formatBits(rsp.bytes_download),
              bpsOutFmt: formatBits(rsp.bytes_upload),
              pktsIn: rsp.packets_download ?? null,
              pktsOut: rsp.packets_upload ?? null,
              hosts: rsp.num_hosts ?? null,
              flows: rsp.num_flows ?? null,
            };
          } catch (_) { return null; }
        })
      );

      setInterfaces(results.filter(Boolean));
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.ntopngUrl, settings.ntopngToken]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  return { interfaces, loading, error, lastUpdated, refresh };
}
