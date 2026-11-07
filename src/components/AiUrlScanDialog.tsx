import React, { useState } from 'react';
import Papa from 'papaparse';
import { extractAlbumsFromUrl, extractAlbumsFromText, type ExtractedAlbum } from '../services/LLMService';
import { resolveAlbums, type ResolvedAlbum } from '../services/remote/spotifyRemote';import type { SyncResult } from '../services/SyncService';

export interface AiUrlScanDialogProps {
  open: boolean;
  onClose: () => void;
  serverUrl: string;
  onImportCsv: (csvText: string) => Promise<SyncResult>;
  onImported: (result: SyncResult) => void;
  onCreatePlaylist?: (albums: ResolvedAlbum[]) => Promise<{ id: string; name: string; tracksAdded: number }>;
  onPlaylistCreated?: (name: string) => void;
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
    try {
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
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed.');
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
            <ul className="add-from-site-list">
              {albums.map((a) => (
                <li key={a.spotify_id} className="add-from-site-item">
                  <label>
                    <input type="checkbox" checked={selected.has(a.spotify_id)} onChange={() => toggle(a.spotify_id)} />
                    {a.image_url && <img src={a.image_url} alt="" className="album-thumb" />}
                    <span className="album-meta">
                      <strong>{a.title}</strong>
                      <span className="muted">{a.artist_name} {a.year ? `(${a.year})` : ''}</span>
                    </span>
                  </label>
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