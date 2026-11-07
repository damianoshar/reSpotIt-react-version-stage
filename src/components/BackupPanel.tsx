import React, { useEffect, useState } from 'react';
import { BackupSettings } from '../hooks/useBackupSettings';
import { DataSourceSettings } from '../config/server';
import { fetchExportHistory, ExportHistoryItem } from '../services/remote/libraryRemote';

interface Props {
  backup:      BackupSettings;
  onToggle:    () => void;
  onSetSubdir: (s: string) => void;
  onExportNow: () => Promise<void>;
  dataSource:  DataSourceSettings;
}

function formatDate(iso: string): string {
  if (!iso) return 'Never';
  try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
}

export const BackupPanel: React.FC<Props> = ({
  backup, onToggle, onSetSubdir, onExportNow, dataSource,
}) => {
  const [subdirVal, setSubdirVal] = useState(backup.subdirName);
  const [exporting, setExporting] = useState(false);
  const [status,    setStatus]    = useState('');
  const [err,       setErr]       = useState('');
  const [history,   setHistory]   = useState<ExportHistoryItem[] | null>(null);

  useEffect(() => { setSubdirVal(backup.subdirName); }, [backup.subdirName]);

  // Server export history loads in remote mode (and refreshes after each export).
  useEffect(() => {
    if (dataSource.mode !== 'remote') { setHistory([]); return; }
    let alive = true;
    fetchExportHistory(dataSource.serverUrl)
      .then((h) => { if (alive) setHistory(h); })
      .catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, [dataSource.mode, dataSource.serverUrl, backup.lastBackup]);

  const handleExportNow = async () => {
    setExporting(true); setErr(''); setStatus('');
    try {
      await onExportNow();
      setStatus('Exported \u2713');
      if (dataSource.mode === 'remote') {
        fetchExportHistory(dataSource.serverUrl).then(setHistory).catch(() => {});
      }
    }
    catch (e: any) { setErr(e?.message ?? 'Export failed'); }
    finally { setExporting(false); }
  };

  const handleSubdirBlur = () => {
    if (subdirVal !== backup.subdirName) onSetSubdir(subdirVal);
  };

  return (
    <div className="backup-panel">
      <div className="backup-row">
        <div className="backup-row-label">
          <span className="backup-row-title">Auto-backup after sync</span>
          <span className="backup-row-sub">
            Saves a CSV to your Documents folder after every successful sync
          </span>
        </div>
        <button className={'toggle-btn ' + (backup.enabled ? 'on' : '')}
                onClick={onToggle} role="switch" aria-checked={backup.enabled}
                aria-label="Toggle auto-backup">
          <span className="toggle-thumb" />
        </button>
      </div>

      <div className="filter-group" style={{ marginTop: '0.75rem' }}>
        <label className="filter-label" htmlFor="backup-subdir">
          Subdirectory (inside Documents/)
        </label>
        <div className="backup-path-row">
          <span className="backup-path-prefix">Documents/</span>
          <input id="backup-subdir" className="search-input backup-subdir-input"
                 type="text" placeholder="SpotifyBackups"
                 value={subdirVal}
                 onChange={(e) => setSubdirVal(e.target.value)}
                 onBlur={handleSubdirBlur}
                 onKeyDown={(e) => e.key === 'Enter' && handleSubdirBlur()} />
        </div>
        <p className="backup-path-hint">
          Files saved as <code>spotify-library-YYYY-MM-DD.csv</code>
        </p>
      </div>

      <div className="backup-last">
        <span className="backup-last-label">Last backup</span>
        <span className="backup-last-value">{formatDate(backup.lastBackup)}</span>
        {backup.lastPath && backup.lastPath !== '(browser download)' && (
          <span className="backup-last-path">{backup.lastPath}</span>
        )}
      </div>

      <button className={'sync-btn full-width ' + (exporting ? 'syncing' : '')}
              onClick={handleExportNow} disabled={exporting}>
        {exporting
          ? <><span className="spinner" aria-hidden="true" />&nbsp;Exporting&hellip;</>
          : 'Export now'}
      </button>

      {status && <p className="sync-desc" role="status" style={{ marginTop: '0.5rem' }}>{status}</p>}

      {dataSource.mode === 'remote' && (
        <div className="backup-history" style={{ marginTop: '0.75rem' }}>
          <p className="filter-label">Server export history</p>
          {history === null ? (
            <p className="sync-desc">Loading…</p>
          ) : history.length === 0 ? (
            <p className="sync-desc">No exports yet — use Export now above.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {history.map((h) => (
                <li key={h.filename + h.exported_at} className="sync-desc" style={{ marginTop: '0.25rem' }}>
                  {h.filename} · {h.row_count} rows · {formatDate(h.exported_at)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {err && <div className="sync-error" role="alert">&#x26A0; {err}</div>}
    </div>
  );
};
