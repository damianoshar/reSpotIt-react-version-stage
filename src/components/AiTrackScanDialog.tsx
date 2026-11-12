import React, { useState } from 'react';
import {
  extractTracksFromUrl,
  extractTracksFromText,
} from '../services/LLMService';
import {
  resolveTracks,
  type ResolvedTrack,
  type UnresolvedTrack,
} from '../services/remote/spotifyRemote';
import { isNativeApp, openTrackPageSnapshot } from '../services/addFromSite';
import { LinkHistory } from './LinkHistory';
import { recordRecent } from '../services/linkHistory';

export interface AiTrackScanDialogProps {
  open: boolean;
  onClose: () => void;
  serverUrl: string;
  /**
   * Create a playlist with the name the user typed and fill it with the
   * selected tracks.
   */
  onCreatePlaylist?: (name: string, tracks: ResolvedTrack[]) => Promise<{ id: string; name: string; tracksAdded: number }>;
  /** Append the selected tracks to a playlist the user already has. */
  onAddToPlaylist?: (playlistId: string, tracks: ResolvedTrack[]) => Promise<number>;
  onListPlaylists?: () => Promise<{ id: string; name: string }[]>;
  onPlaylistCreated?: (name: string) => void;
}

/** "3:44" — the track length, or an empty string when Spotify gave none. */
function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const AiTrackScanDialog: React.FC<AiTrackScanDialogProps> = ({
  open, onClose, serverUrl,
  onCreatePlaylist, onAddToPlaylist, onListPlaylists, onPlaylistCreated,
}) => {
  const [url, setUrl] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [tracks, setTracks] = useState<ResolvedTrack[]>([]);
  const [unresolved, setUnresolved] = useState<UnresolvedTrack[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  // Playlist target: a new playlist the user names, or one they already have.
  const [playlistName, setPlaylistName] = useState('');
  const [playlistTarget, setPlaylistTarget] = useState('');
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);

  if (!open) return null;

  const reset = () => {
    setUrl(''); setPasteText(''); setTracks([]); setUnresolved([]);
    setSelected(new Set()); setError(''); setResultMessage('');
    setPlaylistName(''); setPlaylistTarget(''); setPlaylists([]);
  };

  /**
   * Resolve the tracks only. Nothing is written to Spotify here — the write
   * happens only when the user presses "Add to playlist" (UI policy P9).
   *
   * `source` decides what the AI reads: the URL the user typed, or the text
   * the user pasted / the page snapshot captured.
   */
  const runScan = async (source: { url?: string; text?: string }) => {
    const extracted = source.url
      ? await extractTracksFromUrl(serverUrl, source.url)
      : await extractTracksFromText(serverUrl, source.text ?? '');
    if (!extracted.length) {
      setError('AI found no tracks on this page.');
      setTracks([]); setUnresolved([]);
      return;
    }
    const { resolved, unresolved: missing } = await resolveTracks(serverUrl, extracted);
    setTracks(resolved);
    setUnresolved(missing);
    setSelected(new Set(resolved.map((t) => t.spotify_id)));
    setResultMessage(
      `Found ${extracted.length} track(s) on the page, ${resolved.length} on Spotify — nothing was saved yet.`,
    );
  };

  const handleScan = async () => {
    if (!serverUrl) {
      setError('The AI track scan needs the media server connection.');
      return;
    }
    setError(''); setResultMessage(''); setScanning(true);
    try {
      recordRecent('tracks-ai', url.trim() || pasteText.trim(), url.trim() ? 'url' : 'text');
      await runScan(url.trim() ? { url: url.trim() } : { text: pasteText.trim() });
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed.');
    } finally {
      setScanning(false);
    }
  };

  /**
   * Capture the rendered page in the in-app browser and run the extraction on
   * that text. A server-side fetch cannot run the page's JavaScript, so
   * JS-built tracklists would otherwise come back empty.
   */
  const handleBrowserSnapshot = async () => {
    if (!serverUrl) {
      setError('The AI track scan needs the media server connection.');
      return;
    }
    setError(''); setResultMessage(''); setScanning(true);
    setTracks([]); setUnresolved([]);
    try {
      const snap = await openTrackPageSnapshot(url.trim());
      if (!snap) return; // the user closed the browser
      recordRecent('tracks-ai', snap.url || url.trim(), 'url');
      const text = snap.text.trim();
      if (!text) {
        setError('The page had no readable text. Wait for it to finish loading, then try again.');
        return;
      }
      await runScan({ text });
      setUrl('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not snapshot the page.');
    } finally {
      setScanning(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedTracks = tracks.filter((t) => selected.has(t.spotify_id));

  /** Load the user's playlists so the found tracks can be added to one. */
  const loadPlaylists = async () => {
    if (!onListPlaylists) return;
    setPlaylistsLoading(true);
    try {
      setPlaylists(await onListPlaylists());
    } catch (e: any) {
      setError(e?.message ?? 'Could not load playlists.');
    } finally {
      setPlaylistsLoading(false);
    }
  };

  /**
   * The one and only write: the selected tracks go into the playlist the user
   * named or picked. The target is always explicit (UI policy P3).
   */
  const handleAddToPlaylist = async () => {
    if (!selectedTracks.length) return;
    const existing = playlistTarget;
    const newName = playlistName.trim();
    if (!existing && !newName) {
      setError('Name the new playlist, or pick one of your playlists.');
      return;
    }
    if (!onCreatePlaylist && !onAddToPlaylist) return;
    setAdding(true); setError(''); setResultMessage('');
    try {
      if (existing) {
        if (!onAddToPlaylist) throw new Error('Adding to a playlist is not available here.');
        const tracksAdded = await onAddToPlaylist(existing, selectedTracks);
        const name = playlists.find((p) => p.id === existing)?.name ?? 'playlist';
        onPlaylistCreated?.(name);
        setResultMessage(`Added ${selectedTracks.length} track(s) to “${name}” (${tracksAdded} added).`);
      } else {
        if (!onCreatePlaylist) throw new Error('Creating a playlist is not available here.');
        const res = await onCreatePlaylist(newName, selectedTracks);
        onPlaylistCreated?.(res.name || newName);
        setResultMessage(`Created playlist “${res.name || newName}” with ${res.tracksAdded} track(s).`);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Adding to the playlist failed.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="modal-overlay add-from-site-overlay" role="presentation" onClick={onClose}>
      <div className="modal add-from-site-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h2>Scan page with AI (tracks)</h2>
            <p className="modal-description">
              Paste a URL (or text). AI extracts the song titles, then Spotify finds them.
              Nothing is saved until you press “Add to playlist”.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <div className="add-from-site-toolbar">
          <input
            className="form-input"
            placeholder="https://example.com/tracklist"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={scanning}
          />
          <textarea
            className="form-input"
            placeholder="…or paste the tracklist here"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            disabled={scanning}
            rows={3}
          />
          <LinkHistory
            kind="tracks-ai"
            value={url.trim() || pasteText}
            target={url.trim() ? 'url' : 'text'}
            onPick={(picked, pickedTarget) => {
              if (pickedTarget === 'url') { setUrl(picked); setPasteText(''); }
              else { setPasteText(picked); setUrl(''); }
            }}
            disabled={scanning}
          />
          {isNativeApp() && (
            <button
              type="button"
              className="sync-btn"
              onClick={() => void handleBrowserSnapshot()}
              disabled={scanning || !url.trim()}
              title="Open the page in the app's browser, then capture the rendered text (works on JS-built tracklists)"
            >
              Open in browser and scan
            </button>
          )}
          <button
            type="button"
            className="sync-btn"
            onClick={() => void handleScan()}
            disabled={scanning || (!url.trim() && !pasteText.trim())}
          >
            {scanning ? 'Scanning…' : 'Scan with AI'}
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {resultMessage && <div className="success-banner">{resultMessage}</div>}

        {tracks.length > 0 && (
          <>
            <div className="add-from-site-actions">
              <button
                type="button"
                className="sync-btn sync-btn--ghost"
                onClick={() => setSelected(new Set(tracks.map((t) => t.spotify_id)))}
              >
                Select all
              </button>
              <button type="button" className="sync-btn sync-btn--ghost" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <span className="muted">{selected.size} selected</span>
            </div>
            <ul className="list-card-list">
              {tracks.map((t) => (
                <li key={t.spotify_id} className="list-card">
                  <label className="list-card__check">
                    <input type="checkbox" checked={selected.has(t.spotify_id)} onChange={() => toggle(t.spotify_id)} />
                    {t.image_url && <img src={t.image_url} alt="" className="track-thumb" />}
                  </label>
                  <span className="list-card__main">
                    <span className="list-card__title">{t.name}</span>
                    <span className="list-card__meta">
                      {[t.artist_name, t.album_name, formatDuration(t.duration_ms)]
                        .filter(Boolean).join(' — ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {(onCreatePlaylist || onAddToPlaylist) && (
              <div className="add-from-site-playlist">
                <span className="add-from-site-playlist-label">Playlist</span>
                <div className="add-from-site-playlist-row">
                  <input
                    className="form-input"
                    placeholder="New playlist name"
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    disabled={adding || !!playlistTarget}
                    aria-label="Name of the new playlist"
                  />
                  <select
                    className="search-input"
                    value={playlistTarget}
                    onChange={(e) => setPlaylistTarget(e.target.value)}
                    disabled={adding || playlistsLoading}
                    aria-label="Existing playlist"
                    onFocus={() => { if (!playlists.length && onListPlaylists) void loadPlaylists(); }}
                  >
                    <option value="">Create a new playlist</option>
                    {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <p className="queue-help">
                  Type a name to create a playlist, or pick one of your playlists.
                  The {selectedTracks.length} selected track(s) are added to it.
                </p>
              </div>
            )}
            <div className="add-from-site-footer">
              {(onCreatePlaylist || onAddToPlaylist) && (
                <button
                  type="button"
                  className="sync-btn"
                  onClick={() => void handleAddToPlaylist()}
                  disabled={adding || !selectedTracks.length}
                >
                  {adding ? 'Adding…' : `Add to playlist (${selectedTracks.length})`}
                </button>
              )}
              <button type="button" className="sync-btn sync-btn--ghost" onClick={() => { reset(); onClose(); }}>
                Close
              </button>
            </div>
          </>
        )}

        {unresolved.length > 0 && (
          <div className="add-from-site-unresolved">
            <h4>Not found on Spotify</h4>
            <ul>
              {unresolved.map((u, i) => <li key={i}>{u.artist} — {u.title}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
