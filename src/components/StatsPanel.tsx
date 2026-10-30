import React from 'react';
import { LibraryStats } from '../types';

interface Props {
  stats: LibraryStats | null;
}

const BarRow: React.FC<{ name: string; count: number; max: number }> = ({ name, count, max }) => (
  <div className="stat-bar-row">
    <span className="stat-bar-label" title={name}>{name}</span>
    <span className="stat-bar-track">
      <span className="stat-bar-fill" style={{ width: Math.max(4, Math.round((count / max) * 100)) + '%' }} />
    </span>
    <span className="stat-bar-count">{count}</span>
  </div>
);

export const StatsPanel: React.FC<Props> = ({ stats }) => {
  if (!stats) return null;

  const genres  = stats.topGenres  ?? [];
  const artists = stats.topArtists ?? [];
  const years   = stats.albumsByYear ?? [];

  if (genres.length === 0 && artists.length === 0 && years.length === 0) {
    return (
      <div className="stats-empty">
        <p>No breakdown available yet.</p>
        <p className="stats-empty-sub">
          Sync your library to fill this in — or the connected server may not expose the
          stats extras (only the totals above are guaranteed by the contract).
        </p>
      </div>
    );
  }

  const gMax = Math.max(1, ...genres.map((g) => g.count));
  const aMax = Math.max(1, ...artists.map((a) => a.count));
  const yMax = Math.max(1, ...years.map((y) => y.count));

  return (
    <div className="stats-page">
      <div className="stats-grid">
        {genres.length > 0 && (
          <section className="stats-card">
            <h3 className="stats-card-title">Top genres</h3>
            {genres.map((g) => <BarRow key={g.name} name={g.name} count={g.count} max={gMax} />)}
          </section>
        )}
        {artists.length > 0 && (
          <section className="stats-card">
            <h3 className="stats-card-title">Top artists</h3>
            {artists.map((a) => <BarRow key={a.name} name={a.name} count={a.count} max={aMax} />)}
          </section>
        )}
      </div>

      {years.length > 0 && (
        <section className="stats-card stats-card--wide">
          <h3 className="stats-card-title">Albums by year</h3>
          <div className="year-histogram" role="img" aria-label="Albums by release year">
            {years.map((y) => (
              <div key={y.year} className="year-bar-wrap" title={y.year + ': ' + y.count + ' album' + (y.count !== 1 ? 's' : '')}>
                <div className="year-bar" style={{ height: Math.max(3, Math.round((y.count / yMax) * 100)) + '%' }} />
                {(y.year % 10 === 0) && <span className="year-tick">{String(y.year).slice(2)}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
