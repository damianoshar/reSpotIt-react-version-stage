import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { DataSourceSettings, DataSourceMode } from '../config/server';

interface Props {
  dataSource:       DataSourceSettings;
  onSetMode:        (m: DataSourceMode) => void;
  onSetServerUrl:   (url: string) => void;
  onTestConnection: (url: string) => Promise<void>;
}

export const ServerPanel: React.FC<Props> = ({
  dataSource, onSetMode, onSetServerUrl, onTestConnection,
}) => {
  const [serverUrlVal, setServerUrlVal] = useState(dataSource.serverUrl);
  const [testing,      setTesting]      = useState(false);
  const [testMsg,      setTestMsg]      = useState('');

  useEffect(() => { setServerUrlVal(dataSource.serverUrl); }, [dataSource.serverUrl]);

  const handleTestConnection = async () => {
    setTesting(true); setTestMsg('');
    try {
      await onTestConnection(serverUrlVal);
      setTestMsg('✓ Server reachable');
    } catch (e: any) {
      setTestMsg('✕ ' + (e?.message ?? 'Connection failed'));
    } finally {
      setTesting(false);
    }
  };

  const handleServerUrlBlur = () => {
    if (serverUrlVal.trim() && serverUrlVal.trim() !== dataSource.serverUrl) {
      onSetServerUrl(serverUrlVal);
    }
  };

  return (
    <div className="backup-panel">
      <p className="sync-desc">
        <strong>On this device</strong> keeps everything in the app (works offline).
        {' '}<strong>Media server</strong> runs sync + database on your Docker server.
      </p>
      <div className="backup-row" role="radiogroup" aria-label="Data source">
        <div className="backup-row-label">
          <span className="backup-row-title">On this device</span>
        </div>
        <button className={'toggle-btn ' + (dataSource.mode === 'local' ? 'on' : '')}
                onClick={() => onSetMode('local')} role="radio"
                aria-checked={dataSource.mode === 'local'} aria-label="Use on-device library">
          <span className="toggle-thumb" />
        </button>
      </div>
      <div className="backup-row" style={{ marginTop: '0.5rem' }}>
        <div className="backup-row-label">
          <span className="backup-row-title">Media server</span>
        </div>
        <button className={'toggle-btn ' + (dataSource.mode === 'remote' ? 'on' : '')}
                onClick={() => onSetMode('remote')} role="radio"
                aria-checked={dataSource.mode === 'remote'} aria-label="Use media server">
          <span className="toggle-thumb" />
        </button>
      </div>
      {dataSource.mode === 'remote' && (
        <>
          <div className="filter-group" style={{ marginTop: '0.75rem' }}>
            <label className="filter-label" htmlFor="server-url">Server URL</label>
            <input id="server-url" className="search-input"
                   type="url" placeholder="http://127.0.0.1:4000"
                   value={serverUrlVal}
                   onChange={(e) => setServerUrlVal(e.target.value)}
                   onBlur={handleServerUrlBlur}
                   onKeyDown={(e) => e.key === 'Enter' && handleServerUrlBlur()} />
            {Capacitor.isNativePlatform() && (
              <p className="sync-desc" style={{ marginTop: '0.35rem' }}>
                On Android, use an HTTPS URL, or adb reverse with
                {' '}http://127.0.0.1:8000 (LAN HTTP is blocked).
              </p>
            )}
          </div>
          <button className={'sync-btn full-width ' + (testing ? 'syncing' : '')}
                  onClick={handleTestConnection} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testMsg && (
            <p className="sync-desc" role="status" style={{ marginTop: '0.5rem' }}>{testMsg}</p>
          )}
        </>
      )}
    </div>
  );
};
