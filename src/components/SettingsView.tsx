import React from 'react';
import { BackupSettings } from '../hooks/useBackupSettings';
import { DataSourceSettings, DataSourceMode } from '../config/server';
import { BackupPanel } from './BackupPanel';
import { ServerPanel } from './ServerPanel';
import { WebPlaybackSdkPlayer } from './WebPlaybackSdkPlayer';

interface Props {
  backup:           BackupSettings;
  onToggleBackup:   () => void;
  onSetSubdir:      (s: string) => void;
  onExportNow:      () => Promise<void>;
  dataSource:       DataSourceSettings;
  onSetMode:        (m: DataSourceMode) => void;
  onSetServerUrl:   (url: string) => void;
  onTestConnection: (url: string) => Promise<void>;
  autohideNav:      boolean;
  onToggleAutohide: (on: boolean) => void;
  isRemote?:        boolean;
  syncPhotos?:      boolean;
  onToggleSyncPhotos?: (on: boolean) => void;
  autohideBoardBar?: boolean;
  onToggleBoardAutohide?: (on: boolean) => void;
}

export const SettingsView: React.FC<Props> = ({
  backup, onToggleBackup, onSetSubdir, onExportNow,
  dataSource, onSetMode, onSetServerUrl, onTestConnection,
  autohideNav, onToggleAutohide,
  syncPhotos, onToggleSyncPhotos,
  autohideBoardBar, onToggleBoardAutohide,
  isRemote,
}) => (
  <div className="settings-page">
    <h2 className="settings-title">Settings</h2>

    <section className="settings-section">
      <h3 className="settings-heading">Backup</h3>
      <p className="settings-sub">
        Export your whole library to CSV - or let it back up automatically after every sync.
      </p>
      <BackupPanel
        backup={backup}
        onToggle={onToggleBackup}
        onSetSubdir={onSetSubdir}
        onExportNow={onExportNow}
        dataSource={dataSource}
      />
    </section>

    <section className="settings-section">
      <h3 className="settings-heading">Server</h3>
      <p className="settings-sub">
        Choose whether your library lives on this device or on your media server, and manage
        the connection.
      </p>
      <ServerPanel
        dataSource={dataSource}
        onSetMode={onSetMode}
        onSetServerUrl={onSetServerUrl}
        onTestConnection={onTestConnection}
      />
    </section>

    <section className="settings-section">
      <h3 className="settings-heading">Display</h3>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={autohideNav}
          onChange={(e) => onToggleAutohide(e.target.checked)}
        />
        <span>Hide the bottom bar while scrolling down (it returns when you scroll up)</span>
      </label>
      {onToggleSyncPhotos && (
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={syncPhotos ?? true}
            onChange={(e) => onToggleSyncPhotos(e.target.checked)}
          />
          <span>Sync and show photos (turn off for low-RAM devices)</span>
        </label>
      )}
      {onToggleBoardAutohide && (
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={autohideBoardBar ?? false}
            onChange={(e) => onToggleBoardAutohide(e.target.checked)}
          />
          <span>Autohide the search/sort bar while scrolling down</span>
        </label>
      )}
    </section>

    <section className="settings-section">
      <WebPlaybackSdkPlayer />
    </section>

  </div>
);