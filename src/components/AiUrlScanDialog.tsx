import React, { useState } from 'react';
import Papa from 'papaparse';
import { extractAlbumsFromUrl, extractAlbumsFromText, type ExtractedAlbum } from '../services/LLMService';
import { resolveAlbums, type ResolvedAlbum } from '../services/remote/spotifyRemote';import type { SyncResult } from '../services/SyncService';
import { isNativeApp, openAlbumPageSnapshot } from '../services/addFromSite';
import { LinkHistory } from './LinkHistory';
import { recordRecent } from '../services/linkHistory';

export interface AiUrlScanDialogProps {
  open: boolean;
  onClose: () => void;
  serverUrl: string;
  onImportCsv: (csvText: string) => Promise<SyncResult>;
  onImported: (result: SyncResult) => void;
  onCreatePlaylist?: (albums: ResolvedAlbum[]) => Promise<{ id: string; name: string; tracksAdded: number }>;
  onPlaylistCreated?: (name: string) => void;
}

const SPOTIFY_ALBUM_ID_RE = /open\.spotify\.com\/(?:embed\/)?album\/([A-Za-z0-9]{22})/gi;
function collectAlbumIds(text: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = SPOTIFY_ALBUM_ID_RE.exec(text))) found.add(match[1]);
  SPOTIFY_ALBUM_ID_RE.lastIndex = 0;
  return [...found];
}

async function fetchAlbum(id: string): Promise<ResolvedAlbum> {
  const token = await (await import('../services/SpotifyAuthService')).getValidAccessToken();
  const res = await fetch('https://api.spotify.com/v1/albums/' + encodeURIComponent(id), {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Spotify could not load album ' + id + ' (' + res.status + ').');
  const data: any = await res.json();
  const year = parseInt(String(data?.release_date ?? '').slice(0, 4), 10);
  return {
    spotify_id: id,
    title: data?.name ?? 'Unknown title',
    artist: '',
    album: '',
    artist_name: (Array.isArray(data?.artists) ? data.artists.map((a: any) => a.name).join(', ') : '') || 'Unknown artist',
    year: Number.isFinite(year) ? year : 0,
    image_url: data?.images?.[0]?.url ?? '',
    spotify_url: data?.external_urls?.spotify ?? '',
  };
}

export const AiUrlScanDialog: React.FC<AiUrlScanDialogProps> = ({
  open, onClose, serverUrl, onImportCsv, onImported, onCreatePlaylist, onPlaylistCreated,
}) => {
  const [url, setUrl] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [albums, setAlbums] = useState<ResolvedAlbum[]>([]);
  const [unresolved, setUnresolved] = useState<ExtractedAlbum[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [resultMessage, setResultMessage] = useState('');

  if (!open) return null;

  const reset = () => {
    setUrl(''); setPasteText(''); setAlbums([]); setUnresolved([]); setSelected(new Set());
    setError(''); setResultMessage('');
  };

  const handleScan = async () => {
    setError(''); setResultMessage(''); setScanning(true);
    const historyKind = serverUrl ? 'albums-ai' : 'albums-paste';
    try {
      if (url.trim()) recordRecent(historyKind, url.trim(), 'url');
      else if (pasteText.trim()) recordRecent(historyKind, pasteText.trim(), 'text');
      if (serverUrl) {
        const extracted = url.trim()
          ? await extractAlbumsFromUrl(serverUrl, url.trim())
          : await extractAlbumsFromText(serverUrl, pasteText.trim());
        if (!extracted.length) {
          setError('AI found no albums on this page.');
          setAlbums([]); setUnresolved([]);
          return;
        }
        const { resolved, unresolved } = await resolveAlbums(serverUrl, extracted);
        setAlbums(resolved);
        setUnresolved(unresolved);
        setSelected(new Set(resolved.map((a) => a.spotify_id)));
      } else {
        // Standalone fallback: parse Spotify album links from pasted text/URL.
        const found = collectAlbumIds((pasteText || url).trim());
        if (!found.length) {
          setError('No Spotify album links found in that text.');
          setAlbums([]); setUnresolved([]);
          return;
        }
        const entries = await Promise.all(found.map(async (id) => {
          try { return await fetchAlbum(id); }
          catch { return { spotify_id: id, title: id, artist: '', album: '', artist_name: 'Spotify album', year: 0, image_url: '', spotify_url: '' }; }
        }));
        setAlbums(entries);
        setUnresolved([]);
        setSelected(new Set(entries.map((a) => a.spotify_id)));
      }
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed.');
    } finally {
      setScanning(false);
    }
  };

  // Capture the rendered album listing from the in-app browser, then run the
  // normal AI extraction on that text. A server-side fetch cannot execute the
  // page's JavaScript, so JS-built listings (Spotify, labels, shops) would
  // otherwise come back empty.
  const handleBrowserSnapshot = async () => {
    if (!serverUrl) {
      setError('The in-app browser scan needs the media server connection.');
      return;
    }
    setError(''); setResultMessage(''); setScanning(true); setAlbums([]); setUnresolved([]);
    try {
      const snap = await openAlbumPageSnapshot(url.trim());
      if (!snap) return; // the user closed the browser
      recordRecent('albums-ai', snap.url || url.trim(), 'url');
      const text = snap.text.trim();
      if (!text) {
        setError('The page had no readable text. Wait for it to finish loading, then try again.');
        return;
      }
      const extracted = await extractAlbumsFromText(serverUrl, text);
      if (!extracted.length) {
        setError('AI found no albums on this page.');
        return;
      }
      const { resolved, unresolved } = await resolveAlbums(serverUrl, extracted);
      setAlbums(resolved);
      setUnresolved(unresolved);
      setSelected(new Set(resolved.map((a) => a.spotify_id)));
      setResultMessage(`Captured the page. Found ${extracted.length} album(s), ${resolved.length} on Spotify.`);
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

  const selectedAlbums = albums.filter((a) => selected.has(a.spotify_id));

  const handleSave = async () => {
    if (!selectedAlbums.length) return;
    setImporting(true); setError(''); setResultMessage('');
    try {
      const rows = selectedAlbums.map((a) => ({
        id: a.spotify_id,
        title: a.title,
        artist: a.artist_name,
        year: String(a.year ?? 0),
        genre: '',
        image_url: a.image_url ?? '',
        added_at: new Date().toISOString(),
      }));
      const csv = Papa.unparse(rows, { columns: ['id', 'title', 'artist', 'year', 'genre', 'image_url', 'added_at'] });
      const result = await onImportCsv(csv);
      onImported(result);
      setResultMessage(`Imported ${result.imported}, skipped ${result.skipped}, existing ${result.existing}.`);
    } catch (e: any) {
      setError(e?.message ?? 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const handlePlaylist = async () => {
    if (!selectedAlbums.length || !onCreatePlaylist) return;
    setCreating(true); setError(''); setResultMessage('');
    try {
      const name = `AI scan ${new Date().toLocaleDateString()}`;
      const res = await onCreatePlaylist(selectedAlbums);      onPlaylistCreated?.(res.name || name);
      setResultMessage(`Created playlist "${res.name}" with ${res.tracksAdded} tracks.`);
    } catch (e: any) {
      setError(e?.message ?? 'Playlist creation failed.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-overlay add-from-site-overlay" role="presentation" onClick={onClose}>
      <div className="modal add-from-site-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h2>Scan page with AI</h2>
            <p className="modal-description">
              Paste a URL (or text) without Spotify links. AI extracts albums, then searches Spotify.
            </p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="add-from-site-toolbar">
          <input
            className="form-input"
            placeholder="https://example.com/album-list"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={scanning}
          />
          <textarea
            className="form-input"
            placeholder="…or paste page text here"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            disabled={scanning}
            rows={3}
          />
          <LinkHistory
            kind={serverUrl ? 'albums-ai' : 'albums-paste'}
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
              title="Open the page in the app's browser, then capture the rendered text (works on JS-built album listings)"
            >
              Open in browser and scan
            </button>
          )}
          <button type="button" className="sync-btn" onClick={() => void handleScan()} disabled={scanning || (!url.trim() && !pasteText.trim())}>
            {scanning ? 'Scanning…' : 'Scan with AI'}
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {resultMessage && <div className="success-banner">{resultMessage}</div>}

        {albums.length > 0 && (
          <>
            <div className="add-from-site-actions">
              <button type="button" className="sync-btn sync-btn--ghost" onClick={() => setSelected(new Set(albums.map((a) => a.spotify_id)))}>Select all</button>
              <button type="button" className="sync-btn sync-btn--ghost" onClick={() => setSelected(new Set())}>Clear</button>
              <span className="muted">{selected.size} selected</span>
            </div>
            <ul className="list-card-list">
              {albums.map((a) => (
                <li key={a.spotify_id} className="list-card">
                  <label className="list-card__check">
                    <input type="checkbox" checked={selected.has(a.spotify_id)} onChange={() => toggle(a.spotify_id)} />
                    {a.image_url && <img src={a.image_url} alt="" className="album-thumb" />}
                  </label>
                  <span className="list-card__main">
                    <span className="list-card__title">{a.title}</span>
                    <span className="list-card__meta">
                      {[a.artist_name, a.year ? `(${a.year})` : ''].filter(Boolean).join(' ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="add-from-site-footer">
              <button type="button" className="sync-btn" onClick={() => void handleSave()} disabled={importing || !selectedAlbums.length}>
                {importing ? 'Saving…' : `Save ${selectedAlbums.length} to library`}
              </button>
              {onCreatePlaylist && (
                <button type="button" className="sync-btn sync-btn--ghost" onClick={() => void handlePlaylist()} disabled={creating || !selectedAlbums.length}>
                  {creating ? 'Creating…' : `Create playlist (${selectedAlbums.length})`}
                </button>
              )}
              <button type="button" className="sync-btn sync-btn--ghost" onClick={() => { reset(); onClose(); }}>Close</button>
            </div>
          </>
        )}

        {unresolved.length > 0 && (
          <div className="add-from-site-unresolved">
            <h4>Not found on Spotify</h4>
            <ul>
              {unresolved.map((u, i) => <li key={i}>{u.artist} — {u.album}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};