/**
 * The most popular track of an album.
 *
 * The album flows ("Add from site", "Scan page with AI") can offer to add the
 * most popular track of every album that was found to a playlist the user
 * picks. Resolving that is read-only: nothing is written to Spotify here
 * (UI policy P9). The client writes only after the user pressed the button.
 *
 * The track shape is the same in both modes — remote mode asks the media
 * server, local mode reads Spotify with the device's own token.
 */
import { getValidAccessToken } from './SpotifyAuthService';
import { spotifyFetch, sleep } from '../utils/spotifyFetch';
import { SPOTIFY_API_URL } from '../config/spotify';

export interface AlbumTopTrack {
  spotify_id: string;
  uri: string;
  name: string;
  artist_names: string;
  album_id: string;
  album_name: string;
  album_image_url: string;
  /** Spotify popularity (0-100). */
  popularity: number;
  track_number: number | null;
  duration_ms: number;
  release_year: number | null;
}

interface SimplifiedAlbumTrack {
  id?: string;
  name?: string;
  uri?: string;
  track_number?: number;
  duration_ms?: number;
  artists?: { name?: string }[];
}

interface AlbumSummary {
  name?: string;
  images?: { url?: string }[];
  release_date?: string;
  artists?: { name?: string }[];
}

/**
 * The Spotify popularity of a batch of tracks.
 *
 * An album's track list holds simplified track objects, which carry no
 * popularity. `/tracks?ids=...` returns the full objects that do, so the
 * ranking needs that second call. Spotify answers with `{"tracks": [...]}`.
 */
async function fetchPopularity(
  token: string,
  ids: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (!chunk.length) continue;
    let data: { tracks?: ({ id?: string; popularity?: number } | null)[] };
    try {
      data = await spotifyFetch<{ tracks?: ({ id?: string; popularity?: number } | null)[] }>(
        `${SPOTIFY_API_URL}/tracks?ids=${encodeURIComponent(chunk.join(','))}`,
        token,
      );
    } catch {
      continue; // a batch that cannot be read simply has no popularity
    }
    for (const track of data?.tracks ?? []) {
      if (track?.id) out[track.id] = track.popularity ?? 0;
    }
  }
  return out;
}

/**
 * The most popular track of each album, read straight from Spotify with the
 * device's own token (local mode).
 *
 * An album that cannot be read is skipped: the other albums still get their
 * track.
 */
export async function getAlbumTopTracks(albumIds: string[]): Promise<AlbumTopTrack[]> {
  const token = await getValidAccessToken();
  const out: AlbumTopTrack[] = [];

  for (const albumId of albumIds ?? []) {
    const id = (albumId ?? '').trim();
    if (!id) continue;
    try {
      const album = await spotifyFetch<AlbumSummary>(
        `${SPOTIFY_API_URL}/albums/${encodeURIComponent(id)}`,
        token,
      );

      const items: SimplifiedAlbumTrack[] = [];
      let url: string | null = `${SPOTIFY_API_URL}/albums/${encodeURIComponent(id)}/tracks?limit=50`;
      while (url) {
        const page: { items?: SimplifiedAlbumTrack[]; next?: string | null } =
          await spotifyFetch<{ items?: SimplifiedAlbumTrack[]; next?: string | null }>(url, token);
        items.push(...(page.items ?? []));
        url = page.next ?? null;
        if (url) await sleep(60);
      }

      const ids = items.map((t) => t.id).filter((x): x is string => !!x);
      const popularity = await fetchPopularity(token, ids);

      const albumArtists = (album.artists ?? []).map((a) => a.name ?? '').filter(Boolean).join(', ');
      const releaseDate = album.release_date ?? '';
      const year = Number.parseInt(releaseDate.slice(0, 4), 10);

      const rows: AlbumTopTrack[] = items
        .filter((t): t is SimplifiedAlbumTrack & { id: string } => !!t.id)
        .map((t) => ({
          spotify_id:      t.id,
          uri:             t.uri ?? `spotify:track:${t.id}`,
          name:            t.name ?? '',
          artist_names:    (t.artists ?? []).map((a) => a.name ?? '').filter(Boolean).join(', ') || albumArtists,
          album_id:        id,
          album_name:      album.name ?? '',
          album_image_url: album.images?.[0]?.url ?? '',
          popularity:      popularity[t.id] ?? 0,
          track_number:    t.track_number ?? null,
          duration_ms:     t.duration_ms ?? 0,
          release_year:    Number.isFinite(year) ? year : null,
        }));

      // Most popular first; a tie is broken with the lowest track number, so
      // the pick is stable.
      rows.sort((a, b) => (
        (b.popularity - a.popularity)
        || ((a.track_number ?? 9999) - (b.track_number ?? 9999))
        || a.name.localeCompare(b.name)
      ));
      if (rows.length) out.push(rows[0]);
    } catch {
      // Skip the album; the others still get their most popular track.
    }
  }

  return out;
}
