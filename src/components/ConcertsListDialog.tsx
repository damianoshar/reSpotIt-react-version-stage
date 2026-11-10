import React, { useEffect, useMemo, useState } from 'react';
import { getConcerts, deleteConcert, clearConcerts, type Concert } from '../services/DatabaseService';

export interface ConcertsListDialogProps {
  open: boolean;
  onClose: () => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-time YYYY-MM-DD (never UTC — a concert on the 3rd is on the 3rd). */
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

const todayIso = () => {
  const now = new Date();
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
};

/** Monday-first 6x7 grid covering the given month. */
function buildMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - offset + i);
    cells.push({
      iso: toIso(d.getFullYear(), d.getMonth(), d.getDate()),
      day: d.getDate(),
      inMonth: d.getMonth() === month,
    });
  }
  return cells;
}

/** Concerts are dated "YYYY-MM-DD"; anything else counts as undated. */
const dateKey = (c: Concert) => (/^\d{4}-\d{2}-\d{2}$/.test(c.date || '') ? c.date : '');

interface ConcertCardProps {
  concert: Concert;
  onDelete: (id: string) => void;
  dimmed?: boolean;
}

/**
 * One concert as a card. The artist and the follow-up line are separate
 * blocks (not inline siblings) so they can never run into each other.
 */
const ConcertCard: React.FC<ConcertCardProps> = ({ concert: c, onDelete, dimmed }) => {
  const meta = [c.date || 'date TBD', c.venue].filter(Boolean).join(' · ');
  return (
    <li className="list-card" style={dimmed ? { opacity: 0.6 } : undefined}>
      <span className="list-card__main">
        <span className="list-card__title">{c.artist || '(unknown artist)'}</span>
        <span className="list-card__meta">{meta}</span>
      </span>
      {c.followed && <span className="list-card__badge">★ followed</span>}
      <span className="list-card__actions">
        {c.url && (
          <a href={c.url} target="_blank" rel="noreferrer" className="muted list-card__link">link</a>
        )}
        <button
          type="button"
          className="sync-btn sync-btn--ghost"
          onClick={() => onDelete(c.id)}
          aria-label={`Delete ${c.artist}`}
        >✕</button>
      </span>
    </li>
  );
};

export const ConcertsListDialog: React.FC<ConcertsListDialogProps> = ({ open, onClose }) => {
  const [concerts, setConcerts] = useState<Concert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // The calendar view survives closing the dialog: it is part of the screen
  // state, not of the sheet that is opened on top of it.
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try { setConcerts(await getConcerts()); }
    catch (e: any) { setError(e?.message ?? 'Could not load concerts.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) void load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id: string) => {
    try { await deleteConcert(id); await load(); }
    catch (e: any) { setError(e?.message ?? 'Delete failed.'); }
  };

  const handleClear = async () => {
    if (!confirm('Delete all saved concerts?')) return;
    try { await clearConcerts(); setSelectedDate(null); await load(); }
    catch (e: any) { setError(e?.message ?? 'Clear failed.'); }
  };

  const today = todayIso();

  const byDate = useMemo(() => {
    const map = new Map<string, Concert[]>();
    for (const c of concerts) {
      const key = dateKey(c);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.artist.localeCompare(b.artist));
    }
    return map;
  }, [concerts]);

  const undated = useMemo(
    () => concerts.filter((c) => !dateKey(c)).sort((a, b) => a.artist.localeCompare(b.artist)),
    [concerts],
  );

  const dated = useMemo(
    () => concerts
      .filter((c) => dateKey(c))
      .sort((a, b) => dateKey(a).localeCompare(dateKey(b)) || a.artist.localeCompare(b.artist)),
    [concerts],
  );

  const upcoming = useMemo(() => dated.filter((c) => dateKey(c) >= today), [dated, today]);
  const past = useMemo(() => dated.filter((c) => dateKey(c) < today), [dated, today]);

  const cells = useMemo(() => buildMonthGrid(view.year, view.month), [view]);

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const next = new Date(v.year, v.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  const goToday = () => {
    const now = new Date();
    setView({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDate(today);
  };

  if (!open) return null;

  const selectedConcerts = selectedDate ? (byDate.get(selectedDate) ?? []) : [];

  const listTitle = selectedDate
    ? `Concerts on ${selectedDate}`
    : 'Upcoming';

  const listItems = selectedDate
    ? selectedConcerts
    : upcoming;

  return (
    <div className="modal-overlay add-from-site-overlay" role="presentation" onClick={onClose}>
      <div className="modal add-from-site-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h2>Concerts calendar</h2>
            <p className="modal-description">
              {concerts.length} saved concert(s). The calendar and the list below stay as you left them.
            </p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {loading && <p className="muted">Loading…</p>}

        {!loading && (
          <section className="concert-calendar" aria-label="Concert calendar">
            <div className="concert-calendar__head">
              <button
                type="button"
                className="url-btn"
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
              >‹</button>
              <span className="concert-calendar__title">
                {MONTH_NAMES[view.month]} {view.year}
              </span>
              <span className="concert-calendar__nav">
                <button type="button" className="url-btn" onClick={goToday}>Today</button>
                <button
                  type="button"
                  className="url-btn"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                >›</button>
              </span>
            </div>

            <div className="concert-calendar__weekdays" aria-hidden="true">
              {WEEKDAYS.map((d) => (
                <span key={d} className="concert-calendar__weekday">{d}</span>
              ))}
            </div>

            <div className="concert-calendar__grid">
              {cells.map((c) => {
                const count = byDate.get(c.iso)?.length ?? 0;
                const cls = [
                  'concert-calendar__day',
                  c.inMonth ? '' : 'concert-calendar__day--outside',
                  count ? 'concert-calendar__day--has' : '',
                  c.iso === today ? 'concert-calendar__day--today' : '',
                  c.iso === selectedDate ? 'concert-calendar__day--selected' : '',
                ].filter(Boolean).join(' ');
                return (
                  <button
                    key={c.iso}
                    type="button"
                    className={cls}
                    onClick={() => setSelectedDate(selectedDate === c.iso ? null : c.iso)}
                    aria-label={`${c.iso}${count ? `, ${count} concert(s)` : ''}`}
                  >
                    <span className="concert-calendar__daynum">{c.day}</span>
                    {count > 0 && <span className="concert-calendar__dot" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {!loading && concerts.length === 0 && <p className="muted">No concerts saved yet.</p>}

        {!loading && concerts.length > 0 && (
          <>
            <div className="list-card-list__head">
              <h3 className="settings-heading">{listTitle}</h3>
              {selectedDate && (
                <button
                  type="button"
                  className="url-btn"
                  onClick={() => setSelectedDate(null)}
                >Show all upcoming</button>
              )}
            </div>

            {listItems.length > 0 ? (
              <ul className="list-card-list">
                {listItems.map((c) => (
                  <ConcertCard key={c.id} concert={c} onDelete={(id) => void handleDelete(id)} />
                ))}
              </ul>
            ) : (
              <p className="muted">
                {selectedDate ? 'No concerts on this day.' : 'No upcoming concerts saved.'}
              </p>
            )}

            {undated.length > 0 && (
              <>
                <h3 className="settings-heading">Without a date</h3>
                <ul className="list-card-list">
                  {undated.map((c) => (
                    <ConcertCard key={c.id} concert={c} onDelete={(id) => void handleDelete(id)} />
                  ))}
                </ul>
              </>
            )}

            {past.length > 0 && !selectedDate && (
              <>
                <h3 className="settings-heading">Past</h3>
                <ul className="list-card-list">
                  {past.map((c) => (
                    <ConcertCard key={c.id} concert={c} onDelete={(id) => void handleDelete(id)} dimmed />
                  ))}
                </ul>
              </>
            )}
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
