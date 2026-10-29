import React from 'react';
import { LibraryStats } from '../types';

interface Props {
  stats:       LibraryStats | null;
  onSyncClick: () => void;
  onLogout:    () => void;
  syncing:     boolean;
  activeTab?:  string;
}

export const Header: React.FC<Props> = ({ stats, onSyncClick, onLogout, syncing }) => (
  <header className="app-header">
    <div className="header-left">
      <img className="logo-icon" src="/icon-192x192.png" alt="reSpotIt" />
      <div>
        <h1 className="app-title">reSpotIt</h1>
        {stats && (
          <p className="app-subtitle">{stats.totalAlbums} albums · {stats.totalArtists} artists</p>
        )}
      </div>
    </div>

    <div className="header-actions">
      <button
        className={`sync-btn ${syncing ? 'syncing' : ''}`}
        onClick={onSyncClick}
        disabled={syncing}
        aria-label="Sync library"
      >
        {syncing ? <><span className="spinner" aria-hidden="true" /> Syncing…</> : <><svg viewBox="0 0 24 24" fill="none" width="16" height="16" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M21 3v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> Sync</>}
      </button>
      <button className="logout-btn" onClick={onLogout} aria-label="Log out">
        ⏏
      </button>
    </div>
  </header>
);
