import { apiFetch } from './apiClient';
import type { DuplicateAlbum } from '../../utils/duplicateFinder';

// ---------------------------------------------------------------------------
// Remote hidden duplicates — the server-canonical blocklist
// (docs/STORAGE-POLICY.md). Hiding is app-level and reversible; nothing here
// removes albums from the user's Spotify library.
// ---------------------------------------------------------------------------

interface RemoteHidden {
  id?: string;
  spotify_id?: string;
  title?: string;
  artist?: string;
  year?: number | null;
  genre?: string;
  album_type?: string;
  image_url?: string | null;
  added_at?: string;
}

function mapHidden(a: RemoteHidden): DuplicateAlbum {
  return {
    id: a.id ?? a.spotify_id ?? '',
    title: a.title ?? '',
    artist: a.artist ?? '',
    year: a.year ?? 0,
    genre: a.genre ?? '',
    image_url: a.image_url ?? '',
    album_type: a.album_type ?? '',
    added_at: a.added_at ?? '',
  };
}

function toPayload(a: DuplicateAlbum) {
  return {
    id: a.id,
    title: a.title ?? '',
    artist: a.artist ?? '',
    year: a.year ?? 0,
    genre: a.genre ?? '',
    album_type: a.album_type || 'album',
    image_url: a.image_url ?? null,
    added_at: a.added_at ?? '',
  };
}

export async function listRemoteHiddenDuplicates(base: string): Promise<DuplicateAlbum[]> {
  const data = await apiFetch<{ albums?: RemoteHidden[] }>(base, '/api/v1/albums/hidden');
  return (data?.albums ?? []).map(mapHidden).filter((a) => a.id);
}

export async function hideRemoteDuplicates(base: string, albums: DuplicateAlbum[]): Promise<void> {
  if (!albums.length) return;
  await apiFetch(base, '/api/v1/albums/hidden', {
    method: 'POST',
    body: { items: albums.map(toPayload) },
  });
}

export async function unhideRemoteDuplicateIds(base: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await Promise.all(ids.map((id) =>
    apiFetch(base, `/api/v1/albums/hidden/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  ));
}

/** Removes every hidden row and returns what was removed (for restore/re-insert). */
export async function restoreRemoteHiddenDuplicates(base: string): Promise<DuplicateAlbum[]> {
  const albums = await listRemoteHiddenDuplicates(base);
  await apiFetch(base, '/api/v1/albums/hidden', { method: 'DELETE' });
  return albums;
}

export interface RemoteHiddenImport {
  imported: number;
  existing: number;
  removed: number;
  total: number;
  errors: string[];
}

export async function importRemoteHiddenDuplicates(
  base: string,
  albums: DuplicateAlbum[],
  replace = true,
): Promise<RemoteHiddenImport> {
  const data = await apiFetch<Partial<RemoteHiddenImport>>(base, '/api/v1/albums/hidden/import', {
    method: 'POST',
    body: { items: albums.map(toPayload), replace },
  });
  return {
    imported: data.imported ?? 0,
    existing: data.existing ?? 0,
    removed:  data.removed  ?? 0,
    total:    data.total    ?? 0,
    errors:   data.errors   ?? [],
  };
}