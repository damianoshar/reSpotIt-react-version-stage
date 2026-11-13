import React, { useEffect, useRef, useState } from 'react';
import type { AlbumTopTrack } from '../services/topTracks';

/**
 * "Also add the most popular track of each album".
 *
 * An option of the album flows ("Add from site", "Scan page with AI"). The
 * most popular track of every selected album is resolved read-only, shown to
 * the user, and added to a playlist the user names or picks — only after the
 * user pressed the button (UI policy P9).
 */
export interface AlbumTopTracksSectionProps {
  /** The albums the top tracks are resolved for. */
  albumIds: string[];
  /** Resolve the most popular track of each album (read-only). */
  resolveTopTracks: (albumIds: string[]) => Promise<AlbumTopTrack[]>;
  /** Add the chosen tracks to a playlist the user already has. */
  addToPlaylist: (playlistId: string, tracks: AlbumTopTrack[]) => Promise<number>;
  /** Create a playlist with the name the user typed and add the tracks. */
  createPlaylist: (
    name: string,
    tracks: AlbumTopTrack[],
  ) => Promise<{ id: string; name: string; tracksAdded: number }>;
  /** The user's playlists, for the "pick one you have" list. */
  listPlaylists: () => Promise<{ id: string; name: string }[]>;
  /** Report the result of the last add. */
  onMessage?: (message: string) => void;
  /** Disable the section (e.g. while another write is running). */
  disabled?: boolean;
}

export const AlbumTopTracksSection: React.FC<AlbumTopTracksSectionProps> = ({
  albumIds, resolveTopTracks, addToPlaylist, createPlaylist, listPlaylists,
  onMessage, disabled,
}) => {
  const [enabled, setEnabled] = useState(false);
  const [tracks, setTracks] = useState<AlbumTopTrack[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [playlistTarget, setPlaylistTarget] = useState('');
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);

  // The resolver comes from the parent; keep it in a ref so a new function
  // identity does not restart the lookup.
  const resolveRef = useRef(resolveTopTracks);
  resolveRef.current = resolveTopTracks;

  const albumKey = (albumIds ?? []).join(',');

  useEffect(() => {
    if (!enabled || !albumKey) {
      setTracks([]);
      setSelected(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const found = await resolveRef.current(albumKey.split(','));
        if (cancelled) return;
        setTracks(found);
        setSelected(new Set(found.map((t) => t.spotify_id)));
      } catch (e: any) {
        if (cancelled) return;
        setTracks([]);
        setSelected(new Set());
        setError(e?.message ?? 'Could not find the most popular tracks.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, albumKey]);

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const loadPlaylists = async () => {
    setPlaylistsLoading(true);
    try {
      setPlaylists(await listPlaylists());
    } catch (e: any) {
      setError(e?.message ?? 'Could not load playlists.');
    } finally {
      setPlaylistsLoading(false);
    }
  };

  const add = async () => {
    const chosen = tracks.filter((t) => selected.has(t.spotify_id));
    if (!chosen.length) return;
    const existing = playlistTarget;
    const newName = playlistName.trim();
    if (!existing && !newName) {
      setError('Name the new playlist, or pick one of your playlists.');
      return;
    }
    setAdding(true);
    setError('');
    try {
      if (existing) {
        const added = await addToPlaylist(existing, chosen);
        const name = playlists.find((p) => p.id === existing)?.name ?? 'playlist';
        onMessage?.(`Added ${chosen.length} most popular track(s) to “${name}” (${added} tracks).`);
      } else {
        const res = await createPlaylist(newName, chosen);
        onMessage?.(`Created playlist “${res.name || newName}” with ${res.tracksAdded} most popular track(s).`);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not add the most popular tracks.');
    } finally {
      setAdding(false);
    }
  };

  const chosenCount = tracks.filter((t) => selected.has(t.spotify_id)).length;

  return (
    <div className="add-from-site-playlist">
      <label className="add-from-site-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          disabled={disabled || adding || !albumIds.length}
        />
        <div>
          <div className="add-from-site-title">Also add the most popular track of each album</div>
          <div className="add-from-site-meta">
            Every selected album contributes its single most popular track, to a playlist you choose.
          </div>
        </div>
      </label>

      {enabled && (
        <>
          {loading && <p className="queue-help">Looking for the most popular tracks…</p>}
          {error && <div className="sync-error" role="alert">{error}</div>}

          {tracks.length > 0 && (
            <ul className="list-card-list add-from-site-list">
              {tracks.map((track) => (
                <li key={track.spotify_id} className="list-card">
                  <label className="list-card__check">
                    <input
                      type="checkbox"
                      checked={selected.has(track.spotify_id)}
                      onChange={() => toggle(track.spotify_id)}
                    />
                    {track.album_image_url && <img src={track.album_image_url} alt="" className="album-thumb" />}
                  </label>
                  <span className="list-card__main">
                    <span className="list-card__title">{track.name}</span>
                    <span className="list-card__meta">
                      {[track.artist_names, track.album_name, `popularity ${track.popularity}`]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!loading && !error && tracks.length === 0 && (
            <p className="queue-help">No tracks were found for the selected albums.</p>
          )}

          <div className="add-from-site-playlist-row">
            <input
              className="form-input"
              placeholder="New playlist name"
              value={playlistName}
              onChange={(event) => setPlaylistName(event.target.value)}
              disabled={adding || !!playlistTarget}
              aria-label="Name of the new playlist for the most popular tracks"
            />
            <select
              className="search-input"
              value={playlistTarget}
              onChange={(event) => setPlaylistTarget(event.target.value)}
              disabled={adding || playlistsLoading}
              aria-label="Existing playlist for the most popular tracks"
              onFocus={() => { if (!playlists.length) void loadPlaylists(); }}
            >
              <option value="">Create a new playlist</option>
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <p className="queue-help">
            Type a name to create a playlist, or pick one of your playlists.
          </p>

          <div className="add-from-site-actions">
            <button
              type="button"
              className="sync-btn"
              disabled={adding || !chosenCount || (!playlistTarget && !playlistName.trim())}
              onClick={() => void add()}
            >
              {adding ? 'Adding…' : `Add top tracks (${chosenCount})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
