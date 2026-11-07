import { useState, useEffect, useCallback } from 'react';
import { Preferences } from '@capacitor/preferences';
import {
  DataSourceMode, DataSourceSettings, DEFAULT_DATA_SOURCE,
  DATA_SOURCE_PREFS_KEY, normalizeServerUrl,
} from '../config/server';
import { checkServerHealth } from '../services/remote/apiClient';

// ---------------------------------------------------------------------------
// Data source — local on-device DB vs network Docker server.
// Persisted like backup settings; defaults to local (today's behavior).
// ---------------------------------------------------------------------------

export function useDataSource() {
  const [settings, setSettings] = useState<DataSourceSettings>(DEFAULT_DATA_SOURCE);
  const [loaded,   setLoaded]   = useState(false);

  useEffect(() => {
    Preferences.get({ key: DATA_SOURCE_PREFS_KEY })
      .then(({ value }) => {
        if (value) {
          try {
            const parsed = JSON.parse(value) as Partial<DataSourceSettings>;
            setSettings({
              mode:      parsed.mode === 'remote' ? 'remote' : 'local',
              serverUrl: typeof parsed.serverUrl === 'string' && parsed.serverUrl.trim()
                ? normalizeServerUrl(parsed.serverUrl)
                : DEFAULT_DATA_SOURCE.serverUrl,
            });
          } catch { /* corrupt prefs, use defaults */ }
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (next: DataSourceSettings) => {
    setSettings(next);
    await Preferences.set({ key: DATA_SOURCE_PREFS_KEY, value: JSON.stringify(next) });
  }, []);

  const setMode = useCallback((mode: DataSourceMode) => {
    setSettings((prev) => {
      const next = { ...prev, mode };
      Preferences.set({ key: DATA_SOURCE_PREFS_KEY, value: JSON.stringify(next) });
      return next;
    });
  }, []);

  const setServerUrl = useCallback((serverUrl: string) => {
    const normalized = normalizeServerUrl(serverUrl);
    setSettings((prev) => {
      const next = { ...prev, serverUrl: normalized || DEFAULT_DATA_SOURCE.serverUrl };
      Preferences.set({ key: DATA_SOURCE_PREFS_KEY, value: JSON.stringify(next) });
      return next;
    });
  }, []);

  /** Probes {url}/health; resolves on OK, throws with a friendly message otherwise. */
  const testConnection = useCallback(async (url: string): Promise<void> => {
    await checkServerHealth(url);
  }, []);

  return { settings, loaded, setMode, setServerUrl, testConnection, save };
}
