import { SpotifyPlaylist, QueueResult } from '../SpotifyPlaylistService';
import { PlaylistAlbum } from '../SpotifyPlaylistFeedService';
import { FilterState } from '../../types';
import { sleep } from '../../utils/spotifyFetch';
import { apiFetch, apiFetchBlob } from './apiClient';
import { RemoteJob } from './libraryRemote';
import { getRemoteJob, cancelRemoteJob } from './libraryRemote';

// ---------------------------------------------------------------------------
// Remote playlists — same shapes as the local path so hooks stay identical.
// ---------------------------------------------------------------------------

interface RemotePlaylistItem {
  id:          string;
  name:        string;
  image_url:   string | null;
  track_count: number;
  public:      boolean;
  synced_at:   string | null;
  /** Spotify's /me/playlists position (0 = most recently added). */
  added_order?: number | null;
}

interface RemotePlaylistGroup {
  id:           string;
  title:        string;
  artist:       string;
  year:         number;
  genre:        string;
  image_url:    string;
  track_count:  number;
  track_titles: string[];
}

interface PlaylistAlbumsPage {
  items: RemotePlaylistGroup[];
  total: number;
  page:  number;
  limit: number;
}

function mapPlaylist(p: RemotePlaylistItem): SpotifyPlaylist {
  return {
    id:     p.id,
    name:   p.name,
    images: p.image_url ? [{ url: p.image_url }] : [],
    tracks: { total: p.track_count ?? 0 },
    owner:  { id: '' },
    // The server reports the position in Spotify's /me/playlists order, which
    // is what the picker's "Date Added" chip sorts on.
    addedOrder: p.added_order ?? undefined,
  };
}

function mapGroup(g: RemotePlaylistGroup): PlaylistAlbum {
  return {
    id:          g.id,
    title:       g.title,
    artist:      g.artist,
    year:        g.year ?? 0,
    genre:       g.genre ?? '',
    image_url:   g.image_url ?? '',
    image_path:  '',
    trackCount:  g.track_count ?? 0,
    trackTitles: g.track_titles ?? [],
  };
}

function yearParam(val: number | ''): string {
  return val === '' ? '' : String(val);
}

function sortParam(sortField: string): string {
  // 'added_at' is the album's position in the playlist - the server sorts by
  // it. Every other sort field has the same name on both sides.
  return sortField;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface RemotePlaylistList {
  playlists: SpotifyPlaylist[];
  /** spotify_id → ISO synced_at for cached playlists (drives the picker badge). */
  syncedAt: Map<string, string>;
}

export async function listRemotePlaylists(base: string): Promise<RemotePlaylistList> {
  // GET /api/v1/playlists is a bare array on FastAPI and { data: [...] } on the
  // JWT backends. Accept both shapes so remote playlists work everywhere
  // (mirrors the Kotlin PlaylistListEnvelopeDeserializer).
  const data = await apiFetch<RemotePlaylistItem[] | { data?: RemotePlaylistItem[] }>(
    base, '/api/v1/playlists'
  );
  const items = Array.isArray(data) ? data : (data?.data ?? []);
  const syncedAt = new Map<string, string>();
  for (const p of items) {
    if (p.synced_at) syncedAt.set(p.id, p.synced_at);
  }
  return { playlists: items.map(mapPlaylist), syncedAt };
}

export async function queryRemotePlaylistAlbums(
  base: string, playlistId: string, f: FilterState, limit: number, offset: number,
): Promise<{ albums: PlaylistAlbum[]; total: number }> {
  const page = Math.floor(offset / limit) + 1;
  const q = new URLSearchParams({
    search:    f.search,
    genre:     f.genre,
    artist:    f.artist,
    sort:      sortParam(f.sortField),
    order:     f.sortOrder,
    page:      String(page),
    limit:     String(limit),
  });
  // Only send the year filters the user actually set. An empty filter used to
  // go out as "year_from=" and the server rejected the whole request.
  const yf = yearParam(f.yearFrom);
  const yt = yearParam(f.yearTo);
  if (yf) q.set('year_from', yf);
  if (yt) q.set('year_to', yt);
  const data = await apiFetch<PlaylistAlbumsPage>(
    base, `/api/v1/playlists/${encodeURIComponent(playlistId)}/albums?` + q.toString()
  );
  return { albums: (data.items ?? []).map(mapGroup), total: data.total ?? 0 };
}

export interface RemotePlaylistFilterOptions {
  genres:  string[];
  artists: string[];
  years:   number[];
}

export async function fetchRemotePlaylistMeta(
  base: string, playlistId: string
): Promise<RemotePlaylistFilterOptions> {
  const data = await apiFetch<RemotePlaylistFilterOptions>(
    base, `/api/v1/playlists/${encodeURIComponent(playlistId)}/meta`
  );
  return { genres: data.genres ?? [], artists: data.artists ?? [], years: data.years ?? [] };
}

// ---------------------------------------------------------------------------
// Sync (start → poll → cancel)
// ---------------------------------------------------------------------------

export async function startRemotePlaylistSync(base: string, playlistId: string): Promise<string> {
  const data = await apiFetch<{ job_id: string }>(
    base, `/api/v1/playlists/${encodeURIComponent(playlistId)}/sync`, { method: 'POST' }
  );
  if (!data?.job_id) throw new Error('Server did not return a sync job');
  return data.job_id;
}

export async function pollRemotePlaylistSync(
  base: string,
  jobId: string,
  onProgress: (s: { active: boolean; stage: 'tracks' | 'genres' | 'idle'; fetched: number; total: number }) => void,
  token?: { cancelled: boolean },
): Promise<{ albumCount: number }> {
  for (;;) {
    if (token?.cancelled) {
      await cancelRemoteJob(base, jobId).catch(() => {});
      return { albumCount: 0 };
    }
    const job: RemoteJob = await getRemoteJob(base, jobId);
    // Server playlist stages (albums/saving) collapse onto the local 'tracks' stage.
    onProgress({ active: true, stage: 'tracks', fetched: job.fetched, total: job.total });
    if (job.status === 'done' || job.status === 'cancelled') {
      const n = job.result ? job.result.imported + job.result.existing : 0;
      return { albumCount: n };
    }
    if (job.status === 'error') throw new Error(job.error ?? 'Playlist sync failed');
    await sleep(2000);
  }
}

// ---------------------------------------------------------------------------
// Queue (start → poll → result)
// ---------------------------------------------------------------------------

export async function queueRemoteAlbums(base: string, albumIds: string[]): Promise<QueueResult> {
  const started = await apiFetch<{ job_id: string }>(
    base, '/api/v1/queue', { method: 'POST', body: { album_ids: albumIds } }
  );
  if (!started?.job_id) throw new Error('Server did not return a queue job');

  for (;;) {
    const job: RemoteJob = await getRemoteJob(base, started.job_id);
    if (job.status === 'done' || job.status === 'cancelled') {
      const r = job.result;
      return { success: r?.imported ?? 0, failed: r?.skipped ?? 0, error: r?.errors?.[0] };
    }
    if (job.status === 'error') throw new Error(job.error ?? 'Queue failed');
    await sleep(2000);
  }
}

// ---------------------------------------------------------------------------
// Add to playlist (server resolves album_ids — no device Spotify token needed)
// ---------------------------------------------------------------------------

export async function addRemoteAlbumsToPlaylist(
  base: string, albumIds: string[], playlistId: string
): Promise<{ tracksAdded: number }> {
  const data = await apiFetch<{ tracks_added: number }>(
    base, `/api/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
    { method: 'POST', body: { album_ids: albumIds } }
  );
  return { tracksAdded: data.tracks_added ?? 0 };
}

export async function createAndAddRemotePlaylist(
  base: string, name: string, albumIds: string[]
): Promise<{ id: string; name: string; tracksAdded: number }> {
  const data = await apiFetch<{ playlist_id: string; playlist_name: string; tracks_added: number }>(
    base, '/api/v1/playlists', { method: 'POST', body: { name, album_ids: albumIds, public: false } }
  );
  if (!data?.playlist_id) throw new Error('Server did not create the playlist');
  return { id: data.playlist_id, name: data.playlist_name, tracksAdded: data.tracks_added ?? 0 };
}

// ---------------------------------------------------------------------------
// Track URIs (AI track scan). The server already accepts track URIs on the
// playlist routes, so no new route is needed.
// ---------------------------------------------------------------------------

/** Append direct track URIs to a playlist the user already has. */
export async function addRemoteTrackUrisToPlaylist(
  base: string, playlistId: string, uris: string[]
): Promise<number> {
  if (!uris.length) return 0;
  const data = await apiFetch<{ tracks_added?: number }>(
    base, `/api/v1/playlists/${encodeURIComponent(playlistId)}/items`,
    { method: 'POST', body: { uris } }
  );
  return data.tracks_added ?? uris.length;
}

/** Create a playlist and fill it with direct track URIs. */
export async function createAndAddRemoteTrackPlaylist(
  base: string, name: string, uris: string[]
): Promise<{ id: string; name: string; tracksAdded: number }> {
  const data = await apiFetch<{ playlist_id: string; playlist_name: string; tracks_added: number }>(
    base, '/api/v1/playlists', { method: 'POST', body: { name, uris, public: false } }
  );
  if (!data?.playlist_id) throw new Error('Server did not create the playlist');
  return { id: data.playlist_id, name: data.playlist_name, tracksAdded: data.tracks_added ?? 0 };
}

// ---------------------------------------------------------------------------
export async function removeRemoteAlbumsFromPlaylist(
  base: string, playlistId: string, albumIds: string[]
): Promise<{ tracksRemoved: number; albumsRemoved: number }> {
  const data = await apiFetch<{ tracks_removed?: number; albums_removed?: number }>(
    base, `/api/v1/playlists/${encodeURIComponent(playlistId)}/albums`,
    { method: 'DELETE', body: { album_ids: albumIds } }
  );
  return {
    tracksRemoved: data.tracks_removed ?? 0,
    albumsRemoved: data.albums_removed ?? albumIds.length,
  };
}

// Export (server-built CSV download)
// ---------------------------------------------------------------------------

export async function exportRemotePlaylist(
  base: string, playlistId: string, playlistName: string
): Promise<{ path: string; bytes: number }> {
  const { blob } = await apiFetchBlob(
    base, `/api/v1/playlists/${encodeURIComponent(playlistId)}/export`
  );
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `playlist-${playlistName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.csv`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { path: '(browser download)', bytes: blob.size };
}
