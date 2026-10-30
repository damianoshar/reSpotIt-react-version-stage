import React from 'react';
import { LibraryStats } from '../types';

interface Props {
  stats: LibraryStats;
}

const Stat: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="stat-item">
    <span className="stat-value">{value}</span>
    <span className="stat-label">{label}</span>
  </div>
);

export const StatsBar: React.FC<Props> = ({ stats }) => (
  <div className="stats-bar">
    <Stat label="Albums"  value={stats.totalAlbums.toLocaleString()} />
    <Stat label="Artists" value={stats.totalArtists.toLocaleString()} />
    <Stat label="Genres"  value={stats.totalGenres.toLocaleString()} />
    {stats.oldestYear > 0 && (
      <Stat
        label="Years"
        value={stats.oldestYear === stats.newestYear
          ? `${stats.oldestYear}`
          : `${stats.oldestYear} – ${stats.newestYear}`}
      />
    )}
  </div>
);
