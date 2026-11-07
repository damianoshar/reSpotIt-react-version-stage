import { getValidAccessToken } from './SpotifyAuthService';
import { spotifyFetch, sleep } from '../utils/spotifyFetch';
import { SPOTIFY_API_URL } from '../config/spotify';
import type { Album } from '../types';

// ---------------------------------------------------------------------------
// Spotify catalog search + artist discography
// ---------------------------------------------------------------------------
// These calls use the Spotify account connected on this device. They are
// intentionally separate from the frozen /api/v1 library contract: search and
// discography are live Spotify reads, not server-library queries.

interface SpotifyImage {
  url: string;
  width?: number;
  height?: number;
}

interface SpotifyArtistRef {
  id: string;
  name: string;
  genres?: string[];
  images?: SpotifyImage[];
  followers?: { total: number };
}

interface SpotifyAlbumObject {
  id: string;
  name: string;
  artists: SpotifyArtistRef[];
  images: SpotifyImage[];
  release_date?: string;
  genres?: string[];
  album_type?: string;
  album_group?: string;
  total_tracks?: number;
  popularity?: number;
  external_urls?: { spotify?: string };
}

interface SpotifySearchResponse {
  artists?: { items?: SpotifyArtistRef[] };
  albums?: { items?: SpotifyAlbumObject[] };
}

interface ArtistAlbumsPage {
  items: SpotifyAlbumObject[];
  next: string | null;
  total: number;
}

export interface SpotifyArtistSummary {
  id: string;
  name: string;
  image_url: string;
  genres: string[];
  followers: number;
}

export interface CatalogAlbum extends Album {
  /** "album" | "single" | "compilation" | "appears_on" */
  album_group?: string;
  total_tracks?: number;
  artist_ids?: string[];
}

export interface SpotifyCatalogSearch {
  artists: SpotifyArtistSummary[];
  albums: CatalogAlbum[];
}

function pickBestImage(images: SpotifyImage[] = []): string {
  if (!images.length) return '';
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (
    sorted.find((img) => (img.width ?? 0) >= 200 && (img.width ?? 0) <= 320) ??
    sorted[0]
  )?.url ?? '';
}

function mapArtist(artist: SpotifyArtistRef): SpotifyArtistSummary {
  return {
    id: artist.id,
    name: artist.name || 'Unknown artist',
    image_url: pickBestImage(artist.images),
    genres: Array.isArray(artist.genres) ? artist.genres : [],
    followers: artist.followers?.total ?? 0,
  };
}

function mapAlbum(album: SpotifyAlbumObject): CatalogAlbum {
  const year = parseInt(String(album.release_date ?? '').slice(0, 4), 10);
  return {
    id: album.id,
    title: album.name || 'Unknown title',
    artist: (album.artists ?? []).map((a) => a.name).filter(Boolean).join(', ') || 'Unknown artist',
    year: Number.isFinite(year) ? year : 0,
    genre: album.genres?.[0] ?? '',
    image_url: pickBestImage(album.images),
    image_path: '',
    added_at: '',
    album_type: album.album_type ?? '',
    popularity: typeof album.popularity === 'number' ? album.popularity : null,
    spotify_url: album.external_urls?.spotify ?? '',
    album_group: album.album_group ?? album.album_type ?? '',
    total_tracks: album.total_tracks ?? 0,
    artist_ids: (album.artists ?? []).map((a) => a.id).filter(Boolean),
  };
}

/** Search both artists and albums so the same box can find a discography or
 *  directly match individual releases. */
export async function searchSpotifyCatalog(query: string): Promise<SpotifyCatalogSearch> {
  const token = await getValidAccessToken();
  const params = new URLSearchParams({
    q: query.trim(),
    type: 'artist,album',
    limit: '8',
  });
  const data = await spotifyFetch<SpotifySearchResponse>(
    `${SPOTIFY_API_URL}/search?${params.toString()}`,
    token,
  );

  return {
    artists: (data.artists?.items ?? [])
      .filter((artist) => !!artist?.id)
      .map(mapArtist),
    albums: (data.albums?.items ?? [])
      .filter((album) => !!album?.id)
      .map(mapAlbum),
  };
}

/** Every release Spotify groups under an artist: albums, singles, appearances
 *  and compilations. The picker filters these buckets client-side so switching
 *  Albums / Singles / Appears On does not re-hit the API. */
export async function fetchArtistDiscography(artistId: string): Promise<CatalogAlbum[]> {
  const token = await getValidAccessToken();
  const all: CatalogAlbum[] = [];
  let url: string | null =
    `${SPOTIFY_API_URL}/artists/${encodeURIComponent(artistId)}/albums` +
    '?include_groups=album,single,appears_on,compilation&limit=50';

  while (url) {
    const page: ArtistAlbumsPage = await spotifyFetch<ArtistAlbumsPage>(url, token);
    all.push(...(page.items ?? []).map(mapAlbum));
    url = page.next;
    if (url) await sleep(100);
  }

  // Spotify can return the same release more than once (for example an album
  // and an appearance edge case). The picker is keyed by Spotify id, so collapse
  // exact repeats while preserving the first bucket Spotify reported.
  const byId = new Map<string, CatalogAlbum>();
  for (const album of all) {
    if (!byId.has(album.id)) byId.set(album.id, album);
  }
  return [...byId.values()];
}
