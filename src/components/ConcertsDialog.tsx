import React, { useCallback, useEffect, useState } from 'react';
import {
  listLLMChats,
  deleteLLMChat,
  type LLMChatSummary,
} from '../services/LLMService';
import { resolveArtists } from '../services/remote/spotifyRemote';
import {
  startRemoteConcertScan,
  getLatestRemoteConcertScan,
  deleteRemoteConcertScan,
  type RemoteConcertScan,
  type RemoteConcertScanItem,
} from '../services/remote/concertScansRemote';
import { type Concert } from '../services/DatabaseService';
import { saveConcerts } from '../services/storage';

export interface ConcertsDialogProps {
  open: boolean;
  onClose: () => void;
  serverUrl: string;
  isRemote: boolean;
  onSaved?: (count: number) => void;
}

interface ConcertRow {
  artist: string;
  date: string;
  venue: string;
  url: string;
  spotify_id: string;
  followed: boolean;
  selected: boolean;
}

export const ConcertsDialog: React.FC<ConcertsDialogProps> = ({
  open, onClose, serverUrl, isRemote, onSaved,
}) => {
  const [url, setUrl] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [rows, setRows] = useState<ConcertRow[]>([]);
  const [manualArtist, setManualArtist] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualVenue, setManualVenue] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<LLMChatSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Default to correlating the scan with the user's followed Spotify artists.
  const [followedOnly, setFollowedOnly] = useState(true);
  // Click-and-forget background scan (server-side) whose results wait for review.
  const [scan, setScan] = useState<RemoteConcertScan | null>(null);
  const [scanChecking, setScanChecking] = useState(false);

  // Turn a finished scan into review rows (correlate artists with Spotify).
  const applyScan = useCallback((next: RemoteConcertScan) => {
    setScan(next);
    if (next.status === 'error') {
      setError(next.error || 'Scan failed.');
      return;
    }
    if (next.status !== 'ready') {
      setResultMessage(next.message || 'Scanning in the background…');
      return;
    }
    const items: RemoteConcertScanItem[] = next.items ?? [];
    if (!items.length) {
      setError('AI found no concerts on this page.');
      setRows([]); setUnresolved([]);
      return;
    }
    void (async () => {
      try {
        const { resolved, unresolved } = await resolveArtists(serverUrl, items.map((c) => c.artist));
        const resolvedMap = new Map(resolved.map((r) => [r.name.toLowerCase(), r]));
        setRows(items.map((c) => {
          const match = resolvedMap.get(c.artist.toLowerCase()) ??
            resolved.find((r) => r.name.toLowerCase().includes(c.artist.toLowerCase()) || c.artist.toLowerCase().includes(r.name.toLowerCase()));
          return {
            artist: c.artist,
            date: c.date,
            venue: c.venue,
            url: c.url,
            spotify_id: match?.spotify_id ?? '',
            followed: match?.followed ?? false,
            selected: match?.followed ?? false,
          };
        }));
        setUnresolved(unresolved);
        setResultMessage(`Scan ready: ${items.length} concert(s). Review and save the ones you want.`);
      } catch (e: any) {
        setError(e?.message ?? 'Could not resolve artists.');
      }
    })();
  }, [serverUrl]);

  const loadLatestScan = useCallback(async () => {
    if (!serverUrl) return;
    setScanChecking(true);
    try {
      const next = await getLatestRemoteConcertScan(serverUrl);
      if (next) applyScan(next);
    } catch {
      /* background check is best-effort */
    } finally {
      setScanChecking(false);
    }
  }, [serverUrl, applyScan]);

  // On open, pull whatever the background scan produced while away.
  useEffect(() => {
    if (!open || !serverUrl) return;
    void loadLatestScan();
  }, [open, serverUrl, loadLatestScan]);

  // Keep refreshing while a scan is still running in the background.
  useEffect(() => {
    if (!open || !serverUrl || scan?.status !== 'running') return;
    const timer = window.setInterval(() => { void loadLatestScan(); }, 4000);
    return () => window.clearInterval(timer);
  }, [open, serverUrl, scan?.status, loadLatestScan]);

  // Load chat history on mount
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHistoryLoading(true);
    listLLMChats(serverUrl, 'extract_concerts')
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

  const handleScan = async () => {
    setError(''); setResultMessage(''); setScanning(true); setRows([]); setUnresolved([]);
    try {
      // Click and forget: the server runs the scan in the background and
      // streams progress into Open WebUI. Results wait on /latest for review.
      const started = await startRemoteConcertScan(serverUrl, {
        url: url.trim() || undefined,
        text: url.trim() ? undefined : pasteText.trim(),
      });
      setScan(started);
      setResultMessage('Scan started in the background. You can close this — results will be waiting when you return.');
      setUrl(''); setPasteText('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not start the scan.');
    } finally {
      setScanning(false);
    }
  };

  const handleManualSave = async () => {
    if (!manualArtist.trim()) { setError('Artist is required.'); return; }
    setSaving(true); setError(''); setResultMessage('');
    try {
      const concert: Concert = {
        id: `${manualArtist}-${manualDate}`.replace(/\s+/g, '_'),
        artist: manualArtist.trim(),
        artist_id: '',
        title: manualArtist.trim() + (manualVenue ? ` at ${manualVenue}` : ''),
        date: manualDate,
        venue: manualVenue,
        url: manualUrl,
        source_url: 'manual',
        followed: false,
        created_at: new Date().toISOString(),
      };
      await saveConcerts({ remote: isRemote, serverUrl }, [concert]);
      onSaved?.(1);
      setResultMessage('Saved 1 concert.');
      setManualArtist(''); setManualDate(''); setManualVenue(''); setManualUrl('');
    } catch (e: any) {
      setError(e?.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (i: number) => {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, selected: !r.selected } : r));
  };

  const handleSave = async () => {
    const selectedRows = rows.filter((r) => r.selected && (!followedOnly || r.followed));
    if (!selectedRows.length) return;
    setSaving(true); setError(''); setResultMessage('');
    try {
      const sourceUrl = scan?.source_url || (scan ? (scan.source_kind === 'text' ? 'pasted text' : '') : '');
      const concerts: Concert[] = selectedRows.map((r, i) => ({
        id: `${r.artist}-${r.date}-${i}`.replace(/\s+/g, '_'),
        artist: r.artist,
        artist_id: r.spotify_id,
        title: r.artist + (r.venue ? ` at ${r.venue}` : ''),
        date: r.date,
        venue: r.venue,
        url: r.url,
        source_url: sourceUrl,
        followed: r.followed,
        created_at: new Date().toISOString(),
      }));
      await saveConcerts({ remote: isRemote, serverUrl }, concerts);
      // The scan is reviewed and saved: dismiss it so it does not reappear.
      if (scan) {
        try { await deleteRemoteConcertScan(serverUrl, scan.id); } catch { /* best-effort */ }
      }
      setScan(null);
      setRows([]); setUnresolved([]);
      onSaved?.(concerts.length);
      setResultMessage(`Saved ${concerts.length} concert(s).`);
    } catch (e: any) {
      setError(e?.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // Throw away a scan (reviewed or not) so it stops showing up in this dialog.
  const dismissScan = async () => {
    if (scan) {
      try { await deleteRemoteConcertScan(serverUrl, scan.id); } catch { /* best-effort */ }
    }
    setScan(null);
    setRows([]); setUnresolved([]);
    setError(''); setResultMessage('');
  };

  const loadChat = async (chatId: string) => {
    setHistoryLoading(true);
    try {
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
    setRows([]);
    setUnresolved([]);
    setShowHistory(false);
  };

  // Correlation helpers: what the user sees and can save under the current filter.
  const followedCount = rows.filter((r) => r.followed).length;
  const visibleRows = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !followedOnly || r.followed);
  const selectedVisible = rows.filter((r) => r.selected && (!followedOnly || r.followed));

  return (
    <div className="modal-overlay add-from-site-overlay" role="presentation" onClick={onClose}>
      <div className="modal add-from-site-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h2>Scan concerts (AI)</h2>
            <p className="modal-description">
              Paste a concerts/events URL or text. AI extracts artists and correlates them
              with the artists you follow on Spotify; the list defaults to your followed artists.
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
              <strong>Recent concert scans</strong>
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

        {serverUrl ? (
          <div className="add-from-site-toolbar">
            <input
              className="form-input"
              placeholder="https://example.com/concerts"
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
        ) : (
          <div className="add-from-site-toolbar">
            <input className="form-input" placeholder="Artist" value={manualArtist} onChange={(e) => setManualArtist(e.target.value)} />
            <input className="form-input" placeholder="Date (YYYY-MM-DD)" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
            <input className="form-input" placeholder="Venue (optional)" value={manualVenue} onChange={(e) => setManualVenue(e.target.value)} />
            <input className="form-input" placeholder="URL (optional)" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} />
            <button type="button" className="sync-btn" onClick={() => void handleManualSave()} disabled={saving || !manualArtist.trim()}>
              {saving ? 'Saving…' : 'Save concert'}
            </button>
          </div>
        )}

        {scan && (
          <div
            style={{
              display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
              margin: '8px 0', padding: 8, border: '1px solid #333', borderRadius: 8,
            }}
          >
            <span className="muted" style={{ flex: 1, minWidth: 200 }}>
              {scan.status === 'running'
                ? `Scanning in the background (${scan.stage || 'queued'})… progress is logged in Open WebUI.`
                : scan.status === 'ready'
                  ? `Scan ready: ${scan.items.length} concert(s) to review.`
                  : `Scan failed: ${scan.error || 'unknown error'}`}
              {scan.source_url ? ` · ${scan.source_url}` : ''}
            </span>
            <button
              type="button"
              className="url-btn"
              onClick={() => void loadLatestScan()}
              disabled={scanChecking}
            >
              {scanChecking ? 'Refreshing…' : 'Refresh'}
            </button>
            <button type="button" className="url-btn" onClick={() => void dismissScan()} disabled={saving}>
              Dismiss scan
            </button>
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}
        {resultMessage && <div className="success-banner">{resultMessage}</div>}

        {rows.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 4px' }}>
              <button
                type="button"
                className="url-btn"
                onClick={() => setFollowedOnly(true)}
                style={{ fontWeight: followedOnly ? 700 : 400 }}
              >
                Followed ({followedCount})
              </button>
              <button
                type="button"
                className="url-btn"
                onClick={() => setFollowedOnly(false)}
                style={{ fontWeight: followedOnly ? 400 : 700 }}
              >
                All ({rows.length})
              </button>
            </div>
            {followedOnly && followedCount === 0 && (
              <p className="muted" style={{ margin: '4px 0' }}>
                No concerts by artists you follow.{' '}
                <button type="button" className="url-btn" onClick={() => setFollowedOnly(false)}>
                  Show all {rows.length}
                </button>
              </p>
            )}
            <ul className="add-from-site-list">
              {visibleRows.map(({ r, i }) => (
                <li key={i} className="add-from-site-item">
                  <label>
                    <input type="checkbox" checked={r.selected} onChange={() => toggle(i)} />
                    <span className="album-meta">
                      <strong>{r.artist}</strong>
                      <span className="muted">
                        {r.date || 'date unknown'}{r.venue ? ` · ${r.venue}` : ''}{r.followed ? ' · ★ followed' : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="add-from-site-footer">
              <button type="button" className="sync-btn" onClick={() => void handleSave()} disabled={saving || selectedVisible.length === 0}>
                {saving ? 'Saving…' : `Save ${selectedVisible.length} concert(s)`}
              </button>
              <button type="button" className="sync-btn sync-btn--ghost" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {unresolved.length > 0 && (
          <div className="add-from-site-unresolved">
            <h4>Artists not found on Spotify</h4>
            <ul>{unresolved.map((u, i) => <li key={i}>{u}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
};