import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import {
  extractAlbumsFromUrl,
  extractAlbumsFromText,
  type ExtractedAlbum,
  listLLMChats,
  createLLMChat,
  chatWithLLM,
  storedChatTurns,
  deleteLLMChat,
  type LLMChatSummary,
  type LLMChatRow,
  type LLMMessage,
  type LLMChatResult,
} from '../services/LLMService';
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
  const [chatId, setChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<LLMChatSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Load chat history on mount
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHistoryLoading(true);
    listLLMChats(serverUrl, 'extract_albums')
      .then((rows) => {
        if (!cancelled) {
          setChats(rows);
          setHistoryLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, serverUrl]);

  if (!open) return null;

  const reset = () => {
    setUrl(''); setPasteText(''); setAlbums([]); setUnresolved([]); setSelected(new Set());
    setError(''); setResultMessage(''); setChatId(null);
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
      recordRecent(serverUrl ? 'albums-ai' : 'albums-paste', snap.url || url.trim(), 'url');
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

  // Build context for LLM chat (for future refine/resume)
  const buildContext = (albs: ResolvedAlbum[]) => {
    const lines: string[] = [];
    if (albs.length) {
      lines.push('Albums extracted from page:');
      albs.slice(0, 50).forEach((a) => {
        lines.push(`- ${a.title} — ${a.artist_name} (${a.year ? a.year : 'unknown year'})`);
      });
    }
    return lines.join('\n');
  };

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
      // Persist chat BEFORE closing dialog (onImported closes it)
      await persistScanChat(`Saved ${selectedAlbums.length} album(s) to library.`);
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
      const res = await onCreatePlaylist(selectedAlbums);
      onPlaylistCreated?.(res.name || name);
      // Persist chat after playlist creation
      await persistScanChat(`Created playlist with ${selectedAlbums.length} album(s).`);
      setResultMessage(`Created playlist "${res.name}" with ${res.tracksAdded} tracks.`);
    } catch (e: any) {
      setError(e?.message ?? 'Playlist creation failed.');
    } finally {
      setCreating(false);
    }
  };

  // Save the scan results as a chat turn (for history/resume)
  const persistScanChat = async (userPrompt: string) => {
    if (!serverUrl) return;
    const context = buildContext(selectedAlbums);
    const systemPrompt =
      'You are a music library assistant. The user scanned a page for albums. ' +
      'The extracted albums are listed below. You can help them refine the selection, ' +
      'create playlists, or answer questions about the albums.';
    try {
      const result = await chatWithLLM(serverUrl, [
        { role: 'system', content: systemPrompt + '\n\nAlbums:\n' + context },
        { role: 'user', content: userPrompt },
      ], {
        system: systemPrompt + '\n\nAlbums:\n' + context,
        chat_id: chatId,
        use_history: true,
        history_limit: 20,
        persist: true,
        use_tools: false,
        temperature: 0.3,
        max_tokens: 512,
        chat_type: 'extract_albums',
      });
      if (result.chat_id) setChatId(result.chat_id);
    } catch (e: any) {
      console.warn('Could not persist scan chat:', e);
    }
  };

  const handleSaveWithChat = async () => {
    await handleSave();
    await persistScanChat(`Saved ${selectedAlbums.length} album(s) to library.`);
  };

  const handlePlaylistWithChat = async () => {
    await handlePlaylist();
    await persistScanChat(`Created playlist with ${selectedAlbums.length} album(s).`);
  };

  const loadChat = async (chatId: string) => {
    setHistoryLoading(true);
    try {
      // In a full implementation, we'd load the chat and populate albums from it
      // For now, just set the chatId
      setChatId(chatId);
      setShowHistory(false);
    } catch (e) {
      console.error('Failed to load chat:', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const deleteChat = async (chatId: string) => {
    try {
      await deleteLLMChat(serverUrl, chatId);
      setChats((prev) => prev.filter((c) => c.id !== chatId));
    } catch (e: any) {
      console.error('Failed to delete chat:', e);
    }
  };

  const startNewChat = () => {
    setChatId(null);
    reset();
    setShowHistory(false);
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="url-btn"
              onClick={() => { setShowHistory(!showHistory); if (showHistory) setChats([]); }}
              disabled={historyLoading}
            >
              {showHistory ? 'Hide scans' : `Scans (${chats.length})`}
            </button>
            <button className="modal-close" type="button" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {showHistory && (
          <div className="ai-chats" style={{ marginBottom: 12, padding: 8, border: '1px solid #333', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>Recent album scans</strong>
              <button type="button" className="url-btn" onClick={startNewChat} disabled={historyLoading}>
                + New scan
              </button>
            </div>
            {historyLoading && <p style={{ opacity: 0.7 }}>Loading…</p>}
            {chats.length === 0 && !historyLoading && <p style={{ opacity: 0.7 }}>No previous scans yet.</p>}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 160, overflowY: 'auto' }}>
              {chats.map((c) => (
                <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #222' }}>
                  <button
                    type="button"
                    className="url-btn"
                    onClick={() => loadChat(c.id)}
                    disabled={historyLoading}
                    style={{ flex: 1, textAlign: 'left', fontWeight: c.id === chatId ? 700 : 400 }}
                  >
                    {(c.title ?? '').trim() || '(untitled)'}
                  </button>
                  <button
                    type="button"
                    className="url-btn"
                    onClick={() => deleteChat(c.id)}
                    disabled={historyLoading}
                    aria-label="Delete scan"
                    style={{ marginLeft: 8 }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

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
              <button type="button" className="sync-btn" onClick={() => void handleSaveWithChat()} disabled={importing || !selectedAlbums.length}>
                {importing ? 'Saving…' : `Save ${selectedAlbums.length} to library`}
              </button>
              {onCreatePlaylist && (
                <button type="button" className="sync-btn sync-btn--ghost" onClick={() => void handlePlaylistWithChat()} disabled={creating || !selectedAlbums.length}>
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