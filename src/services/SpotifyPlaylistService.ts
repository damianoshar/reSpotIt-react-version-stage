import { getValidAccessToken } from './SpotifyAuthService';
import { spotifyFetch, sleep } from '../utils/spotifyFetch';
import { SPOTIFY_API_URL } from '../config/spotify';
import { Album, Queueable } from '../types';

// ---------------------------------------------------------------------------
// Types  (only fields we actually use — YAGNI)
// ---------------------------------------------------------------------------

export interface SpotifyPlaylist {
  id:     string;
  name:   string;
  images: { url: string }[];
  tracks: { total: number };
  owner:  { id: string };
  /** Present on live Spotify/remote payloads; older cached rows may omit it. */
  public?:     boolean;
  /** Position in the user's "added" order (0 = most recently added). */
  addedOrder?: number;
}

export interface PlaylistAccess {
  name:     string;
  editable: boolean;
}

export interface QueueResult {
  success: number;
  failed:  number;
  error?:  string;
}

/** One playable item in playlist order, including its real playlist position. */
export interface PlaylistPlaybackTrack {
  uri:              string;
  title:            string;
  artist:           string;
  durationMs:       number;
  artUrl:           string | null;
  albumId:          string;
  /** Zero-based position in the playlist (unavailable items still count). */
  playlistPosition: number;
}

interface RawPlaylistPlaybackTrack {
  uri?:        string;
  name?:       string;
  duration_ms?: number;
  artists?:    { name?: string }[];
  album?:      { id?: string; images?: { url?: string; width?: number }[] };
}

interface RawPlaylistPlaybackItem {
  track: RawPlaylistPlaybackTrack | null;
}

// ---------------------------------------------------------------------------
// User identity  (cached for session to avoid repeated /me calls causing
// empty playlist lists when the extra fetch races or fails)
// ---------------------------------------------------------------------------

let _cachedUserId: string | null = null;

export async function getUserId(): Promise<string> {
  if (_cachedUserId) return _cachedUserId;
  const token = await getValidAccessToken();
  const { id } = await spotifyFetch<{ id: string }>(`${SPOTIFY_API_URL}/me`, token);
  _cachedUserId = id;
  return id;
}

/** Call on logout alongside clearTokens() */
export function clearUserIdCache(): void {
  _cachedUserId = null;
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

export async function getUserPlaylists(): Promise<SpotifyPlaylist[]> {
  const token  = await getValidAccessToken();
  const userId = await getUserId();
  const all:   SpotifyPlaylist[] = [];
  let url: string | null = `${SPOTIFY_API_URL}/me/playlists?limit=50`;
  let addedOrder = 0;

  while (url) {
    const page: { items: SpotifyPlaylist[]; next: string | null } =
      await spotifyFetch<{ items: SpotifyPlaylist[]; next: string | null }>(url, token);
    for (const playlist of page.items) {
      if (playlist.owner?.id !== userId) continue;
      all.push({ ...playlist, addedOrder: addedOrder++ });
    }
    url = page.next;
  }

  return all;
}

export async function createPlaylist(name: string): Promise<SpotifyPlaylist> {
  const token  = await getValidAccessToken();
  const userId = await getUserId();

  const res = await fetch(`${SPOTIFY_API_URL}/users/${userId}/playlists`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name, public: false }),
  });
  if (!res.ok) throw new Error('Failed to create playlist. Please try again.');
  return res.json() as Promise<SpotifyPlaylist>;
}

/** Create a private playlist from direct track/episode URIs (queue snapshot). */
export async function createPlaylistWithUris(
  name: string,
  uris: string[],
): Promise<SpotifyPlaylist> {
  const playlist = await createPlaylist(name);
  if (uris.length > 0) await addTrackUrisToPlaylist(playlist.id, uris);
  return playlist;
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export async function getAlbumTrackUris(albumId: string): Promise<string[]> {
  const token = await getValidAccessToken();
  const uris: string[] = [];
  let url: string | null = `${SPOTIFY_API_URL}/albums/${albumId}/tracks?limit=50`;

  while (url) {
    const page: { items: { uri: string }[]; next: string | null } =
      await spotifyFetch<{ items: { uri: string }[]; next: string | null }>(url, token);
    uris.push(...page.items.map((t) => t.uri));
    url = page.next;
  }
  return uris;
}

/**
 * Append track/episode URIs to a playlist, in chunks of 100. Uses Spotify's
 * current `/items` route and falls back to the deprecated `/tracks` route for
 * older deployments.
 */
export async function addTrackUrisToPlaylist(
  playlistId: string,
  uris: string[],
): Promise<number> {
  return insertTrackUrisToPlaylist(playlistId, uris, null);
}

/**
 * Insert track/episode URIs at a zero-based playlist position. Chunks are
 * placed one after another so a >100-track selection keeps its order.
 */
export async function insertTrackUrisToPlaylist(
  playlistId: string,
  uris: string[],
  position: number | null,
): Promise<number> {
  if (uris.length === 0) return 0;
  const token = await getValidAccessToken();
  let added = 0;
  let insertAt = position == null ? null : Math.max(0, position);

  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    const body: Record<string, unknown> = { uris: chunk };
    if (insertAt != null) body.position = insertAt;

    let res = await fetch(`${SPOTIFY_API_URL}/playlists/${playlistId}/items`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (res.status === 404 || res.status === 405) {
      res = await fetch(`${SPOTIFY_API_URL}/playlists/${playlistId}/tracks`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
    }
    if (!res.ok) throw new Error('Failed to add tracks to playlist. Please try again.');
    added += chunk.length;
    if (insertAt != null) insertAt += chunk.length;
    await sleep(60);
  }
  return added;
}

/** Read every track/episode URI in a playlist, in order. */
export async function getPlaylistTrackUris(playlistId: string): Promise<string[]> {
  const token = await getValidAccessToken();
  const uris: string[] = [];
  let url: string | null =
    `${SPOTIFY_API_URL}/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100&fields=items(track(uri)),next`;

  while (url) {
    const page: { items: { track: { uri?: string } | null }[]; next: string | null } =
      await spotifyFetch<{ items: { track: { uri?: string } | null }[]; next: string | null }>(url, token);
    for (const item of page.items) {
      const uri = item.track?.uri?.trim();
      if (uri) uris.push(uri);
    }
    url = page.next;
    if (url) await sleep(60);
  }
  return uris;
}

/**
 * Read the playlist in order with enough metadata for the on-device player.
 * This is what makes "play from the playlist position" possible: the returned
 * array is the local queue, and `playlistPosition` is the item's real position
 * (unavailable/local tracks still advance it).
 */
export async function getPlaylistPlaybackTracks(
  playlistId: string,
): Promise<PlaylistPlaybackTrack[]> {
  const token = await getValidAccessToken();
  const tracks: PlaylistPlaybackTrack[] = [];
  let url: string | null =
    `${SPOTIFY_API_URL}/playlists/${encodeURIComponent(playlistId)}/tracks` +
    `?limit=100&fields=items(track(uri,name,duration_ms,artists(name),album(id,images(url,width)))),next`;
  let position = 0;

  while (url) {
    const page: { items: RawPlaylistPlaybackItem[]; next: string | null } =
      await spotifyFetch<{ items: RawPlaylistPlaybackItem[]; next: string | null }>(url, token);

    for (const item of page.items) {
      const track = item.track;
      const uri = track?.uri?.trim();
      const albumId = track?.album?.id;
      if (track && uri && albumId) {
        const images = track.album?.images ?? [];
        const artUrl = [...images]
          .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
          .find((image) => !!image.url)?.url ?? null;
        tracks.push({
          uri,
          title:            track.name ?? '',
          artist:           (track.artists ?? []).map((artist) => artist.name ?? '').filter(Boolean).join(', '),
          durationMs:       track.duration_ms ?? 0,
          artUrl,
          albumId,
          playlistPosition: position,
        });
      }
      position++;
    }

    url = page.next;
    if (url) await sleep(60);
  }

  return tracks;
}

/**
 * Resolve the name of a playlist and whether this Spotify account can edit it.
 * Spotify has no "editable" flag; ownership or collaboration is the same rule
 * the API enforces for playlist writes.
 */
export async function getPlaylistAccess(playlistId: string): Promise<PlaylistAccess> {
  const token = await getValidAccessToken();
  const [details, userId] = await Promise.all([
    spotifyFetch<{ name?: string; collaborative?: boolean; owner?: { id?: string } }>(
      `${SPOTIFY_API_URL}/playlists/${encodeURIComponent(playlistId)}?fields=name,collaborative,owner(id)`,
      token,
    ),
    getUserId(),
  ]);
  return {
    name:     details.name ?? '',
    editable: details.collaborative === true || details.owner?.id === userId,
  };
}

/** Spotify has no hard delete: "delete" means unfollow. */
export async function unfollowPlaylist(playlistId: string): Promise<void> {
  const token = await getValidAccessToken();
  const res = await fetch(
    `${SPOTIFY_API_URL}/playlists/${encodeURIComponent(playlistId)}/followers`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error('Spotify could not remove the queue playlist.');
}

// ---------------------------------------------------------------------------
// Composed operations  (used by UI)
// ---------------------------------------------------------------------------

export async function addAlbumsToPlaylist(
  albums:     Album[],
  playlistId: string
): Promise<{ tracksAdded: number }> {
  const uris: string[] = [];
  for (const album of albums) {
    uris.push(...await getAlbumTrackUris(album.id));
  }
  await addTrackUrisToPlaylist(playlistId, uris);
  return { tracksAdded: uris.length };
}

/**
 * Create a private playlist and add every track from the selected albums.
 * Progress is reported per album so the discography picker can show which
 * release is being resolved on large selections.
 */
export async function createPlaylistFromAlbums(
  name: string,
  albums: Album[],
  onProgress?: (done: number, total: number, album: Album) => void,
): Promise<{ playlist: SpotifyPlaylist; tracksAdded: number; errors: string[] }> {
  const playlist = await createPlaylist(name);
  let tracksAdded = 0;
  const errors: string[] = [];

  for (let index = 0; index < albums.length; index++) {
    const album = albums[index];
    onProgress?.(index, albums.length, album);
    try {
      const uris = await getAlbumTrackUris(album.id);
      await addTrackUrisToPlaylist(playlist.id, uris);
      tracksAdded += uris.length;
    } catch (error) {
      const message = (error as { message?: string } | null)?.message ?? 'Unknown error';
      errors.push(`${album.title}: ${message}`);
    }
    onProgress?.(index + 1, albums.length, album);
    if (index < albums.length - 1) await sleep(60);
  }

  if (tracksAdded === 0) {
    // Do not leave an empty playlist behind if every album failed to resolve.
    try { await unfollowPlaylist(playlist.id); } catch { /* best effort */ }
    const firstError = errors[0] ? ` ${errors[0]}` : '';
    throw new Error(
      errors.length
        ? `Could not add any tracks to the playlist.${firstError} The empty playlist was removed.`
        : 'No tracks were found for the selected albums. The empty playlist was removed.',
    );
  }

  return { playlist, tracksAdded, errors };
}

// Accepts Queueable[] so both Album[] and PlaylistAlbum[] can be passed
// without unsafe casts at the call site.
export async function addAlbumsToQueue(albums: Queueable[]): Promise<QueueResult> {
  const token = await getValidAccessToken();
  let success = 0;
  let failed  = 0;
  let lastError = '';

  for (const album of albums) {
    const uris = await getAlbumTrackUris(album.id);
    for (const uri of uris) {
      const res = await fetch(
        `${SPOTIFY_API_URL}/me/player/queue?uri=${encodeURIComponent(uri)}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status === 204)      success++;
      else if (res.status === 403) throw new Error('Spotify Premium required or no active device');
      else { failed++; lastError = 'Some tracks could not be queued'; }
      await sleep(80);
    }
  }

  return { success, failed, error: lastError || undefined };
}
