import { Artwork } from './Artwork';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Album } from '../types';
import { AlbumCard } from './AlbumCard';
import { resolveImageSrc } from '../services/SyncService';
import { spotifyAlbumUrl } from '../utils/spotifyLinks';

interface Props {
  albums:      Album[];
  loading:     boolean;
  loadingMore: boolean;
  hasMore:     boolean;
  selected:    Set<string>;
  onSelect:    (id: string) => void;
  allSelected: boolean;
  onToggleAll: () => void;
  onLoadMore:  () => void;
  gridSize?:   number;  // min card width in px (default 160)
  viewMode?:   'grid' | 'list' | 'compact';
  onInfo?:     (album: Album) => void;
}

const SkeletonCard: React.FC = () => (
  <div className="album-card skeleton-card" aria-hidden="true">
    <div className="album-cover skeleton" />
    <div className="album-info">
      <div className="skeleton skeleton-text" style={{ width: '80%' }} />
      <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      <div className="skeleton skeleton-text" style={{ width: '40%' }} />
    </div>
  </div>
);

// ── List-mode row: same selection + link behavior as the grid card ──────────

const AlbumRow: React.FC<{ album: Album; selected: boolean; onSelect: (id: string) => void }> = ({
  album, selected, onSelect,
}) => {
  const [imgSrc,   setImgSrc]   = useState('');
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (album.image_path) {
      resolveImageSrc(album.image_path).then((src) => { if (!cancelled) setImgSrc(src); });
    } else if (album.image_url) {
      setImgSrc(album.image_url);
    }
    return () => { cancelled = true; };
  }, [album.image_path, album.image_url]);

  const handleSelect = useCallback(() => onSelect(album.id), [onSelect, album.id]);
  const href = spotifyAlbumUrl(album);
  const type = album.album_type && album.album_type !== 'album' ? album.album_type : '';

  return (
    <div
      className={'album-row' + (selected ? ' album-row--selected' : '')}
      role="checkbox"
      aria-checked={selected}
      aria-label={(selected ? 'Deselect ' : 'Select ') + album.title}
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(); } }}
    >
      <span className={'album-row-check' + (selected ? ' checked' : '')} aria-hidden="true">
        {selected ? '\u2713' : ''}
      </span>
      <span className="album-row-cover">
        {imgSrc && !imgError
          ? <Artwork src={imgSrc} alt="" loading="lazy" decoding="async" onError={() => setImgError(true)} />
          : <span className="album-row-cover-ph" aria-hidden="true" />}
      </span>
      <span className="album-row-main">
        <span className="album-row-title">{album.title}</span>
        <span className="album-row-artist">{album.artist}</span>
      </span>
      <span className="album-row-year">{album.year > 0 ? album.year : ''}</span>
      <span className="album-row-genre" title={album.genre}>{album.genre}</span>
      <span className="album-row-type">{type}</span>
      <span className="album-row-pop">{typeof album.popularity === 'number' ? '\u2605 ' + album.popularity : ''}</span>
      {href && (
        <a className="album-row-link" href={href} target="_blank" rel="noopener noreferrer"
           onClick={(e) => e.stopPropagation()}
           aria-label={'Open ' + album.title + ' on Spotify'} title="Open on Spotify">
          {'\u2197'}
        </a>
      )}
    </div>
  );
};

export const AlbumGrid: React.FC<Props> = React.memo(({
  albums, loading, loadingMore, hasMore,
  selected, onSelect, allSelected, onToggleAll, onLoadMore,
  gridSize = 160, viewMode = 'grid', onInfo,
}) => {
  const sentinelRef  = useRef<HTMLDivElement>(null);
  const loadMoreRef  = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `repeat(auto-fill, minmax(min(${gridSize}px, 100%), 1fr))`,
  };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreRef.current(); },
      { rootMargin: '400px' }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMore, loading]);

  if (loading) {
    return (
      <div className="album-grid" style={gridStyle} aria-busy="true">
        {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  return (
    <>
      {albums.length > 0 && (
        <div className="select-all-bar">
          <button className="select-all-btn" onClick={onToggleAll}>
            <span className={'select-all-box ' + (allSelected ? 'checked' : '')}>
              {allSelected && (
                <svg viewBox="0 0 12 12" fill="none" width="10" height="10" aria-hidden="true">
                  <path d="M2 6l3 3 5-6" stroke="#000" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            {allSelected ? 'Deselect all' : 'Select all (' + albums.length + ')'}
          </button>
          {selected.size > 0 && (
            <span className="select-count">{selected.size} selected</span>
          )}
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="album-list">
          {albums.map((album) => (
            <AlbumRow
              key={album.id}
              album={album}
              selected={selected.has(album.id)}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <div
          className={'album-grid' + (viewMode === 'compact' ? ' album-grid--compact' : '')}
          style={viewMode === 'compact'
            ? undefined
            : { gridTemplateColumns: `repeat(auto-fill, minmax(min(${gridSize}px, 100%), 1fr))` }}
        >
          {albums.map((album) => (
            <div key={album.id} className="album-card-shell">
              <AlbumCard
                album={album}
                selected={selected.has(album.id)}
                onSelect={onSelect}
              />
              {onInfo && (
                <button
                  type="button"
                  className="album-tracklist-btn"
                  onClick={(e) => { e.stopPropagation(); onInfo(album); }}
                  aria-label={'Show tracks for ' + album.title}
                >
                  Tracks
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="load-sentinel" aria-hidden="true" />
      )}

      {loadingMore && (
        <div className="album-grid load-more-grid" style={gridStyle} aria-busy="true" aria-label="Loading more albums">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}
    </>
  );
}, (prev, next) =>
  prev.loading     === next.loading     &&
  prev.loadingMore === next.loadingMore &&
  prev.hasMore     === next.hasMore     &&
  prev.allSelected === next.allSelected &&
  prev.gridSize    === next.gridSize    &&
  prev.viewMode    === next.viewMode    &&
  prev.albums      === next.albums      &&
  prev.selected    === next.selected    &&
  prev.onSelect    === next.onSelect    &&
  prev.onToggleAll === next.onToggleAll &&
  prev.onLoadMore  === next.onLoadMore
);
AlbumGrid.displayName = 'AlbumGrid';
