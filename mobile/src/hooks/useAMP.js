import { useState, useEffect, useCallback, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';

const REFRESH_INTERVAL = 10000;

export function useAMP() {
  const { settings } = useSettings();
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const sessionRef = useRef(null);

  const ampRequest = useCallback(async (endpoint, body) => {
    const res = await fetch(`${settings.ampUrl}/API/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`AMP ${endpoint} failed (${res.status})`);
    return res.json();
  }, [settings.ampUrl]);

  const login = useCallback(async () => {
    const data = await ampRequest('Core/Login', {
      username: settings.ampUsername,
      password: settings.ampPassword,
      token: '',
      rememberMe: false,
    });
    if (!data.sessionID) throw new Error('AMP login returned no session');
    return data.sessionID;
  }, [ampRequest, settings.ampUsername, settings.ampPassword]);

  const getSession = useCallback(async () => {
    if (!sessionRef.current) sessionRef.current = await login();
    return sessionRef.current;
  }, [login]);

  const ampCall = useCallback(async (endpoint, params = {}) => {
    let session = await getSession();
    try {
      return await ampRequest(endpoint, { SESSIONID: session, ...params });
    } catch (_) {
      sessionRef.current = await login();
      return await ampRequest(endpoint, { SESSIONID: sessionRef.current, ...params });
    }
  }, [getSession, ampRequest, login]);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await ampCall('ADSModule/GetInstances');
      const all = [];
      for (const controller of data) {
        const list = controller.AvailableInstances ?? controller.Instances ?? [];
        for (const inst of list) {
          if (inst.Module !== 'ADS') all.push(inst);
        }
      }
      setInstances(all);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
      sessionRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [ampCall]);

  const doAction = useCallback(async (instanceId, action) => {
    setActionLoading(prev => ({ ...prev, [instanceId]: action }));
    try {
      await ampCall(`ADSModule/${action}Instance`, { instanceId });
      setTimeout(refresh, 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setActionLoading(prev => ({ ...prev, [instanceId]: null }));
    }
  }, [ampCall, refresh]);

  useEffect(() => {
    sessionRef.current = null;
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
    startInstance: (id) => doAction(id, 'Start'),
    stopInstance: (id) => doAction(id, 'Stop'),
    restartInstance: (id) => doAction(id, 'Restart'),
  };
}
