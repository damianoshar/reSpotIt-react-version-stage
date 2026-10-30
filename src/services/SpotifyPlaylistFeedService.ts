import { getValidAccessToken } from './SpotifyAuthService';
import { spotifyFetch, sleep } from '../utils/spotifyFetch';
import { SPOTIFY_API_URL } from '../config/spotify';
import { CancellationToken, SyncCancelledError } from './SpotifyApiService';

// ---------------------------------------------------------------------------
// Internal raw types  (named explicitly to avoid indexed-access on nullable)
// ---------------------------------------------------------------------------

interface RawArtist { id: string; name: string; }

interface RawAlbum {
  id:           string;
  name:         string;
  artists:      RawArtist[];
  images:       { url: string; width: number; height: number }[];
  release_date: string;
}

interface RawTrackItem {
  track: { id: string; name: string; album: RawAlbum } | null;
}

interface TracksPage {
  items: RawTrackItem[];
  next:  string | null;
  total: number;
}

interface ArtistsPage {
  artists: { id: string; genres: string[] }[];
}

// Map entry — album augmented with the resolved primary artist id
interface AlbumEntry {
  album:  RawAlbum & { artist_id: string };
  tracks: string[];
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PlaylistAlbum {
  id:          string;
  title:       string;
  artist:      string;
  year:        number;
  genre:       string;
  image_url:   string;
  image_path:  string;
  trackCount:  number;
  trackTitles: string[];
}

export type PlaylistFetchStage = 'tracks' | 'genres';

export interface PlaylistFetchProgress {
  stage:   PlaylistFetchStage;
  fetched: number;
  total:   number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchPlaylistAlbums(
  playlistId:  string,
  onProgress?: (p: PlaylistFetchProgress) => void,
  token?:      CancellationToken,
): Promise<PlaylistAlbum[]> {
  const accessToken = await getValidAccessToken();

  // ── 1. Fetch all tracks, deduplicate by album id ─────────────────────────
  const trackMap = new Map<string, AlbumEntry>();
  let url: string | null =
    `${SPOTIFY_API_URL}/playlists/${playlistId}/tracks` +
    `?limit=100&fields=items(track(id,name,album(id,name,artists,images,release_date))),next,total`;
  let total   = 0;
  let fetched = 0;

  while (url) {
    if (token?.cancelled) throw new SyncCancelledError();

    const page: TracksPage = await spotifyFetch<TracksPage>(url, accessToken);
    if (total === 0) total = page.total;

    for (const item of page.items) {
      const track = item?.track;
      if (!track?.album?.id) continue; // local / unavailable track

      fetched++;
      const albumId       = track.album.id;
      const primaryArtist = track.album.artists[0] as RawArtist | undefined;
      const existing      = trackMap.get(albumId);

      if (existing) {
        if (track.name && !existing.tracks.includes(track.name)) {
          existing.tracks.push(track.name);
        }
      } else {
        trackMap.set(albumId, {
          album:  { ...track.album, artist_id: primaryArtist?.id ?? '' },
          tracks: track.name ? [track.name] : [],
        });
      }
    }

    onProgress?.({ stage: 'tracks', fetched, total });
    url = page.next ?? null;
    if (url) await sleep(80);
  }

  // ── 2. Genre enrichment (best-effort, batched 50) ────────────────────────
  const artistIds = [...new Set(
    [...trackMap.values()].map((e) => e.album.artist_id).filter(Boolean)
  )];
  const genreMap  = new Map<string, string>();
  const gTotal    = artistIds.length;

  for (let i = 0; i < artistIds.length; i += 50) {
    if (token?.cancelled) break;
    try {
      const batch = artistIds.slice(i, i + 50).join(',');
      const res: ArtistsPage = await spotifyFetch<ArtistsPage>(
        `${SPOTIFY_API_URL}/artists?ids=${batch}`, accessToken
      );
      res.artists.forEach((a) => {
        if (a?.id && a.genres?.[0]) genreMap.set(a.id, a.genres[0]);
      });
      onProgress?.({ stage: 'genres', fetched: Math.min(i + 50, gTotal), total: gTotal });
    } catch { /* genre enrichment is non-critical */ }
    await sleep(80);
  }

  // ── 3. Build result, sort by trackCount desc ─────────────────────────────
  const results: PlaylistAlbum[] = [];

  for (const [albumId, { album, tracks }] of trackMap) {
    results.push({
      id:          albumId,
      title:       album.name,
      artist:      album.artists.map((a: RawArtist) => a.name).join(', '),
      year:        parseInt(album.release_date?.split('-')[0] ?? '0', 10) || 0,
      genre:       genreMap.get(album.artist_id) ?? '',
      image_url:   pickBestImage(album.images),
      image_path:  '',
      trackCount:  tracks.length,
      trackTitles: tracks,
    });
  }

  return results.sort((a, b) => b.trackCount - a.trackCount || a.title.localeCompare(b.title));
}

function pickBestImage(images: { url: string; width: number; height: number }[]): string {
  if (!images.length) return '';
  const sorted = [...images].sort((a, b) => b.width - a.width);
  return (sorted.find((img) => img.width <= 300) ?? sorted[sorted.length - 1])?.url ?? '';
}
