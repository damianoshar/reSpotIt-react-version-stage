import { useState, useEffect, useCallback } from 'react';
import { Preferences } from '@capacitor/preferences';

export interface BackupSettings {
  enabled:     boolean;
  subdirName:  string;
  lastBackup:  string; // ISO date string or ''
  lastPath:    string;
}

const PREF_KEY = 'backup_settings';

const DEFAULTS: BackupSettings = {
  enabled:    false,
  subdirName: 'SpotifyBackups',
  lastBackup: '',
  lastPath:   '',
};

export function useBackupSettings() {
  const [settings, setSettings] = useState<BackupSettings>(DEFAULTS);
  const [loaded,   setLoaded]   = useState(false);

  // Load persisted settings on mount
  useEffect(() => {
    Preferences.get({ key: PREF_KEY })
      .then(({ value }) => {
        if (value) {
          try { setSettings({ ...DEFAULTS, ...JSON.parse(value) }); }
          catch { /* corrupt prefs, use defaults */ }
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (next: BackupSettings) => {
    setSettings(next);
    await Preferences.set({ key: PREF_KEY, value: JSON.stringify(next) });
  }, []);

  const toggle       = useCallback(() => save({ ...settings, enabled: !settings.enabled }), [settings, save]);
  const setSubdir    = useCallback((subdirName: string) => save({ ...settings, subdirName }), [settings, save]);
  const recordBackup = useCallback((path: string) =>
    save({ ...settings, lastBackup: new Date().toISOString(), lastPath: path }),
    [settings, save]
  );

  return { settings, loaded, toggle, setSubdir, recordBackup };
}
