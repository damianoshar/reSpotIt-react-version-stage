import React, { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { Capacitor } from '@capacitor/core';
import { getValidAccessToken } from '../services/SpotifyAuthService';
import { SPOTIFY_API_URL } from '../config/spotify';
import { openAddFromSiteBrowser, isNativeApp } from '../services/addFromSite';
import { unhideDuplicateIds } from '../utils/duplicateBlocklist';
import type { SyncResult } from '../services/SyncService';
import type { PlaylistAlbumLike } from '../types';
import { LinkHistory } from './LinkHistory';
import { recordRecent } from '../services/linkHistory';

export interface AddFromSiteDialogProps {
  open: boolean;
  onClose: () => void;
  onImportCsv: (csvText: string) => Promise<SyncResult>;
  onImported: (result: SyncResult, message?: string) => void;
  /**
   * Save the selected albums to the user's Spotify library.
   * UI policy: "add to the library" must reach Spotify — writing only to the
   * dashboard's local index is not enough.
   */
  onSaveToSpotify?: (albumIds: string[]) => Promise<number>;
  onCreatePlaylist?: (name: string, albums: PlaylistAlbumLike[]) => Promise<{ id: string; name: string; tracksAdded: number }>;
  onAddToPlaylist?: (playlistId: string, albums: PlaylistAlbumLike[]) => Promise<number>;
  onListPlaylists?: () => Promise<{ id: string; name: string }[]>;
}

interface SiteAlbum {
  id: string;
  title: string;
  artist: string;
  year: number;
  image_url: string;
}

const SPOTIFY_ALBUM_ID_RE = /open\.spotify\.com\/(?:embed\/)?album\/([A-Za-z0-9]{22})/gi;

function collectAlbumIds(text: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = SPOTIFY_ALBUM_ID_RE.exec(text))) found.add(match[1]);
  SPOTIFY_ALBUM_ID_RE.lastIndex = 0;
  return [...found];
}

async function fetchAlbum(id: string): Promise<SiteAlbum> {
  const token = await getValidAccessToken();
  const res = await fetch(SPOTIFY_API_URL + '/albums/' + encodeURIComponent(id), {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Spotify could not load album ' + id + ' (' + res.status + ').');
  const data: any = await res.json();
  const year = parseInt(String(data?.release_date ?? '').slice(0, 4), 10);
  return {
    id,
    title: data?.name ?? 'Unknown title',
    artist: (Array.isArray(data?.artists) ? data.artists.map((a: any) => a.name).join(', ') : '') || 'Unknown artist',
    year: Number.isFinite(year) ? year : 0,
    image_url: data?.images?.[0]?.url ?? '',
  };
}

export const AddFromSiteDialog: React.FC<AddFromSiteDialogProps> = ({
  open, onClose, onImportCsv, onImported, onSaveToSpotify,
  onCreatePlaylist, onAddToPlaylist, onListPlaylists,
}) => {
  const [url, setUrl] = useState('https://open.spotify.com');
  const [ids, setIds] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<Record<string, SiteAlbum>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [playlistTarget, setPlaylistTarget] = useState('');
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const autoOpenedRef = useRef(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  if (!open) return null;

  const mergeIds = (nextIds: string[]) => {
    const unique = [...new Set(nextIds.map((x) => x.trim()).filter(Boolean))];
    setIds((previous) => {
      const merged = [...new Set([...previous, ...unique])];
      setSelected(() => new Set(merged)); // select newly detected, preserve unselected? Reset all selected fresh.
      return merged;
    });
  };

  const openNativeBrowser = async () => {
    setError('');
    setScanning(true);
    try {
      if (url.trim()) recordRecent('site', url.trim(), 'url');
      const response = await openAddFromSiteBrowser(url);
      if (response) {
        setUrl(response.url || url);
        mergeIds(response.ids ?? []);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not open the in-app browser.');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (!open) {
      autoOpenedRef.current = false;
      return;
    }
    if (isNativeApp() && !autoOpenedRef.current && ids.length === 0) {
      autoOpenedRef.current = true;
      void openNativeBrowser();
    }
  }, [open]);

  useEffect(() => {
    const missing = ids.filter((id) => !metadata[id]);
    if (!missing.length) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(missing.map(async (id) => {
        try { return [id, await fetchAlbum(id)] as const; }
        catch { return [id, { id, title: id, artist: 'Spotify album', year: 0, image_url: '' }] as const; }
      }));
      if (cancelled) return;
      setMetadata((previous) => {
        const next = { ...previous };
        for (const [id, album] of entries) next[id] = album;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [ids]);

  const addFromText = () => {
    const found = collectAlbumIds(pasteText || url);
    if (!found.length) {
      setError('No Spotify album links found in that text.');
      return;
    }
    if (pasteText.trim()) recordRecent('site', pasteText.trim(), 'text');
    else if (url.trim()) recordRecent('site', url.trim(), 'url');
    mergeIds(found);
    setError('');
  };

  const importSelected = async () => {
    const selectedIds = [...selected];
    if (!selectedIds.length) return;
    setImporting(true);
    setError('');
    setResultMessage('');
    try {
      await unhideDuplicateIds(selectedIds);
      // 1. Spotify first — the albums have to reach the user's Spotify
      //    library, not only the dashboard's own index.
      let saved = 0;
      if (onSaveToSpotify) {
        saved = await onSaveToSpotify(selectedIds);
      }
      // 2. Then the dashboard index.
      const rows = selectedIds.map((id) => {
        const meta = metadata[id];
        return {
          id,
          title: meta?.title ?? id,
          artist: meta?.artist ?? 'Unknown artist',
          year: String(meta?.year ?? 0),
          genre: '',
          image_url: meta?.image_url ?? '',
          added_at: new Date().toISOString(),
        };
      });
      const csv = Papa.unparse(rows, {
        columns: ['id', 'title', 'artist', 'year', 'genre', 'image_url', 'added_at'],
      });
      const result = await onImportCsv(csv);
      const message = saved
        ? `Saved ${saved} album(s) to your Spotify library. Imported ${result.imported}, skipped ${result.skipped}, existing ${result.existing}.`
        : `Imported ${result.imported}, skipped ${result.skipped}, existing ${result.existing}.`;
      onImported(result, message);
      setResultMessage(message);
    } catch (e: any) {
      setError(e?.message ?? 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

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
   * Add the detected albums to a playlist: a new playlist with the name the
   * user typed, or one of the playlists they already have.
   */
  const addSelectedToPlaylist = async () => {
    const selectedIds = [...selected];
    if (!selectedIds.length) return;
    const existing = playlistTarget;
    const newName = playlistName.trim();
    if (!existing && !newName) {
      setError('Name the new playlist, or pick one of your playlists.');
      return;
    }
    if (!onCreatePlaylist && !onAddToPlaylist) return;
    setCreating(true);
    setError('');
    setResultMessage('');
    try {
      const albums: SiteAlbum[] = selectedIds.map((id) => metadata[id] ?? {
        id, title: id, artist: 'Unknown artist', year: 0, image_url: '',
      });
      if (existing) {
        if (!onAddToPlaylist) throw new Error('Adding to a playlist is not available here.');
        const tracksAdded = await onAddToPlaylist(existing, albums);
        const name = playlists.find((p) => p.id === existing)?.name ?? 'playlist';
        setResultMessage(`Added ${albums.length} album(s) to “${name}” (${tracksAdded} tracks).`);
      } else {
        if (!onCreatePlaylist) throw new Error('Creating a playlist is not available here.');
        const res = await onCreatePlaylist(newName, albums);
        setResultMessage(`Created playlist “${res.name || newName}” with ${res.tracksAdded} tracks.`);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not add the albums to a playlist.');
    } finally {
      setCreating(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(ids));

  return (
    <div className="modal-overlay add-from-site-overlay" role="presentation" onClick={onClose}>
      <div className="modal add-from-site-panel" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h2>Add from site</h2>
            <p className="modal-description">
              Use the in-app browser on this device to open a page and import its Spotify album links.
            </p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="add-from-site-toolbar">
          {isNativeApp() ? (
            <>
              <button type="button" className="sync-btn sync-btn--ghost full-width" onClick={openNativeBrowser} disabled={scanning}>
                {scanning ? 'Opening browser…' : (ids.length ? 'Open browser again' : 'Open in-app browser')}
              </button>
              <input
                className="form-input"
                placeholder="Starting URL"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={scanning}
              />
              <LinkHistory
                kind="site"
                value={url}
                target="url"
                accept={['url']}
                onPick={(picked) => setUrl(picked)}
                disabled={scanning}
              />
            </>
          ) : (
            <>
              <input
                className="form-input"
                placeholder="Paste URL or text containing Spotify album links"
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
              />
              <button type="button" className="sync-btn sync-btn--ghost full-width" onClick={addFromText}>
                Detect links in pasted text
              </button>
              <LinkHistory
                kind="site"
                value={url.trim() || pasteText}
                target={url.trim() ? 'url' : 'text'}
                onPick={(picked, pickedTarget) => {
                  if (pickedTarget === 'url') { setUrl(picked); setPasteText(''); }
                  else { setPasteText(picked); setUrl(''); }
                }}
              />
              <iframe
                ref={frameRef}
                title="Web preview"
                className="add-from-site-frame"
                src={url || 'about:blank'}
                style={{ width: '100%', minHeight: 220, border: 0 }}
                onLoad={() => {
                  try { setUrl(frameRef.current?.contentWindow?.location.href ?? url); } catch { /* ignore */ }
                }}
              />
            </>
          )}
        </div>

        {error && <div className="sync-error" role="alert">{error}</div>}
        {resultMessage && <div className="import-result">{resultMessage}</div>}

        <div className="add-from-site-results">
          <div className="add-from-site-list-head">
            <h3>Detected albums ({ids.length})</h3>
            {ids.length > 0 && (
              <button type="button" className="url-btn" onClick={selectAll}>Select all</button>
            )}
          </div>
          {ids.length === 0 ? (
            <p className="queue-help">
              {isNativeApp()
                ? 'Open the in-app browser, scroll the page, then scan to detect Spotify album links.'
                : 'Detect links in pasted text or a website to import them.'}
            </p>
          ) : (
            <div className="add-from-site-list">
              {ids.map((id) => {
                const meta = metadata[id];
                const checked = selected.has(id);
                return (
                  <label key={id} className="add-from-site-row">
                    <input type="checkbox" checked={checked} onChange={() => toggle(id)} />
                    <div>
                      <div className="add-from-site-title">{meta?.title ?? 'Loading…'}</div>
                      <div className="add-from-site-meta">{meta?.artist ?? id}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {(onCreatePlaylist || onAddToPlaylist) && (
          <div className="add-from-site-playlist">
            <span className="add-from-site-playlist-label">Playlist</span>
            <div className="add-from-site-playlist-row">
              <input
                className="form-input"
                placeholder="New playlist name"
                value={playlistName}
                onChange={(event) => setPlaylistName(event.target.value)}
                disabled={creating || !!playlistTarget}
                aria-label="Name of the new playlist"
              />
              <select
                className="search-input"
                value={playlistTarget}
                onChange={(event) => setPlaylistTarget(event.target.value)}
                disabled={creating || playlistsLoading}
                aria-label="Existing playlist"
                onFocus={() => { if (!playlists.length && onListPlaylists) void loadPlaylists(); }}
              >
                <option value="">Create a new playlist</option>
                {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <p className="queue-help">
              Type a name to create a playlist, or pick one of your playlists.
              The {selected.size} selected album(s) are added with all their tracks.
            </p>
          </div>
        )}

        <div className="add-from-site-actions">
          <button type="button" className="sync-btn sync-btn--ghost full-width" onClick={onClose} disabled={importing}>
            Cancel
          </button>
          <button
            type="button"
            className="login-btn"
            disabled={importing || selected.size === 0}
            onClick={() => void importSelected()}
          >
            {importing ? 'Saving…' : `Save ${selected.size} to Spotify & library`}
          </button>
          {(onCreatePlaylist || onAddToPlaylist) && (
            <button
              type="button"
              className="sync-btn"
              disabled={creating || selected.size === 0}
              onClick={() => void addSelectedToPlaylist()}
            >
              {creating ? 'Adding…' : `Add to playlist (${selected.size})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};