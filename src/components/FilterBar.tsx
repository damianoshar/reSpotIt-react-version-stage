import React, { useState, useCallback, useMemo } from 'react';
import { FilterState, SortField, ViewMode } from '../types';

interface Props {
  filters:          FilterState;
  genres:           string[];
  artists:          string[];
  years:            number[];
  total:            number;
  gridSize:         number;
  onFilterChange:   <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  onReset:          () => void;
  onGridSizeChange: (size: number) => void;
  viewMode?:        ViewMode;
  onViewModeChange?: (m: ViewMode) => void;
}

const SORT_OPTIONS: { value: SortField; label: string; icon: string }[] = [
  { value: 'artist',     label: 'Artist',     icon: '👤' },
  { value: 'title',      label: 'Title',      icon: '🎵' },
  { value: 'year',       label: 'Year',       icon: '📅' },
  { value: 'genre',      label: 'Genre',      icon: '🏷' },
  { value: 'added_at',   label: 'Date Added', icon: '🕐' },
  { value: 'popularity', label: 'Popularity', icon: '⭐' },
];

// Min/max card widths in px that the slider maps to.
// min=80 → tiny dense grid, max=280 → large comfortable cards.
const GRID_MIN = 80;
const GRID_MAX = 280;

export const FilterBar: React.FC<Props> = ({
  filters, genres, artists, years, total, gridSize, onFilterChange, onReset, onGridSizeChange,
  viewMode, onViewModeChange,
}) => {
  const [expanded,      setExpanded]      = useState(false);
  const [artistSearch,  setArtistSearch]  = useState('');

  const activeCount = [
    filters.search   !== '',
    filters.genre    !== '',
    filters.artist   !== '',
    filters.yearFrom !== '',
    filters.yearTo   !== '',
    filters.albumType !== '',
    filters.minPop    > 0,
    filters.maxPop    < 100,
  ].filter(Boolean).length;

  const minYear = years[0]                ?? 1900;
  const maxYear = years[years.length - 1] ?? new Date().getFullYear();

  const handleYearFrom = useCallback((raw: string) => {
    const n = raw === '' ? '' : parseInt(raw, 10);
    onFilterChange('yearFrom', isNaN(n as number) ? '' : n);
  }, [onFilterChange]);

  const handleYearTo = useCallback((raw: string) => {
    const n = raw === '' ? '' : parseInt(raw, 10);
    onFilterChange('yearTo', isNaN(n as number) ? '' : n);
  }, [onFilterChange]);

  const filteredArtists = useMemo(() =>
    artistSearch.trim()
      ? artists.filter((a) => a.toLowerCase().includes(artistSearch.toLowerCase()))
      : artists,
    [artists, artistSearch]
  );

  return (
    <div className="filter-bar">
      {/* ── Always-visible row ── */}
      <div className="filter-row-main">
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 20 20" fill="none"
               aria-hidden="true" width="16" height="16">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <input
            className="search-input"
            type="search"
            placeholder="Search albums or artists…"
            value={filters.search}
            onChange={(e) => onFilterChange('search', e.target.value)}
            aria-label="Search library"
          />
          {filters.search && (
            <button className="search-clear" onClick={() => onFilterChange('search', '')}
                    aria-label="Clear search">✕</button>
          )}
        </div>

        <button
          className={'filter-toggle-btn ' + (expanded ? 'active' : '')}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label="Toggle filters"
        >
          <svg viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
            <path d="M3 5h14M6 10h8M9 15h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          Filters
          {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
        </button>
      </div>

      {/* ── Sort chips ── */}
      <div className="sort-row">
        <div className="sort-chips">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={'sort-chip ' + (filters.sortField === opt.value ? 'active' : '')}
              onClick={() => {
                if (filters.sortField === opt.value) {
                  onFilterChange('sortOrder', filters.sortOrder === 'asc' ? 'desc' : 'asc');
                } else {
                  onFilterChange('sortField', opt.value);
                  onFilterChange('sortOrder', 'asc');
                }
              }}
            >
              {opt.label}
              {filters.sortField === opt.value && (
                <span className="sort-arrow">{filters.sortOrder === 'asc' ? ' ▲' : ' ▼'}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── View mode + grid size ── */}
      <div className={'grid-size-row' + (viewMode === 'list' ? ' grid-size-row--no-slider' : '')}
           role="group" aria-label="View options">
        {viewMode && onViewModeChange && (
          <div className="view-mode-group" role="group" aria-label="View mode">
            {([['grid', 'Grid'], ['list', 'List'], ['compact', 'Compact']] as [ViewMode, string][]).map(([m, label]) => (
              <button key={m}
                      className={'view-mode-btn' + (viewMode === m ? ' active' : '')}
                      onClick={() => onViewModeChange(m)}
                      aria-pressed={viewMode === m}
                      title={label + ' view'}>
                {label}
              </button>
            ))}
          </div>
        )}
        <svg className="grid-size-icon" viewBox="0 0 20 20" fill="none"
             width="14" height="14" aria-hidden="true">
          <rect x="1" y="1" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/>
          <rect x="12" y="1" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/>
          <rect x="1" y="12" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/>
          <rect x="12" y="12" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/>
        </svg>
        <input
          className="grid-size-slider"
          type="range"
          min={GRID_MIN}
          max={GRID_MAX}
          step={10}
          value={gridSize}
          onChange={(e) => onGridSizeChange(Number(e.target.value))}
          aria-label="Album grid size"
          aria-valuemin={GRID_MIN}
          aria-valuemax={GRID_MAX}
          aria-valuenow={gridSize}
        />
        <svg className="grid-size-icon grid-size-icon--lg" viewBox="0 0 20 20" fill="none"
             width="20" height="20" aria-hidden="true">
          <rect x="1" y="1" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/>
          <rect x="12" y="1" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/>
          <rect x="1" y="12" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/>
          <rect x="12" y="12" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6"/>
        </svg>
      </div>

      {/* ── Expandable filter panel ── */}
      {expanded && (
        <div className="filter-panel">

          {/* Artist filter */}
          <div className="filter-group">
            <label className="filter-label">Artist</label>
            <div className="artist-search-wrap">
              <input
                className="search-input artist-filter-search"
                type="search"
                placeholder={'Search ' + artists.length + ' artists…'}
                value={artistSearch}
                onChange={(e) => setArtistSearch(e.target.value)}
                aria-label="Search artists"
              />
            </div>
            <select
              className="filter-select"
              value={filters.artist}
              onChange={(e) => { onFilterChange('artist', e.target.value); setArtistSearch(''); }}
              aria-label="Filter by artist"
              size={filteredArtists.length > 0 && artistSearch ? Math.min(filteredArtists.length + 1, 6) : 1}
            >
              <option value="">All Artists</option>
              {filteredArtists.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {filters.artist && (
              <button
                className="filter-clear-chip"
                onClick={() => { onFilterChange('artist', ''); setArtistSearch(''); }}
              >
                ✕ {filters.artist}
              </button>
            )}
          </div>

          {/* Genre filter */}
          <div className="filter-group">
            <label className="filter-label">Genre</label>
            <select
              className="filter-select"
              value={filters.genre}
              onChange={(e) => onFilterChange('genre', e.target.value)}
              aria-label="Filter by genre"
            >
              <option value="">All Genres</option>
              {genres.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            {filters.genre && (
              <button
                className="filter-clear-chip"
                onClick={() => onFilterChange('genre', '')}
              >
                ✕ {filters.genre}
              </button>
            )}
          </div>

          {/* Year range */}
          <div className="filter-group">
            <label className="filter-label">Release Year</label>
            <div className="year-range">
              <input className="year-input" type="number" min={minYear} max={maxYear}
                     placeholder={String(minYear)} value={filters.yearFrom}
                     onChange={(e) => handleYearFrom(e.target.value)} aria-label="Year from" />
              <span className="year-sep">—</span>
              <input className="year-input" type="number" min={minYear} max={maxYear}
                     placeholder={String(maxYear)} value={filters.yearTo}
                     onChange={(e) => handleYearTo(e.target.value)} aria-label="Year to" />
            </div>
            {years.length > 0 && (
              <div className="decade-chips">
                {getDecades(minYear, maxYear).map(([from, to]) => (
                  <button
                    key={from}
                    className={'decade-chip ' + (filters.yearFrom === from && filters.yearTo === to ? 'active' : '')}
                    onClick={() => {
                      if (filters.yearFrom === from && filters.yearTo === to) {
                        onFilterChange('yearFrom', '');
                        onFilterChange('yearTo', '');
                      } else {
                        onFilterChange('yearFrom', from);
                        onFilterChange('yearTo', to);
                      }
                    }}
                  >
                    {from}s
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Album type + popularity (rich extras) */}
          <div className="filter-group">
            <label className="filter-label" htmlFor="filter-album-type">Album Type</label>
            <select id="filter-album-type" className="filter-select"
                    value={filters.albumType}
                    onChange={(e) => onFilterChange('albumType', e.target.value)}
                    aria-label="Filter by album type">
              <option value="">All Types</option>
              <option value="album">Album</option>
              <option value="single">Single</option>
              <option value="compilation">Compilation</option>
              <option value="ep">EP</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">Popularity</label>
            <div className="year-range">
              <input className="year-input" type="number" min={0} max={100} step={5}
                     value={filters.minPop} aria-label="Minimum popularity"
                     onChange={(e) => onFilterChange('minPop', Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))} />
              <span className="year-sep">—</span>
              <input className="year-input" type="number" min={0} max={100} step={5}
                     value={filters.maxPop} aria-label="Maximum popularity"
                     onChange={(e) => onFilterChange('maxPop', Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))} />
            </div>
            <p className="backup-path-hint">0–100; leave 0–100 to include albums without a score</p>
          </div>

          {activeCount > 0 && (
            <button className="filter-reset-btn" onClick={onReset}>
              ✕ Clear {activeCount} filter{activeCount > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {/* ── Result count ── */}
      <div className="result-count">
        {total} album{total !== 1 ? 's' : ''}
        {activeCount > 0 && <span className="filtered-label"> (filtered)</span>}
      </div>
    </div>
  );
};

function getDecades(minYear: number, maxYear: number): [number, number][] {
  const decades: [number, number][] = [];
  const start = Math.floor(minYear / 10) * 10;
  const end   = Math.floor(maxYear / 10) * 10;
  for (let d = start; d <= end; d += 10) decades.push([d, d + 9]);
  return decades;
}
