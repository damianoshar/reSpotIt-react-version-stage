import { getValidAccessToken } from './SpotifyAuthService';
import { spotifyFetch, sleep } from '../utils/spotifyFetch';
import { Album } from '../types';
import { SPOTIFY_API_URL } from '../config/spotify';

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export class SyncCancelledError extends Error {
  constructor() { super('Sync cancelled by user'); this.name = 'SyncCancelledError'; }
}

export interface CancellationToken { cancelled: boolean; }

function assertNotCancelled(token?: CancellationToken): void {
  if (token?.cancelled) throw new SyncCancelledError();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpotifyImage  { url: string; width: number; height: number; }
interface SpotifyArtist { id: string; name: string; genres?: string[]; }

interface SpotifyAlbumObject {
  id:           string;
  name:         string;
  artists:      SpotifyArtist[];
  images:       SpotifyImage[];
  release_date: string;
  genres:       string[];
  album_type?:  string;
  popularity?:  number;
  external_urls?: { spotify?: string };
}

interface SavedAlbumItem {
  added_at: string;
  album:    SpotifyAlbumObject;
}

interface SavedAlbumsPage {
  items: SavedAlbumItem[];
  next:  string | null;
  total: number;
}

export type SyncStage = 'albums' | 'genres' | 'saving' | 'tracks' | 'queueing' | 'images';

export interface FetchProgress {
  stage:   SyncStage;
  fetched: number;
  total:   number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchAllSavedAlbums(
  onProgress?: (p: FetchProgress) => void,
  token?:       CancellationToken,
): Promise<Album[]> {
  const accessToken = await getValidAccessToken();
  const items       = await fetchAllPages(accessToken, onProgress, token);
  const genreMap    = await fetchArtistGenres(items, accessToken, onProgress, token);
  return items.map((item) => mapToAlbum(item, genreMap));
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function fetchAllPages(
  accessToken:  string,
  onProgress?:  (p: FetchProgress) => void,
  token?:       CancellationToken,
): Promise<SavedAlbumItem[]> {
  const all: SavedAlbumItem[] = [];
  let url: string | null = `${SPOTIFY_API_URL}/me/albums?limit=50`;
  let total = 0;

  while (url) {
    assertNotCancelled(token);
    const page: SavedAlbumsPage = await spotifyFetch<SavedAlbumsPage>(url, accessToken);
    total = page.total;
    all.push(...page.items);
    onProgress?.({ stage: 'albums', fetched: all.length, total });
    url = page.next;
    if (url) await sleep(100);
  }

  return all;
}

async function fetchArtistGenres(
  items:        SavedAlbumItem[],
  accessToken:  string,
  onProgress?:  (p: FetchProgress) => void,
  token?:       CancellationToken,
): Promise<Map<string, string[]>> {
  const ids   = [...new Set(items.flatMap((i) => i.album.artists.map((a) => a.id)))];
  const map   = new Map<string, string[]>();
  const total = ids.length;

  for (let i = 0; i < ids.length; i += 50) {
    assertNotCancelled(token);
    try {
      const batch = ids.slice(i, i + 50).join(',');
      const res = await spotifyFetch<{ artists: SpotifyArtist[] }>(
        `${SPOTIFY_API_URL}/artists?ids=${batch}`, accessToken
      );
      res.artists.forEach((a) => a?.id && map.set(a.id, a.genres ?? []));
      onProgress?.({ stage: 'genres', fetched: Math.min(i + 50, total), total });
    } catch (e) {
      if (e instanceof SyncCancelledError) throw e;
      /* genre enrichment is best-effort */
    }
    await sleep(100);
  }

  return map;
}

function mapToAlbum(item: SavedAlbumItem, genreMap: Map<string, string[]>): Album {
  const { album, added_at } = item;
  const primaryArtistId = album.artists[0]?.id ?? '';
  const genres = genreMap.get(primaryArtistId) ?? album.genres ?? [];

  return {
    id:         album.id,
    title:      album.name,
    artist:     album.artists.map((a) => a.name).join(', '),
    year:       parseInt(album.release_date?.split('-')[0] ?? '0', 10) || 0,
    genre:      genres[0] ?? '',
    image_url:  pickBestImage(album.images),
    image_path: '',
    added_at:   added_at ?? '',
    album_type: album.album_type ?? '',
    popularity: typeof album.popularity === 'number' ? album.popularity : null,
    spotify_url: album.external_urls?.spotify ?? '',
  };
}

// Fix: use largest image as fallback instead of smallest.
// The old code used sorted[sorted.length - 1] which picked the 64px thumbnail.
async function modifySavedAlbums(
  method: 'PUT' | 'DELETE',
  ids: string[],
): Promise<void> {
  if (!ids.length) return;
  const token = await getValidAccessToken();
  const action = method === 'PUT' ? 'save' : 'remove';

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch(
      `${SPOTIFY_API_URL}/me/albums?ids=${encodeURIComponent(chunk.join(','))}`,
      { method, headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Spotify session expired. Reconnect Spotify and try again.');
      }
      if (res.status === 403) {
        throw new Error(
          'Spotify did not grant permission to modify your library. Log out and reconnect Spotify, then try again.',
        );
      }
      throw new Error(`Spotify could not ${action} ${chunk.length} album(s) (HTTP ${res.status}).`);
    }
    if (i + 50 < ids.length) await sleep(60);
  }
}

/** Save albums to the current user's Spotify library (up to 50 per request). */
export async function saveAlbums(ids: string[]): Promise<void> {
  return modifySavedAlbums('PUT', ids);
}

export async function removeSavedAlbums(ids: string[]): Promise<void> {
  return modifySavedAlbums('DELETE', ids);
}

export async function getSavedAlbumArtistIds(): Promise<string[]> {
  const accessToken = await getValidAccessToken();
  const ids = new Set<string>();
  let url: string | null = `${SPOTIFY_API_URL}/me/albums?limit=50`;

  while (url) {
    const page: SavedAlbumsPage = await spotifyFetch<SavedAlbumsPage>(url, accessToken);
    for (const item of page.items) {
      for (const artist of item.album.artists) {
        if (artist?.id) ids.add(artist.id);
      }
    }
    url = page.next;
    if (url) await sleep(100);
  }

  return [...ids];
}

export async function areArtistsFollowed(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const token = await getValidAccessToken();
  const followed = new Set<string>();

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await spotifyFetch<boolean[]>(
      `${SPOTIFY_API_URL}/me/following/contains?type=artist&ids=${encodeURIComponent(chunk.join(','))}`,
      token,
    );
    chunk.forEach((id, index) => {
      if (res[index]) followed.add(id);
    });
    await sleep(60);
  }

  return followed;
}

export async function followArtists(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const token = await getValidAccessToken();

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch(`${SPOTIFY_API_URL}/me/following?type=artist`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: chunk }),
    });
    if (!res.ok) throw new Error(`Spotify could not follow ${chunk.length} artist(s) (HTTP ${res.status}).`);
    await sleep(60);
  }
}

function pickBestImage(images: SpotifyImage[]): string {
  if (!images.length) return '';
  // Sort descending by width so sorted[0] is always the largest
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  // Prefer ~300px for card display; fall back to largest available
  return (
    sorted.find((img) => img.width >= 200 && img.width <= 320) ??
    sorted[0]
  )?.url ?? '';
}
