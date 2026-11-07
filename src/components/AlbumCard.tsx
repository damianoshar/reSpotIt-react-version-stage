import React, { useEffect, useState, useCallback } from 'react';
import { Album } from '../types';
import { resolveImageSrc } from '../services/SyncService';
import { getValidAccessToken } from '../services/SpotifyAuthService';
import { playContextWithWebPlaybackSdk } from '../services/WebPlaybackSdkService';
import { spotifyAlbumUrl } from '../utils/spotifyLinks';

interface Props {
  album:    Album;
  selected: boolean;
  onSelect: (id: string) => void;
  badge?:   string; // optional overlay label, e.g. "3 tracks"
  onInfo?:  (album: Album) => void;
}

const AlbumCardInner: React.FC<Props> = ({ album, selected, onSelect, badge, onInfo }) => {
  const [imgSrc,   setImgSrc]   = useState('');
  const [imgError, setImgError] = useState(false);
  const [playing,  setPlaying]  = useState(false);

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
  const showPlaceholder = !imgSrc || imgError;
  const spotifyHref = spotifyAlbumUrl(album);
  const albumContextUri = album.id ? 'spotify:album:' + album.id : '';

  const handlePlayAlbum = async () => {
    if (!albumContextUri) return;
    setPlaying(true);
    try {
      await playContextWithWebPlaybackSdk(albumContextUri, async () => {
        const token = await getValidAccessToken();
        if (!token) throw new Error('Connect Spotify on this device first.');
        return token;
      });
    } catch {
      // Keep the card usable even if playback cannot start.
    } finally {
      setPlaying(false);
    }
  };

  return (
    <article
      className={'album-card ' + (selected ? 'album-card--selected' : '')}
      aria-label={album.title + ' by ' + album.artist}
      aria-selected={selected}
      onClick={handleSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(); } }}
    >
      <button
        className="album-checkbox"
        onClick={(e) => { e.stopPropagation(); handleSelect(); }}
        aria-label={(selected ? 'Deselect ' : 'Select ') + album.title}
        aria-checked={selected}
        role="checkbox"
      >
        {selected ? (
          <svg viewBox="0 0 20 20" fill="none" width="18" height="18" aria-hidden="true">
            <circle cx="10" cy="10" r="9" fill="var(--accent)" />
            <path d="M6 10l3 3 5-6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" width="18" height="18" aria-hidden="true">
            <circle cx="10" cy="10" r="9" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" fill="rgba(0,0,0,0.3)"/>
          </svg>
        )}
      </button>

      <div className="album-cover">
        {showPlaceholder ? (
          <div className="album-placeholder" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
              <circle cx="24" cy="24" r="22" stroke="#535353" strokeWidth="2" />
              <circle cx="24" cy="24" r="8"  fill="#535353" />
              <circle cx="24" cy="24" r="3"  fill="#121212" />
            </svg>
          </div>
        ) : (
          <img
            src={imgSrc}
            alt={album.title + ' cover'}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        )}
        {/* Track count badge (playlist mode) */}
        {badge && <span className="album-card-badge">{badge}</span>}
        {/* Play album */}
        {albumContextUri && (
          <button
            type="button"
            className="album-spotify-link"
            onClick={(e) => { e.stopPropagation(); void handlePlayAlbum(); }}
            disabled={playing}
            aria-label={'Play ' + album.title + ' on this device'}
            title="Play album"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {playing ? '…' : '▶'}
          </button>
        )}
        {/* Open on Spotify */}
        {spotifyHref && (
          <a
            className="album-spotify-link"
            href={spotifyHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={'Open ' + album.title + ' on Spotify'}
            title="Open on Spotify"
          >
            {'\u2197'}
          </a>
        )}
      </div>

      <div className="album-info">
        <p className="album-title">{album.title}</p>
        <p className="album-artist">{album.artist}</p>
        <p className="album-meta">
          {album.year > 0 ? album.year : ''}
          {album.genre ? ' · ' + album.genre : ''}
        </p>
      </div>
    </article>
  );
};

export const AlbumCard: React.FC<Props> = AlbumCardInner;
AlbumCard.displayName = 'AlbumCard';
