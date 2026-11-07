import { Artwork } from './Artwork';
import React, { useEffect, useMemo, useState } from 'react';
import { Album } from '../types';
import { PlaylistAlbum } from '../services/SpotifyPlaylistFeedService';
import {
  SpotifyPlaylist,
  getUserPlaylists,
  addTrackUrisToPlaylist,
  getPlaylistPlaybackTracks,
  type PlaylistPlaybackTrack,
} from '../services/SpotifyPlaylistService';
import { SPOTIFY_API_URL } from '../config/spotify';
import { getValidAccessToken } from '../services/SpotifyAuthService';
import { playWithWebPlaybackSdk, playContextWithWebPlaybackSdk } from '../services/WebPlaybackSdkService';
import { apiFetch } from '../services/remote/apiClient';
import { spotifyAlbumUrl } from '../utils/spotifyLinks';
import type { LocalPlaybackTrack } from '../services/librespotPlayer';
import {
  findPlaylistIndexForAlbum,
  findPlaylistIndexForTrack,
  toLocalPlaylistTracks,
} from '../utils/playlistPlayback';

type AnyAlbum = Album | PlaylistAlbum;

interface Track {
  id:         string;
  title:      string;
  artists:    string;
  number:     number;
  disc:       number;
  durationMs: number;
  uri:        string;
}

interface Props {
  album:          AnyAlbum;
  isRemote:       boolean;
  serverUrl:      string;
  playlistId?:    string;
  localPlaybackAvailable?: boolean;
  localPlaybackEnabled?: boolean;
  onPlayLocally?:        (tracks: LocalPlaybackTrack[], startIndex: number) => void;
  onQueueNextLocally?:   (track: LocalPlaybackTrack) => void;
  onQueueEndLocally?:    (track: LocalPlaybackTrack) => void;
  onQueueAlbumNextLocally?: (tracks: LocalPlaybackTrack[]) => void;
  hasLocalQueue?: boolean;
  localQueueBusy?: boolean;
  activeQueueBusy?: boolean;
  queuePlaylistBusy?: boolean;
  onLocalQueueCreate?: () => void;
  onLocalQueueAdd?: () => void;
  onLocalQueueNext?: () => void;
  onLocalQueueReset?: () => void;
  onLocalQueueTrack?: (uri: string) => void;
  onRemoveAlbum?: () => void;
  onClose:        () => void;
}

function msToTime(ms: number): string {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

export const AlbumTrackSheet: React.FC<Props> = ({
  album,
  isRemote,
  serverUrl,
  playlistId,
  localPlaybackAvailable = false,
  localPlaybackEnabled = false,
  onPlayLocally,
  onQueueNextLocally,
  onQueueEndLocally,
  onQueueAlbumNextLocally,
  hasLocalQueue = false,
  localQueueBusy = false,
  activeQueueBusy = false,
  queuePlaylistBusy = false,
  onLocalQueueCreate,
  onLocalQueueAdd,
  onLocalQueueNext,
  onLocalQueueReset,
  onLocalQueueTrack,
  onRemoveAlbum,
  onClose,
}) => {
  const [tracks,      setTracks]      = useState<Track[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [busy,        setBusy]        = useState('');
  const [webPlaying,  setWebPlaying]  = useState(false);
  const [status,      setStatus]      = useState('');
  const [playlists,   setPlaylists]   = useState<SpotifyPlaylist[]>([]);
  const [plLoading,    setPlLoading]    = useState(false);
  const [selPlaylist, setSelPlaylist] = useState('');
  const [showPl,      setShowPl]      = useState(false);
  const [plStatus,    setPlStatus]    = useState('');
  const [playlistTracks, setPlaylistTracks] = useState<PlaylistPlaybackTrack[]>([]);
  const [playlistOrderLoading, setPlaylistOrderLoading] = useState(false);
  const [playlistOrderError, setPlaylistOrderError] = useState('');

  const title    = 'title' in album ? (album as any).title : '';
  const artist   = 'artist' in album ? (album as any).artist : '';
  const year     = 'year' in album ? (album as any).year : 0;
  const imageUrl = 'image_url' in album ? (album as any).image_url : '';
  const albumId  = album.id;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        let raw: any[] = [];
        if (isRemote) {
          try {
            const data = await apiFetch<{ items?: any[]; tracks?: any[] }>(
              serverUrl, '/api/v1/albums/' + encodeURIComponent(albumId) + '/tracks'
            );
            raw = (data && (data.items || data.tracks)) || [];
          } catch (e: any) {
            if (typeof e?.status === 'number') {
              throw new Error('Could not load tracks (' + e.status + ').');
            }
            throw e;
          }
        } else {
          const token = await getValidAccessToken();
          if (!token) throw new Error('Spotify is not connected on this device.');
          const res = await fetch(SPOTIFY_API_URL + '/albums/' + encodeURIComponent(albumId) + '/tracks?limit=50', {
            headers: { Authorization: 'Bearer ' + token },
          });
          if (!res.ok) throw new Error('Could not load tracks (' + res.status + ').');
          const data = await res.json();
          raw = data.items || [];
        }
        if (cancelled) return;
        setTracks(raw.map((t: any) => ({
          id:         t.id || t.spotify_id || '',
          title:      t.name || t.title || '',
          artists:    t.artist_names || (Array.isArray(t.artists) ? t.artists.map((a: any) => a.name).join(', ') : t.artist || artist),
          number:     t.track_number || t.trackNumber || 0,
          disc:       t.disc_number || 0,
          durationMs: t.duration_ms || t.durationMs || 0,
          uri:        t.uri || '',
        })));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Could not load tracks.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [albumId, isRemote, serverUrl]);

  // Playlist order is the local queue when this sheet was opened from the
  // playlist album grid. It is only needed while on-device playback is on.
  useEffect(() => {
    if (!playlistId || !localPlaybackAvailable || !localPlaybackEnabled) {
      setPlaylistTracks([]);
      setPlaylistOrderError('');
      setPlaylistOrderLoading(false);
      return;
    }
    let cancelled = false;
    setPlaylistOrderLoading(true);
    setPlaylistOrderError('');
    getPlaylistPlaybackTracks(playlistId)
      .then((items) => {
        if (!cancelled) setPlaylistTracks(items);
      })
      .catch((e: any) => {
        if (!cancelled) {
          setPlaylistTracks([]);
          setPlaylistOrderError(e?.message ?? 'Could not read playlist order.');
        }
      })
      .finally(() => {
        if (!cancelled) setPlaylistOrderLoading(false);
      });
    return () => { cancelled = true; };
  }, [playlistId, localPlaybackAvailable, localPlaybackEnabled]);

  const playlistAlbumIndex = useMemo(
    () => (playlistId && playlistTracks.length
      ? findPlaylistIndexForAlbum(playlistTracks, albumId)
      : -1),
    [playlistId, playlistTracks, albumId],
  );

  const playlistPositions = useMemo(() => {
    const positions = new Map<string, number>();
    for (const item of playlistTracks) {
      if (!positions.has(item.uri)) positions.set(item.uri, item.playlistPosition);
    }
    return positions;
  }, [playlistTracks]);

  const queueBusy = !!busy || localQueueBusy || activeQueueBusy || queuePlaylistBusy;
  const canUseLocalQueue = hasLocalQueue && !queueBusy;

  const handleLocalQueueCreate = () => {
    if (!onLocalQueueCreate) return;
    setStatus('');
    onLocalQueueCreate();
  };

  const handleLocalQueueAdd = () => {
    if (!onLocalQueueAdd) return;
    if (!hasLocalQueue) { setStatus('Create a local queue playlist first.'); return; }
    setStatus('');
    onLocalQueueAdd();
  };

  const handleLocalQueueNext = () => {
    if (!onLocalQueueNext) return;
    if (!hasLocalQueue) { setStatus('Create a local queue playlist first.'); return; }
    setStatus('');
    onLocalQueueNext();
  };

  const handleLocalQueueReset = () => {
    if (!onLocalQueueReset) return;
    if (!hasLocalQueue) { setStatus('There is no local queue playlist to reset.'); return; }
    setStatus('');
    onLocalQueueReset();
  };

  const handleLocalQueueTrack = (t: Track) => {
    if (!onLocalQueueTrack) return;
    if (!hasLocalQueue) { setStatus('Create a local queue playlist first.'); return; }
    const uri = t.uri || (t.id ? 'spotify:track:' + t.id : '');
    if (!uri) return;
    setStatus('');
    onLocalQueueTrack(uri);
  };

  const toLocalTracks = (): LocalPlaybackTrack[] => tracks
    .map((t) => ({
      uri:        t.uri || (t.id ? 'spotify:track:' + t.id : ''),
      title:      t.title,
      artist:     t.artists,
      durationMs: t.durationMs,
      artUrl:     imageUrl || null,
    }))
    .filter((t) => !!t.uri);

  const handlePlayAlbumLocally = () => {
    const localTracks = toLocalTracks();
    if (!localTracks.length) { setStatus('No playable tracks found.'); return; }
    if (playlistId && playlistOrderLoading) {
      setStatus('Reading playlist order…');
      return;
    }
    if (playlistAlbumIndex >= 0) {
      onPlayLocally?.(toLocalPlaylistTracks(playlistTracks), playlistAlbumIndex);
      const position = playlistTracks[playlistAlbumIndex].playlistPosition + 1;
      setStatus('Starting from playlist position ' + position + '…');
      return;
    }
    onPlayLocally?.(localTracks, 0);
    setStatus(playlistId
      ? 'Album is not in this playlist; starting with album order…'
      : 'Starting local playback…');
  };

  const handleQueueTrackLocally = (t: Track, next: boolean) => {
    const localTracks = toLocalTracks();
    const uri = t.uri || (t.id ? 'spotify:track:' + t.id : '');
    const localTrack = localTracks.find((item) => item.uri === uri);
    if (!localTrack) { setStatus('No playable track found.'); return; }
    if (next) onQueueNextLocally?.(localTrack); else onQueueEndLocally?.(localTrack);
    setStatus(next ? 'Queued next: “' + t.title + '”' : 'Added to queue: “' + t.title + '”');
  };

  const handleQueueAlbumNextLocally = () => {
    const localTracks = toLocalTracks();
    if (!localTracks.length) { setStatus('No playable tracks found.'); return; }
    onQueueAlbumNextLocally?.(localTracks);
    setStatus('Queued album after the current track…');
  };

  const handlePlayTrackLocally = (t: Track) => {
    const localTracks = toLocalTracks();
    const uri = t.uri || (t.id ? 'spotify:track:' + t.id : '');
    if (playlistId && playlistOrderLoading) {
      setStatus('Reading playlist order…');
      return;
    }
    if (playlistId && playlistTracks.length) {
      const playlistIndex = findPlaylistIndexForTrack(playlistTracks, uri);
      if (playlistIndex >= 0) {
        onPlayLocally?.(toLocalPlaylistTracks(playlistTracks), playlistIndex);
        const position = playlistTracks[playlistIndex].playlistPosition + 1;
        setStatus('Starting “' + t.title + '” at playlist position ' + position + '…');
        return;
      }
      if (playlistAlbumIndex >= 0) {
        onPlayLocally?.(toLocalPlaylistTracks(playlistTracks), playlistAlbumIndex);
        const position = playlistTracks[playlistAlbumIndex].playlistPosition + 1;
        setStatus('Track is not in the playlist; starting at the album’s position ' + position + '…');
        return;
      }
    }
    const index = localTracks.findIndex((item) => item.uri === uri);
    if (index < 0) { setStatus('No playable track found.'); return; }
    onPlayLocally?.(localTracks, index);
    setStatus('Starting “' + t.title + '”…');
  };

  const getWebPlaybackToken = async (): Promise<string> => {
    const token = await getValidAccessToken();
    if (!token) throw new Error('Connect Spotify on this device first.');
    return token;
  };

  const handlePlayAlbumWeb = async () => {
    const uris = tracks.map((t) => t.uri || (t.id ? 'spotify:track:' + t.id : '')).filter(Boolean);
    if (!uris.length) { setStatus('No playable track URIs for this album.'); return; }
    setWebPlaying(true);
    setStatus('');
    try {
      await playWithWebPlaybackSdk(uris, getWebPlaybackToken);
      setStatus('Playing ' + uris.length + ' track' + (uris.length === 1 ? '' : 's') + '.');
    } catch (e: any) {
      setStatus(e?.message ?? 'Playback failed.');
    } finally {
      setWebPlaying(false);
    }
  };

  const handlePlayTrackWeb = async (t: Track, index: number) => {
    const uri = t.uri || (t.id ? 'spotify:track:' + t.id : '');
    if (!uri) { setStatus('No playable track URI.'); return; }
    setWebPlaying(true);
    setStatus('');
    try {
      await playContextWithWebPlaybackSdk('spotify:album:' + albumId, getWebPlaybackToken, index);
      setStatus('Playing ' + (t.title || 'track') + ' from album position ' + (index + 1) + '.');
    } catch (e: any) {
      setStatus(e?.message ?? 'Playback failed.');
    } finally {
      setWebPlaying(false);
    }
  };

  const handleRemoveTrack = async (t: Track) => {
    if (!playlistId || !t.uri) return;
    setBusy('remove:' + t.uri);
    setStatus('');
    try {
      const token = await getValidAccessToken();
      if (!token) { setStatus('Connect Spotify on this device.'); setBusy(''); return; }
      const res = await fetch(SPOTIFY_API_URL + '/playlists/' + encodeURIComponent(playlistId) + '/tracks', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: [{ uri: t.uri }] }),
      });
      if (!res.ok) throw new Error('Could not remove track (' + res.status + ').');
      setTracks((prev) => prev.filter((x) => x.uri !== t.uri));
      setStatus('Removed "' + t.title + '".');
    } catch (e: any) {
      setStatus(e?.message ?? 'Remove failed.');
    } finally {
      setBusy('');
    }
  };

  const handleRemoveAlbum = async () => {
    if (!playlistId) return;
    setBusy('remove-album');
    setStatus('');
    try {
      const uris = tracks.map((t) => t.uri).filter(Boolean);
      if (isRemote) {
        try {
          await apiFetch(
            serverUrl,
            '/api/v1/playlists/' + encodeURIComponent(playlistId) + '/albums',
            { method: 'DELETE', body: { album_ids: [albumId] } },
          );
        } catch (e: any) {
          if (typeof e?.status === 'number') {
            throw new Error('Could not remove album (' + e.status + ').');
          }
          throw e;
        }
      } else {
        const token = await getValidAccessToken();
        if (!token) throw new Error('Connect Spotify on this device.');
        if (!uris.length) throw new Error('No tracks found for this album.');
        for (let i = 0; i < uris.length; i += 100) {
          const chunk = uris.slice(i, i + 100);
          const res = await fetch(SPOTIFY_API_URL + '/playlists/' + encodeURIComponent(playlistId) + '/tracks', {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: chunk.map((uri) => ({ uri })) }),
          });
          if (!res.ok) throw new Error('Could not remove album (' + res.status + ').');
        }
      }
      setStatus('Removed this album from the playlist.');
    } catch (e: any) {
      setStatus(e?.message ?? 'Remove failed.');
    } finally {
      setBusy('');
    }
  };

  const openPlaylists = async () => {
    setShowPl(true);
    if (playlists.length) return;
    setPlLoading(true);
    try {
      setPlaylists(await getUserPlaylists());
    } catch (e: any) {
      setPlStatus(e?.message ?? 'Could not load playlists.');
    } finally {
      setPlLoading(false);
    }
  };

  const handleAddToPlaylist = async () => {
    if (!selPlaylist) { setPlStatus('Choose a playlist first.'); return; }
    const uris = tracks.map((t) => t.uri).filter(Boolean);
    if (!uris.length) { setPlStatus('No tracks to add.'); return; }
    setPlLoading(true);
    setPlStatus('');
    try {
      await addTrackUrisToPlaylist(selPlaylist, uris);
      const name = playlists.find((p) => p.id === selPlaylist)?.name ?? 'playlist';
      setPlStatus('Added ' + uris.length + ' tracks to ' + name + '.');
      setShowPl(false);
    } catch (e: any) {
      setPlStatus(e?.message ?? 'Could not add tracks.');
    } finally {
      setPlLoading(false);
    }
  };

  const openSpotify = () => {
    const href = spotifyAlbumUrl({ id: albumId } as any);
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={'Tracks for ' + title} onClick={onClose}>
      <div className="modal track-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h2>{title}</h2>
            <p className="modal-description">
              {artist}{year > 0 ? ' \u00b7 ' + year : ''}{tracks.length ? ' \u00b7 ' + tracks.length + ' tracks' : ''}
            </p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">&#x2715;</button>
        </div>
        <div className="modal-body track-sheet-body">
          {imageUrl && (
            <div className="track-sheet-cover-row">
              <div className="track-sheet-cover"><Artwork src={imageUrl} alt="" loading="lazy" decoding="async" /></div>
            </div>
          )}
          <div className="track-sheet-actions">
            {tracks.length > 0 && (
              <button
                type="button"
                className="track-action-btn track-action-primary"
                onClick={() => void handlePlayAlbumWeb()}
                disabled={webPlaying || loading || !tracks.length}
              >
                {webPlaying ? 'Playing…' : 'Play album'}
              </button>
            )}
            {localPlaybackAvailable && localPlaybackEnabled && (
              <button
                type="button"
                className="track-action-btn track-action-local"
                onClick={handlePlayAlbumLocally}
                disabled={loading || !tracks.length || (!!playlistId && playlistOrderLoading)}
                title={playlistAlbumIndex >= 0
                  ? 'Start the local queue at this album’s position in the playlist'
                  : 'Start local playback with this album'}
              >
                {playlistAlbumIndex >= 0 ? 'Play album from playlist position' : 'Play album on this device'}
              </button>
            )}
            {localPlaybackAvailable && localPlaybackEnabled && tracks.length > 0 && (
              <button
                type="button"
                className="track-action-btn track-action-local"
                onClick={handleQueueAlbumNextLocally}
                title="Insert this album after the currently playing track"
              >
                Queue next
              </button>
            )}
            <button type="button" className="track-action-btn" onClick={openPlaylists} disabled={plLoading}>
              {plLoading ? 'Loading\u2026' : 'Add to playlist'}
            </button>
            {playlistId && (
              <button type="button" className="track-action-btn track-action-danger" onClick={handleRemoveAlbum} disabled={busy === 'remove-album'}>
                {busy === 'remove-album' ? 'Removing\u2026' : 'Remove from playlist'}
              </button>
            )}
            <button type="button" className="track-action-btn" onClick={openSpotify}>
              Open on Spotify
            </button>
          </div>

          {playlistId && localPlaybackAvailable && localPlaybackEnabled && (
            <p className="track-sheet-hint">
              {playlistOrderLoading
                ? 'Reading playlist order…'
                : playlistOrderError
                  ? 'Playlist order unavailable; album order will be used.'
                  : playlistTracks.length
                    ? 'Local playback follows this playlist’s track order from the selected position.'
                    : ''}
            </p>
          )}

          {(onLocalQueueCreate || onLocalQueueAdd || onLocalQueueNext || onLocalQueueReset) && (
            <div className="track-sheet-queue">
              <span className="track-sheet-queue-label">Local queue</span>
              <div className="track-sheet-queue-row">
                {onLocalQueueCreate && (
                  <button
                    type="button"
                    className="track-action-btn"
                    onClick={handleLocalQueueCreate}
                    disabled={loading || !tracks.length || queueBusy}
                    title="Create a queue playlist from what is playing now, or replace the current one"
                  >
                    {localQueueBusy ? 'Working\u2026' : hasLocalQueue ? 'New queue playlist' : 'Queue playlist'}
                  </button>
                )}
                {onLocalQueueAdd && (
                  <button
                    type="button"
                    className="track-action-btn"
                    onClick={handleLocalQueueAdd}
                    disabled={loading || !tracks.length || !canUseLocalQueue}
                    title="Append this album to the end of the local queue playlist"
                  >
                    Add album to end
                  </button>
                )}
                {onLocalQueueNext && (
                  <button
                    type="button"
                    className="track-action-btn"
                    onClick={handleLocalQueueNext}
                    disabled={loading || !tracks.length || !canUseLocalQueue}
                    title="Insert this album immediately after the current local queue track"
                  >
                    Queue next
                  </button>
                )}
                {onLocalQueueReset && (
                  <button
                    type="button"
                    className="track-action-btn"
                    onClick={handleLocalQueueReset}
                    disabled={!canUseLocalQueue}
                    title="Rebuild the local queue from the unplayed remainder of the current one"
                  >
                    Reset Queue Playlist
                  </button>
                )}
              </div>
            </div>
          )}

          {showPl && (
            <div className="track-playlist-picker">
              <select className="search-input" value={selPlaylist} onChange={(e) => setSelPlaylist(e.target.value)} disabled={plLoading}>
                <option value="">Choose a playlist&hellip;</option>
                {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" className="track-action-btn" onClick={handleAddToPlaylist} disabled={plLoading || !selPlaylist}>
                {plLoading ? 'Adding\u2026' : 'Add tracks'}
              </button>
              {plStatus && <p className="track-sheet-status">{plStatus}</p>}
            </div>
          )}

          {status && <p className="track-sheet-status">{status}</p>}

          {loading && <div className="empty-state"><p>Loading tracks&hellip;</p></div>}
          {!loading && error && <div className="error-banner" role="alert">&#x26A0; {error}</div>}
          {!loading && !error && tracks.length === 0 && (
            <div className="empty-state"><p>No tracks found.</p></div>
          )}
          {!loading && !error && tracks.length > 0 && (
            <ol className="track-list">
              {tracks.map((t, i) => (
                <li key={t.id || i} className="track-row">
                  <span className="track-number">{t.disc > 1 ? t.disc + '.' : ''}{t.number || i + 1}</span>
                  <span className="track-info">
                    <span className="track-title">{t.title}</span>
                    {t.artists && <span className="track-artist">{t.artists}</span>}
                  </span>
                  <span className="track-duration">{msToTime(t.durationMs)}</span>
                  {playlistId && localPlaybackAvailable && localPlaybackEnabled
                    && playlistPositions.get(t.uri) != null && (
                    <span className="track-playlist-pos" title="Position in this playlist">
                      #{playlistPositions.get(t.uri)! + 1}
                    </span>
                  )}
                  {localPlaybackAvailable && localPlaybackEnabled && t.uri && (
                    <>
                      <button
                        type="button"
                        className="track-row-btn track-row-queue"
                        onClick={() => handleQueueTrackLocally(t, true)}
                        disabled={!!playlistId && playlistOrderLoading}
                        title="Queue next locally"
                        aria-label={'Queue ' + t.title + ' next on this device'}
                      >
                        Next
                      </button>
                      <button
                        type="button"
                        className="track-row-btn track-row-queue"
                        onClick={() => handleQueueTrackLocally(t, false)}
                        disabled={!!playlistId && playlistOrderLoading}
                        title="Add to end locally"
                        aria-label={'Add ' + t.title + ' to the end on this device'}
                      >
                        +
                      </button>
                    </>
                  )}
                  {(t.uri || t.id) && (
                    <button
                      type="button"
                      className="track-row-btn track-row-play"
                      onClick={() => void handlePlayTrackWeb(t, i)}
                      disabled={webPlaying}
                      aria-label={'Play ' + t.title + ' with Web Playback SDK'}
                    >
                      Play
                    </button>
                  )}
                  {localPlaybackAvailable && localPlaybackEnabled && (
                    <button
                      type="button"
                      className="track-row-btn track-row-play"
                      onClick={() => handlePlayTrackLocally(t)}
                      disabled={!!playlistId && playlistOrderLoading}
                      title={playlistPositions.has(t.uri)
                        ? 'Play from this track’s position in the playlist'
                        : 'Play this track on this device'}
                      aria-label={'Play ' + t.title + ' on this device'}
                    >
                      Play
                    </button>
                  )}
                  {onLocalQueueTrack && (
                    <button
                      type="button"
                      className="track-row-btn"
                      onClick={() => handleLocalQueueTrack(t)}
                      disabled={!canUseLocalQueue || !(t.uri || t.id)}
                      title={hasLocalQueue
                        ? 'Queue this track next in the local queue playlist'
                        : 'Create a local queue playlist first'}
                      aria-label={'Queue ' + t.title + ' next'}
                    >
                      Next
                    </button>
                  )}
                  {playlistId && (
                    <button
                      type="button"
                      className="track-row-btn track-row-danger"
                      onClick={() => handleRemoveTrack(t)}
                      disabled={busy === 'remove:' + t.uri}
                      aria-label={'Remove ' + t.title}
                    >
                      {busy === 'remove:' + t.uri ? '\u2026' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
};
