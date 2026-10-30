import React, { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { Capacitor } from '@capacitor/core';
import { getValidAccessToken } from '../services/SpotifyAuthService';
import { SPOTIFY_API_URL } from '../config/spotify';
import { openAddFromSiteBrowser, isNativeApp } from '../services/addFromSite';
import { unhideDuplicateIds } from '../utils/duplicateBlocklist';
import type { SyncResult } from '../services/SyncService';

export interface AddFromSiteDialogProps {
  open: boolean;
  onClose: () => void;
  onImportCsv: (csvText: string) => Promise<SyncResult>;
  onImported: (result: SyncResult) => void;
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

export const AddFromSiteDialog: React.FC<AddFromSiteDialogProps> = ({ open, onClose, onImportCsv, onImported }) => {
  const [url, setUrl] = useState('https://open.spotify.com');
  const [ids, setIds] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<Record<string, SiteAlbum>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const [resultMessage, setResultMessage] = useState('');
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
      onImported(result);
      setResultMessage(`Imported ${result.imported}, skipped ${result.skipped}, existing ${result.existing}.`);
    } catch (e: any) {
      setError(e?.message ?? 'Import failed.');
    } finally {
      setImporting(false);
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
            {importing ? 'Importing…' : `Import selected (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
};