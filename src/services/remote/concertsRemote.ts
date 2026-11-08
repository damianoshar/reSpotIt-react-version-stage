import { apiFetch } from './apiClient';
import type { Concert } from '../DatabaseService';

// ---------------------------------------------------------------------------
// Remote concerts — the server-canonical store (docs/STORAGE-POLICY.md).
// Mirrors the local SQLite `Concerts` shape so callers stay mode-agnostic.
// ---------------------------------------------------------------------------

interface RemoteConcert {
  id: string;
  artist: string;
  artist_id?: string;
  title?: string;
  date?: string;
  venue?: string;
  url?: string;
  source_url?: string;
  followed?: boolean;
  created_at?: string;
}

function mapConcert(c: RemoteConcert): Concert {
  return {
    id: c.id,
    artist: c.artist ?? '',
    artist_id: c.artist_id ?? '',
    title: c.title ?? '',
    date: c.date ?? '',
    venue: c.venue ?? '',
    url: c.url ?? '',
    source_url: c.source_url ?? '',
    followed: !!c.followed,
    created_at: c.created_at ?? '',
  };
}

function toPayload(c: Concert) {
  return {
    id: c.id,
    artist: c.artist,
    artist_id: c.artist_id ?? '',
    title: c.title ?? '',
    date: c.date ?? '',
    venue: c.venue ?? '',
    url: c.url ?? '',
    source_url: c.source_url ?? '',
    followed: !!c.followed,
    created_at: c.created_at ?? '',
  };
}

export async function listRemoteConcerts(base: string): Promise<Concert[]> {
  const data = await apiFetch<{ concerts?: RemoteConcert[] }>(base, '/api/v1/concerts');
  return (data?.concerts ?? []).map(mapConcert);
}

export async function upsertRemoteConcerts(base: string, concerts: Concert[]): Promise<void> {
  if (!concerts.length) return;
  await apiFetch(base, '/api/v1/concerts', {
    method: 'POST',
    body: { items: concerts.map(toPayload) },
  });
}

export async function deleteRemoteConcert(base: string, id: string): Promise<void> {
  await apiFetch(base, `/api/v1/concerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function clearRemoteConcerts(base: string): Promise<void> {
  await apiFetch(base, '/api/v1/concerts', { method: 'DELETE' });
}

export interface RemoteConcertImport {
  imported: number;
  existing: number;
  removed: number;
  total: number;
  errors: string[];
}

export async function importRemoteConcerts(
  base: string,
  concerts: Concert[],
  replace = true,
): Promise<RemoteConcertImport> {
  const data = await apiFetch<Partial<RemoteConcertImport>>(base, '/api/v1/concerts/import', {
    method: 'POST',
    body: { items: concerts.map(toPayload), replace },
  });
  return {
    imported: data.imported ?? 0,
    existing: data.existing ?? 0,
    removed:  data.removed  ?? 0,
    total:    data.total    ?? 0,
    errors:   data.errors   ?? [],
  };
}