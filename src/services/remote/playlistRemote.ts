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
  // Local 'added_at' has no server equivalent for playlist albums — fall back.
  return sortField === 'added_at' ? 'artist' : sortField;
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
  const data = await apiFetch<{ data: RemotePlaylistItem[] }>(base, '/api/v1/playlists');
  const items = data.data ?? [];
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
    year_from: yearParam(f.yearFrom),
    year_to:   yearParam(f.yearTo),
    sort:      sortParam(f.sortField),
    order:     f.sortOrder,
    page:      String(page),
    limit:     String(limit),
  });
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
