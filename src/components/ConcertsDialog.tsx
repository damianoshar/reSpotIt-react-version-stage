import React, { useEffect, useState } from 'react';
import {
  extractConcertsFromUrl,
  extractConcertsFromText,
  type ExtractedConcert,
  listLLMChats,
  chatWithLLM,
  deleteLLMChat,
  type LLMChatSummary,
  type LLMMessage,
  type LLMChatResult,
} from '../services/LLMService';
import { resolveArtists, type ResolvedArtist } from '../services/remote/spotifyRemote';
import { upsertConcerts, type Concert } from '../services/DatabaseService';

export interface ConcertsDialogProps {
  open: boolean;
  onClose: () => void;
  serverUrl: string;
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
  open, onClose, serverUrl, onSaved,
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
    setError(''); setResultMessage(''); setScanning(true);
    try {
      const extracted = url.trim()
        ? await extractConcertsFromUrl(serverUrl, url.trim())
        : await extractConcertsFromText(serverUrl, pasteText.trim());
      if (!extracted.length) {
        setError('AI found no concerts on this page.');
        setRows([]); setUnresolved([]);
        return;
      }
      const { resolved, unresolved } = await resolveArtists(serverUrl, extracted.map((c) => c.artist));
      const resolvedMap = new Map(resolved.map((r) => [r.name.toLowerCase(), r]));
      const nextRows: ConcertRow[] = extracted.map((c, i) => {
        const match = resolvedMap.get(c.artist.toLowerCase()) ??
          resolved.find((r) => r.name.toLowerCase().includes(c.artist.toLowerCase()) || c.artist.toLowerCase().includes(r.name.toLowerCase()));
        return {
          artist: c.artist,
          date: c.date,
          venue: c.venue,
          url: c.url,
          spotify_id: match?.spotify_id ?? '',
          followed: match?.followed ?? false,
          selected: true,
        };
      });
      setRows(nextRows);
      setUnresolved(unresolved);
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed.');
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
      await upsertConcerts([concert]);
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
    const selectedRows = rows.filter((r) => r.selected);
    if (!selectedRows.length) return;
    setSaving(true); setError(''); setResultMessage('');
    try {
      const concerts: Concert[] = selectedRows.map((r, i) => ({
        id: `${r.artist}-${r.date}-${i}`.replace(/\s+/g, '_'),
        artist: r.artist,
        artist_id: r.spotify_id,
        title: r.artist + (r.venue ? ` at ${r.venue}` : ''),
        date: r.date,
        venue: r.venue,
        url: r.url,
        source_url: url.trim() || 'pasted text',
        followed: r.followed,
        created_at: new Date().toISOString(),
      }));
      await upsertConcerts(concerts);
      onSaved?.(concerts.length);
      setResultMessage(`Saved ${concerts.length} concert(s).`);
    } catch (e: any) {
      setError(e?.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // Build context for LLM chat
  const buildContext = (concerts: ConcertRow[]) => {
    const lines: string[] = [];
    if (concerts.length) {
      lines.push('Concerts extracted from page:');
      concerts.slice(0, 50).forEach((c) => {
        lines.push(`- ${c.artist} — ${c.date || 'date unknown'}${c.venue ? ` at ${c.venue}` : ''}${c.followed ? ' (followed on Spotify)' : ''}`);
      });
    }
    return lines.join('\n');
  };

  // Persist scan as chat turn
  const persistScanChat = async (userPrompt: string) => {
    if (!serverUrl) return;
    const context = buildContext(rows);
    const systemPrompt =
      'You are a concert calendar assistant. The user scanned a page for concerts. ' +
      'The extracted concerts are listed below. You can help them refine the selection, ' +
      'follow artists on Spotify, or answer questions about the events.';
    try {
      const result = await chatWithLLM(serverUrl, [
        { role: 'system', content: systemPrompt + '\n\nConcerts:\n' + context },
        { role: 'user', content: userPrompt },
      ], {
        system: systemPrompt + '\n\nConcerts:\n' + context,
        chat_id: chatId,
        use_history: true,
        history_limit: 20,
        persist: true,
        use_tools: false,
        temperature: 0.3,
        max_tokens: 512,
        chat_type: 'extract_concerts',
      });
      if (result.chat_id) setChatId(result.chat_id);
    } catch (e: any) {
      console.warn('Could not persist scan chat:', e);
    }
  };

  const handleSaveWithChat = async () => {
    await handleSave();
    await persistScanChat(`Saved ${rows.filter((r) => r.selected).length} concert(s).`);
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

  return (
    <div className="modal-overlay add-from-site-overlay" role="presentation" onClick={onClose}>
      <div className="modal add-from-site-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h2>Scan concerts (AI)</h2>
            <p className="modal-description">
              Paste a concerts/events URL. AI extracts artists; matched followed artists are flagged.
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

        {error && <div className="error-banner">{error}</div>}
        {resultMessage && <div className="success-banner">{resultMessage}</div>}

        {rows.length > 0 && (
          <>
            <ul className="add-from-site-list">
              {rows.map((r, i) => (
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
              <button type="button" className="sync-btn" onClick={() => void handleSaveWithChat()} disabled={saving || !rows.some((r) => r.selected)}>
                {saving ? 'Saving…' : `Save ${rows.filter((r) => r.selected).length} concert(s)`}
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