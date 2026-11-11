import { apiFetch } from './apiClient';

export interface ResolvedAlbum {
  artist: string;
  album: string;
  spotify_id: string;
  title: string;
  artist_name: string;
  year: number;
  image_url: string;
  spotify_url: string;
}

export interface UnresolvedAlbum {
  artist: string;
  album: string;
}

export async function resolveAlbums(
  base: string,
  items: { artist: string; album: string }[],
): Promise<{ resolved: ResolvedAlbum[]; unresolved: UnresolvedAlbum[] }> {
  const res = await apiFetch<{ resolved: ResolvedAlbum[]; unresolved: UnresolvedAlbum[] }>(
    base, '/api/v1/spotify/resolve-albums', { method: 'POST', body: { items } },
  );
  return { resolved: res.resolved ?? [], unresolved: res.unresolved ?? [] };
}

export interface ResolvedArtist {
  name: string;
  spotify_id: string;
  matched_name: string;
  image_url: string;
  genres: string[];
  followed: boolean;
}

export async function getFollowedArtists(base: string): Promise<{ id: string; name: string; image_url: string; genres: string[] }[]> {
  const res = await apiFetch<{ artists: { id: string; name: string; image_url: string; genres: string[] }[] }>(
    base, '/api/v1/spotify/followed-artists',
  );
  return res.artists ?? [];
}

export async function resolveArtists(
  base: string,
  names: string[],
): Promise<{ resolved: ResolvedArtist[]; unresolved: string[] }> {
  const res = await apiFetch<{ resolved: ResolvedArtist[]; unresolved: string[] }>(
    base, '/api/v1/spotify/resolve-artists', { method: 'POST', body: { names } },
  );
  return { resolved: res.resolved ?? [], unresolved: res.unresolved ?? [] };
}

/**
 * Save albums to the signed-in account's Spotify library, using the media
 * server's own Spotify link (remote mode). The device has no Spotify token in
 * remote mode, so the server has to do the write.
 */
export async function saveRemoteAlbums(base: string, albumIds: string[]): Promise<number> {
  if (!albumIds.length) return 0;
  const res = await apiFetch<{ saved?: number }>(
    base, '/api/v1/spotify/albums/save', { method: 'POST', body: { album_ids: albumIds } },
  );
  return res.saved ?? albumIds.length;
}

export interface FollowArtistsResult {
  total: number;
  already_followed: number;
  followed: number;
}

/**
 * Follow every artist found in the signed-in account's saved Spotify albums,
 * using the media server's own Spotify link. Used in remote mode so the tool
 * works without a device Spotify login (docs/STORAGE-POLICY.md).
 */
export async function followLibraryArtistsRemote(base: string): Promise<FollowArtistsResult> {
  const res = await apiFetch<Partial<FollowArtistsResult>>(
    base, '/api/v1/spotify/follow-artists', { method: 'POST' },
  );
  return {
    total:            res.total            ?? 0,
    already_followed: res.already_followed ?? 0,
    followed:         res.followed         ?? 0,
  };
}