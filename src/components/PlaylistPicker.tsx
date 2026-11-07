import { Artwork } from './Artwork';
import React, { useState, useMemo } from 'react';
import { SpotifyPlaylist } from '../services/SpotifyPlaylistService';
import { spotifyPlaylistUrl } from '../utils/spotifyLinks';
import { ViewMode } from '../types';
import {
  type PlaylistSortField,
  type PlaylistSortOrder,
  applyPlaylists,
} from '../utils/playlistListOptions';

interface Props {
  playlists:  SpotifyPlaylist[];
  loading:    boolean;
  error:      string;
  cachedIds:  Set<string>;
  selectedIds?: Set<string>;
  onSelect:   (p: SpotifyPlaylist) => void;
  onToggleSelect?: (id: string) => void;
  onClearSelection?: () => void;
  onRefresh:  () => void;
  onDeleteSelected?: (ids: string[]) => void;
  deleteBusy?: boolean;
  viewMode?:  ViewMode;
  onViewModeChange?: (m: ViewMode) => void;
}

const SORT_OPTIONS: { field: PlaylistSortField; label: string }[] = [
  { field: 'name',   label: 'Name' },
  { field: 'tracks', label: 'Tracks' },
  { field: 'added',  label: 'Date Added' },
];

const SkeletonCard: React.FC = () => (
  <div className="pl-card pl-card--skeleton" aria-hidden="true">
    <div className="pl-card-img skeleton" />
    <div className="pl-card-info">
      <div className="skeleton skeleton-text" style={{ width: '75%' }} />
      <div className="skeleton skeleton-text" style={{ width: '45%' }} />
    </div>
  </div>
);

export const PlaylistPicker: React.FC<Props> = ({
  playlists, loading, error, cachedIds, selectedIds = new Set(), onSelect,
  onToggleSelect, onClearSelection, onRefresh, onDeleteSelected, deleteBusy = false,
  viewMode, onViewModeChange,
}) => {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<PlaylistSortField>('added');
  const [sortOrder, setSortOrder] = useState<PlaylistSortOrder>('desc');

  const vm = viewMode ?? 'grid';

  const visible = useMemo(
    () => applyPlaylists(playlists, search, sortField, sortOrder),
    [playlists, search, sortField, sortOrder],
  );

  const handleSort = (field: PlaylistSortField) => {
    if (field === sortField) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'name' ? 'asc' : 'desc');
    }
  };

  const cachedCount = playlists.filter((p) => cachedIds.has(p.id)).length;

  return (
    <div className="pl-picker" style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', padding: '0.5rem 0.5rem 0.75rem' }}>
      <div className="pl-picker-header" style={{ marginBottom: '0.375rem' }}>
        <div>
          <h2 className="pl-picker-title">Your Playlists</h2>
          {cachedCount > 0 && (
            <p className="pl-picker-subtitle">
              {cachedCount} saved offline
            </p>
          )}
        </div>
        <button className="pl-refresh-btn" onClick={onRefresh} disabled={loading} aria-label="Refresh">
          {loading
            ? <span className="spinner" aria-hidden="true" />
            : <svg viewBox="0 0 24 24" fill="none" width="16" height="16" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M21 3v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
          }
        </button>
      </div>
      {selectedIds.size > 0 && (
        <div className="pl-delete-toolbar">
          <span>{selectedIds.size} selected</span>
          <button type="button" className="pl-delete-btn pl-delete-btn--danger" disabled={deleteBusy}
            onClick={() => {
              if (!window.confirm('Delete the selected playlists from your library?')) return;
              onDeleteSelected?.([...selectedIds]);
            }}>
            {deleteBusy ? 'Deleting\u2026' : 'Delete selected'}
          </button>
          <button type="button" className="pl-delete-btn" onClick={() => onClearSelection?.()}>Clear</button>
        </div>
      )}

      <div className="search-wrap pl-search" style={{ marginBottom: '0.375rem' }}>
        <svg className="search-icon" viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8"/>
          <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
        <input
          className="search-input"
          type="search"
          placeholder={'Search ' + playlists.length + ' playlists…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search playlists"
        />
        {search && (
          <button className="search-clear" onClick={() => setSearch('')} aria-label="Clear">&#x2715;</button>
        )}
      </div>

      <div className="pl-toolbar">
        <div className="sort-row pl-sort-row">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.field}
              type="button"
              className={'sort-chip' + (sortField === opt.field ? ' active' : '')}
              aria-pressed={sortField === opt.field}
              onClick={() => handleSort(opt.field)}
            >
              {opt.label}
              {sortField === opt.field && (
                <span className="sort-arrow">{sortOrder === 'asc' ? ' ▲' : ' ▼'}</span>
              )}
            </button>
          ))}
        </div>
        {onViewModeChange && (
          <div className="view-mode-group" role="group" aria-label="Playlist view mode">
            {(['grid', 'list', 'compact'] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={'view-mode-btn' + (vm === m ? ' active' : '')}
                aria-pressed={vm === m}
                onClick={() => onViewModeChange(m)}
              >
                {m === 'grid' ? 'Grid' : m === 'list' ? 'List' : 'Compact'}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="error-banner" role="alert">&#x26A0; {error}</div>}

      {loading && playlists.length === 0 ? (
        <div className={vm === 'list' ? 'pl-list' : 'pl-grid' + (vm === 'compact' ? ' pl-grid--compact' : '')}>
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <p>{search ? 'No playlists match "' + search + '".' : 'No playlists found.'}</p>
        </div>
      ) : vm === 'list' ? (
        <div className="pl-list">
          {visible.map((p) => {
            const href = spotifyPlaylistUrl(p.id);
            return (
              <div key={p.id} className="pl-row-wrap">
                {onToggleSelect && (
                  <button
                    type="button"
                    className={'pl-select-check pl-select-check--row' + (selectedIds.has(p.id) ? ' checked' : '')}
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(p.id); }}
                    aria-label={'Toggle ' + p.name}
                    aria-pressed={selectedIds.has(p.id)}
                  >
                    {selectedIds.has(p.id) ? '\u2713' : ''}
                  </button>
                )}
                <button
                  className={'pl-row' + (cachedIds.has(p.id) ? ' pl-row--cached' : '')}
                  onClick={() => onSelect(p)}
                  aria-label={'Open ' + p.name}
                >
                  <div className="pl-row-cover">
                    {p.images?.[0]?.url ? (
                      <Artwork src={p.images[0].url} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <div className="pl-row-cover-ph" aria-hidden="true" />
                    )}
                  </div>
                  <div className="pl-row-info">
                    <p className="pl-row-name">{p.name}</p>
                    <p className="pl-row-meta">{p.tracks.total} tracks</p>
                  </div>
                </button>
                {href && (
                  <a
                    className="pl-card-link pl-row-link"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={'Open ' + p.name + ' on Spotify'}
                    title="Open on Spotify"
                  >{'\u2197'}</a>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={'pl-grid' + (vm === 'compact' ? ' pl-grid--compact' : '')}>
          {visible.map((p) => {
            const href = spotifyPlaylistUrl(p.id);
            return (
              <div key={p.id} className="pl-card-wrap">
                {onToggleSelect && (
                  <button
                    type="button"
                    className={'pl-select-check' + (selectedIds.has(p.id) ? ' checked' : '')}
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(p.id); }}
                    aria-label={'Toggle ' + p.name}
                    aria-pressed={selectedIds.has(p.id)}
                  >
                    {selectedIds.has(p.id) ? '\u2713' : ''}
                  </button>
                )}
                <button
                  className={'pl-card' + (cachedIds.has(p.id) ? ' pl-card--cached' : '')}
                  onClick={() => onSelect(p)}
                  aria-label={'Open ' + p.name}
                >
                  <div className="pl-card-img">
                    {p.images?.[0]?.url ? (
                      <Artwork src={p.images[0].url} alt={p.name} loading="lazy" decoding="async" />
                    ) : (
                      <div className="pl-card-img-placeholder" aria-hidden="true" />
                    )}
                    {cachedIds.has(p.id) && (
                      <span className="pl-cached-badge" aria-label="Saved offline">
                        <svg viewBox="0 0 12 12" fill="none" width="10" height="10" aria-hidden="true">
                          <path d="M6 1v6M3.5 4.5L6 7l2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M1 9.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </span>
                    )}
                  </div>
                  <div className="pl-card-info">
                    <p className="pl-card-name">{p.name}</p>
                    {vm !== 'compact' && (
                      <p className="pl-card-meta">{p.tracks.total} tracks</p>
                    )}
                  </div>
                </button>
                {href && (
                  <a className="pl-card-link" href={href} target="_blank" rel="noopener noreferrer"
                     onClick={(e) => e.stopPropagation()}
                     aria-label={'Open ' + p.name + ' on Spotify'} title="Open on Spotify">
                    {'\u2197'}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
