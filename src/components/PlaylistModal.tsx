import { Artwork } from './Artwork';
import React, { useState, useEffect, useRef } from 'react';
import {
  SpotifyPlaylist,
  getUserPlaylists,
  addAlbumsToPlaylist,
  createPlaylist,
} from '../services/SpotifyPlaylistService';
import { Album } from '../types';
import {
  listRemotePlaylists, addRemoteAlbumsToPlaylist, createAndAddRemotePlaylist,
} from '../services/remote/playlistRemote';

type Stage = 'browse' | 'working' | 'done';

interface Props {
  selectedAlbums: Album[];
  onClose: ()          => void;
  onDone:  (msg: string) => void;
  /** Set in media-server mode — list/create/add run against the server. */
  remote?: { serverUrl: string } | null;
}

export const PlaylistModal: React.FC<Props> = ({ selectedAlbums, onClose, onDone, remote }) => {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [stage,     setStage]     = useState<Stage>('browse');
  const [showNew,   setShowNew]   = useState(false);
  const [search,    setSearch]    = useState('');
  const [newName,   setNewName]   = useState('');
  const [status,    setStatus]    = useState('');
  const [error,     setError]     = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (remote) {
      listRemotePlaylists(remote.serverUrl)
        .then(({ playlists: list }) => setPlaylists(list))
        .catch((e) => setError(e?.message ?? 'Failed to load playlists'));
    } else {
      getUserPlaylists()
        .then(setPlaylists)
        .catch((e) => setError(e?.message ?? 'Failed to load playlists'));
    }
  }, [remote?.serverUrl]);

  useEffect(() => {
    if (showNew) setTimeout(() => nameRef.current?.focus(), 50);
  }, [showNew]);

  const albumIds = selectedAlbums.map((a) => a.id);

  const doAdd = async (playlistId: string, playlistName: string) => {
    setStage('working');
    setError('');
    try {
      const { tracksAdded } = remote
        ? await addRemoteAlbumsToPlaylist(remote.serverUrl, albumIds, playlistId)
        : await addAlbumsToPlaylist(selectedAlbums, playlistId);
      setStatus(`✓ Added ${tracksAdded} tracks to "${playlistName}"`);
      setStage('done');
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
      setStage('browse');
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setStage('working');
    try {
      if (remote) {
        const pl = await createAndAddRemotePlaylist(remote.serverUrl, newName.trim(), albumIds);
        setStatus(`✓ Added ${pl.tracksAdded} tracks to "${pl.name}"`);
        setStage('done');
      } else {
        const pl = await createPlaylist(newName.trim());
        await doAdd(pl.id, pl.name);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create playlist');
      setStage('browse');
    }
  };

  const filtered = playlists.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const albumCount = selectedAlbums.length;
  const title =
    stage === 'working' ? 'Working…'
    : stage === 'done'  ? 'Done'
    : `Add ${albumCount} album${albumCount !== 1 ? 's' : ''} to playlist`;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal playlist-modal">
        <div className="modal-header">
          <h2>{title}</h2>
          {stage !== 'working' && (
            <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
          )}
        </div>

        <div className="modal-body">
          {stage === 'working' && (
            <div className="pl-loading"><span className="spinner" aria-hidden="true" /> Adding tracks…</div>
          )}

          {stage === 'done' && (
            <>
              <p className="pl-done-msg">{status}</p>
              <button className="sync-btn full-width" onClick={() => { onDone(status); onClose(); }}>
                Close
              </button>
            </>
          )}

          {stage === 'browse' && (
            <>
              {error && <div className="sync-error" role="alert">⚠ {error}</div>}

              {/* New playlist inline form */}
              {showNew ? (
                <div className="pl-new-form">
                  <input
                    ref={nameRef}
                    className="search-input" style={{ paddingLeft: '0.75rem' }}
                    type="text" placeholder="Playlist name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  />
                  <div className="pl-new-actions">
                    <button className="sync-btn" onClick={() => setShowNew(false)}>Cancel</button>
                    <button
                      className="sync-btn sel-btn--playlist"
                      onClick={handleCreate}
                      disabled={!newName.trim()}
                    >Create & Add</button>
                  </div>
                </div>
              ) : (
                <button className="pl-new-btn" onClick={() => setShowNew(true)}>
                  <svg viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
                    <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M10 6v8M6 10h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  New playlist
                </button>
              )}

              {playlists.length > 5 && (
                <div className="search-wrap" style={{ margin: '0.5rem 0' }}>
                  <svg className="search-icon" viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
                    <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8"/>
                    <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  <input className="search-input" type="search" placeholder="Search playlists…"
                         value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              )}

              <div className="pl-list">
                {playlists.length === 0 && !error && (
                  <div className="pl-loading"><span className="spinner" aria-hidden="true" /> Loading…</div>
                )}
                {filtered.length === 0 && playlists.length > 0 && (
                  <p className="pl-empty">No playlists match.</p>
                )}
                {filtered.map((pl) => (
                  <button key={pl.id} className="pl-item" onClick={() => doAdd(pl.id, pl.name)}>
                    {pl.images?.[0]?.url
                      ? <Artwork src={pl.images[0].url} alt="" width="40" height="40" className="pl-thumb" loading="lazy" />
                      : <div className="pl-thumb pl-thumb--empty" aria-hidden="true">♪</div>}
                    <div className="pl-info">
                      <span className="pl-name">{pl.name}</span>
                      <span className="pl-tracks">{pl.tracks.total} tracks</span>
                    </div>
                    <svg viewBox="0 0 20 20" fill="none" width="16" height="16" className="pl-arrow" aria-hidden="true">
                      <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
