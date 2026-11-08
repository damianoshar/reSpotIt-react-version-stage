import React, { useEffect, useState } from 'react';
import type { Concert } from '../services/DatabaseService';
import { listConcerts, removeConcert, clearAllConcerts } from '../services/storage';

export interface ConcertsListDialogProps {
  open: boolean;
  onClose: () => void;
  serverUrl: string;
  isRemote: boolean;
}

export const ConcertsListDialog: React.FC<ConcertsListDialogProps> = ({
  open, onClose, serverUrl, isRemote,
}) => {
  const ctx = { remote: isRemote, serverUrl };
  const [concerts, setConcerts] = useState<Concert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setConcerts(await listConcerts(ctx)); }
    catch (e: any) { setError(e?.message ?? 'Could not load concerts.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) void load(); }, [open, isRemote, serverUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id: string) => {
    try { await removeConcert(ctx, id); await load(); }
    catch (e: any) { setError(e?.message ?? 'Delete failed.'); }
  };

  const handleClear = async () => {
    if (!confirm('Delete all saved concerts?')) return;
    try { await clearAllConcerts(ctx); await load(); }
    catch (e: any) { setError(e?.message ?? 'Clear failed.'); }
  };

  if (!open) return null;

  const upcoming = concerts.filter((c) => !c.date || c.date >= new Date().toISOString().slice(0, 10));
  const past = concerts.filter((c) => c.date && c.date < new Date().toISOString().slice(0, 10));

  return (
    <div className="modal-overlay add-from-site-overlay" role="presentation" onClick={onClose}>
      <div className="modal add-from-site-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h2>Concerts calendar</h2>
            <p className="modal-description">{concerts.length} saved concert(s).</p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {loading && <p className="muted">Loading…</p>}

        {!loading && concerts.length === 0 && <p className="muted">No concerts saved yet.</p>}

        {upcoming.length > 0 && (
          <>
            <h3 className="settings-heading">Upcoming</h3>
            <ul className="add-from-site-list">
              {upcoming.map((c) => (
                <li key={c.id} className="add-from-site-item">
                  <span className="album-meta">
                    <strong>{c.artist}</strong>
                    <span className="muted">
                      {c.date || 'date TBD'}{c.venue ? ` · ${c.venue}` : ''}{c.followed ? ' · ★ followed' : ''}
                    </span>
                    {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="muted"> link</a>}
                  </span>
                  <button type="button" className="sync-btn sync-btn--ghost" onClick={() => void handleDelete(c.id)}>✕</button>
                </li>
              ))}
            </ul>
          </>
        )}

        {past.length > 0 && (
          <>
            <h3 className="settings-heading">Past</h3>
            <ul className="add-from-site-list">
              {past.map((c) => (
                <li key={c.id} className="add-from-site-item" style={{ opacity: 0.6 }}>
                  <span className="album-meta">
                    <strong>{c.artist}</strong>
                    <span className="muted">{c.date}{c.venue ? ` · ${c.venue}` : ''}</span>
                  </span>
                  <button type="button" className="sync-btn sync-btn--ghost" onClick={() => void handleDelete(c.id)}>✕</button>
                </li>
              ))}
            </ul>
          </>
        )}

        {concerts.length > 0 && (
          <div className="add-from-site-footer">
            <button type="button" className="sync-btn sync-btn--ghost" onClick={() => void handleClear()}>Clear all</button>
            <button type="button" className="sync-btn sync-btn--ghost" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
};