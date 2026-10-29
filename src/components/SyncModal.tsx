import React, { useState, useRef, useEffect } from 'react';
import { SyncResult } from '../services/SyncService';
import { DataSourceSettings } from '../config/server';
import { Capacitor } from '@capacitor/core';
import { describeRemoteError } from '../services/errorCodes';
import { Filesystem, Encoding } from '@capacitor/filesystem';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { fetchRemoteSyncHistory } from '../services/remote/libraryRemote';
import { recentSyncs, HistoryJob } from '../utils/syncHistory';
import { SyncHistory } from './SyncHistory';

type Tab    = 'spotify' | 'csv';
type Prompt = 'none' | 'confirm-clean';

interface Props {
  onSyncCSV:     (csv: string)    => Promise<SyncResult>;
  onSyncSpotify: (clean: boolean) => Promise<SyncResult>;
  onClose:       ()               => void;
  syncing:       boolean;
  /** Only used for the sync-history note and the remote/local explainer. */
  dataSource:    DataSourceSettings;
}

function formatResult(r: SyncResult): string {
  const parts: string[] = [];
  if (r.imported > 0) parts.push(r.imported + ' added');
  if (r.existing > 0) parts.push(r.existing + ' already up to date');
  if (r.skipped  > 0) parts.push(r.skipped  + ' failed');
  return parts.join(' · ') || 'Nothing changed';
}

export const SyncModal: React.FC<Props> = ({
  onSyncCSV, onSyncSpotify, onClose, syncing, dataSource,
}) => {
  const [tab,      setTab]      = useState<Tab>('spotify');
  const [prompt,   setPrompt]   = useState<Prompt>('none');
  const [result,   setResult]   = useState<SyncResult | null>(null);
  const [localErr, setLocalErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setResult(null); setLocalErr(''); setPrompt('none'); };

  // Server-side sync history (null = loading, [] = none yet). Loaded with the
  // Spotify tab, where the buttons are, and refreshed after a run so the run
  // that just finished shows up. Local mode syncs on-device — no server runs
  // to list — and the fetch needs the server URL, so both drive the trigger.
  const [syncHistory, setSyncHistory] = useState<HistoryJob[] | null>(null);

  const loadSyncHistory = async () => {
    if (dataSource.mode !== 'remote') { setSyncHistory([]); return; }
    try { setSyncHistory(recentSyncs(await fetchRemoteSyncHistory(dataSource.serverUrl, 5), 3)); }
    catch { setSyncHistory([]); }   // history is a nicety; never block the modal on it
  };

  useEffect(() => {
    if (tab === 'spotify') void loadSyncHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dataSource.mode, dataSource.serverUrl]);

  const runSpotifySync = async (clean: boolean) => {
    setPrompt('none'); setResult(null); setLocalErr('');
    try { setResult(await onSyncSpotify(clean)); }
    catch (e: any) { setLocalErr(describeRemoteError(e, 'Spotify sync failed')); }
    finally {
      // The server records every run that started, finished or failed, so
      // refresh even on failure — a dead run belongs in the history too.
      await loadSyncHistory();
    }
  };

  const handlePickCSV = async () => {
    // ── Capacitor native (Android): system file picker ─────────────────────
    if (Capacitor.getPlatform() !== 'web') {
      setResult(null); setLocalErr('');
      try {
        const { files } = await FilePicker.pickFiles({
          types: ['text/csv', 'text/*'],
          limit: 1,
          readData: true,
        });
        const picked = files?.[0];
        if (!picked) return; // user cancelled
        let text = '';
        if (picked.data) {
          const bin = atob(picked.data);
          const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
          text = new TextDecoder().decode(bytes);
        } else if (picked.path) {
          const { data } = await Filesystem.readFile({ path: picked.path, encoding: Encoding.UTF8 });
          text = typeof data === 'string' ? data : '';
        }
        if (!text) { setLocalErr('Could not read the selected file.'); return; }
        try { setResult(await onSyncCSV(text)); }
        catch (e: any) { setLocalErr(e?.message ?? 'CSV sync failed'); }
      } catch (e: any) {
        // The plugin rejects on cancel on some platforms — stay silent then.
        const msg = e?.message ?? '';
        if (!/cancel|dismiss|no file/i.test(msg)) setLocalErr(msg || 'CSV pick failed');
      }
      return;
    }
    fileRef.current?.click();
  };

  const handleWebFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setResult(null); setLocalErr('');
    try { setResult(await onSyncCSV(text)); }
    catch (e: any) { setLocalErr(e?.message ?? 'CSV sync failed'); }
    e.target.value = '';
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Sync library"
      onClick={handleBackdropClick}
    >
      <div className="modal sync-modal">

        {/* Header — close button always visible */}
        <div className="modal-header">
          <div className="modal-header-titles">
            <h2>Sync library</h2>
            {syncing && (
              <span className="modal-sync-hint">Sync running &mdash; safe to close</span>
            )}
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close — sync continues in background"
            title="Close — sync continues in background"
          >
            &#x2715;
          </button>
        </div>

        {/* Tabs */}
        <div className="modal-tabs" role="tablist">
          {(['spotify', 'csv'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t}
                    className={'modal-tab ' + (tab === t ? 'active' : '')}
                    onClick={() => { setTab(t); reset(); }}>
              {t === 'spotify' ? (
                <>
                  <svg viewBox="0 0 20 20" fill="none" width="14" height="14" aria-hidden="true">
                    <circle cx="10" cy="10" r="9" fill="#1DB954"/>
                    <path d="M6 13c3-2 7-2 10 0" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/>
                    <path d="M5 10c4-3 9-3 12 0" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/>
                    <path d="M7 7c2-1 6-1 8 0"   stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  {' Spotify'}
                </>
              ) : 'CSV'}
            </button>
          ))}
        </div>

        <div className="modal-body">

          {/* ── Spotify tab ─────────────────────────────────────────── */}
          {tab === 'spotify' && (
            <>
              <p className="sync-desc">
                {dataSource.mode === 'remote'
                  ? <>Sync runs on <strong>your server</strong> ({dataSource.serverUrl}). Progress streams back here.</>
                  : <>Fetch your saved albums from Spotify.{' '}<strong>Incremental sync</strong> skips albums already in your library.</>}
              </p>

              <button className={'sync-btn full-width ' + (syncing ? 'syncing' : '')}
                      onClick={() => runSpotifySync(false)} disabled={syncing}>
                {syncing
                  ? <><span className="spinner" aria-hidden="true" />&nbsp;Syncing&hellip;</>
                  : <><svg viewBox="0 0 24 24" fill="none" width="14" height="14" style={{verticalAlign:'middle',marginRight:'0.3em'}} aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M21 3v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>Sync new albums</>}
              </button>

              {prompt !== 'confirm-clean' ? (
                <button className="sync-btn sync-btn--ghost full-width"
                        onClick={() => setPrompt('confirm-clean')} disabled={syncing}>
                  Clean sync (reset)
                </button>
              ) : (
                <div className="clean-confirm">
                  <p className="clean-warn">
                    &#x26A0; This will <strong>delete all local data</strong> and re-download
                    your entire library from scratch.
                  </p>
                  <div className="clean-confirm-btns">
                    <button className="sync-btn" onClick={() => setPrompt('none')}>Cancel</button>
                    <button className="sync-btn sync-btn--danger" onClick={() => runSpotifySync(true)}>
                      Yes, clean sync
                    </button>
                  </div>
                </div>
              )}

              {/* Server-side history: what ran before this device was even
                  open. Local mode syncs on-device, so there is nothing to
                  list — the explainer above already covers it. */}
              {dataSource.mode === 'remote' && (
                <div style={{ marginTop: '0.75rem' }}>
                  <p className="sync-desc">Recent syncs</p>
                  <SyncHistory items={syncHistory} />
                </div>
              )}
            </>
          )}

          {/* ── CSV tab ─────────────────────────────────────────────── */}
          {tab === 'csv' && (
            <>
              <p className="sync-desc">Import a <strong>.csv</strong> file exported from your sync script.</p>
              <button className={'sync-btn full-width ' + (syncing ? 'syncing' : '')}
                      onClick={handlePickCSV} disabled={syncing}>
                {syncing ? <><span className="spinner" aria-hidden="true" /> Importing&hellip;</> : '\uD83D\uDCC2 Choose CSV file'}
              </button>
              <input ref={fileRef} type="file" accept=".csv" className="sr-only" onChange={handleWebFileChange} />
            </>
          )}

          {/* Shared result / error */}
          {result && !syncing && (
            <div className="sync-result" role="status">
              <span className="sync-result-ok">&#x2713;</span>
              {formatResult(result)}
              {result.errors.length > 0 && (
                <details className="sync-errors">
                  <summary>{result.errors.length} error{result.errors.length !== 1 ? 's' : ''}</summary>
                  <ul>{result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul>
                </details>
              )}
            </div>
          )}
          {localErr && (
            <div className="sync-error" role="alert">&#x26A0; {localErr}</div>
          )}
        </div>
      </div>
    </div>
  );
};
