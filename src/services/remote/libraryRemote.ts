import { Album, LibraryStats, FilterState } from '../../types';
import { SyncResult } from '../SyncService';
import { SyncStage } from '../SpotifyApiService';
import { sleep } from '../../utils/spotifyFetch';
import { apiFetch, apiFetchBlob } from './apiClient';

// ---------------------------------------------------------------------------
// Remote library — same shapes as the local path so hooks stay identical.
// Maps the canonical /api/v1 responses onto Album/LibraryStats/SyncResult.
// ---------------------------------------------------------------------------

interface RemoteAlbumItem {
  id:        string;
  title:     string;
  artist:    string;
  year:      number;
  genre:     string;
  image_url: string | null;
  added_at:  string | null;
  // Rich extras — only some backends send them; all optional.
  album_type?:  string | null;
  popularity?:  number | null;
  spotify_url?: string | null;
}

interface AlbumsPage {
  items: RemoteAlbumItem[];
  total: number;
  page:  number;
  limit: number;
}

interface RemoteStats {
  totalAlbums:  number;
  totalArtists: number;
  totalGenres:  number;
  newestYear:   number | null;
  oldestYear:   number | null;
  // Breakdown extras — python sends camelCase, elixir sends snake_case;
  // both are optional (csharp serves totals only).
  topGenres?:     { name: string; count: number }[];
  topArtists?:    { name: string; count: number }[];
  albumsByYear?:  { year: number; count: number }[];
  top_genres?:    { name: string; count: number }[];
  top_artists?:   { name: string; count: number }[];
  albums_by_year?: { year: number; count: number }[];
}

export interface RemoteJob {
  job_id:  string;
  type:    string;
  status:  'pending' | 'running' | 'done' | 'error' | 'cancelled';
  stage:   string;
  fetched: number;
  total:   number;
  result:  SyncResult | null;
  error:   string | null;
  /**
   * Optional extras on GET /api/v1/sync/history rows: when the run started and
   * finished. Only some backends add them (python today) — elixir and C# send
   * the bare envelope — so history rendering must not require them.
   */
  created_at?:  string | null;
  finished_at?: string | null;
}

export interface RemoteSyncState {
  active:  boolean;
  stage:   SyncStage;
  fetched: number;
  total:   number;
}

const STAGES: SyncStage[] = ['albums', 'genres', 'saving', 'tracks', 'queueing', 'images'];

function mapStage(stage: string): SyncStage {
  return (STAGES as string[]).includes(stage) ? (stage as SyncStage) : 'saving';
}

function mapAlbum(item: RemoteAlbumItem): Album {
  return {
    id:         item.id,
    title:      item.title ?? '',
    artist:     item.artist ?? '',
    year:       item.year ?? 0,
    genre:      item.genre ?? '',
    image_url:  item.image_url ?? '',
    image_path: '',
    added_at:   item.added_at ?? '',
    album_type: item.album_type ?? '',
    popularity: typeof item.popularity === 'number' ? item.popularity : null,
    spotify_url: item.spotify_url ?? '',
  };
}

function yearParam(val: number | ''): string {
  return val === '' ? '' : String(val);
}

function buildQuery(f: FilterState, limit: number, offset: number): string {
  // Server pages by page/limit; offset converts to 1-based page.
  const page = Math.floor(offset / limit) + 1;
  const q = new URLSearchParams({
    search:    f.search,
    genre:     f.genre,
    artist:    f.artist,
    year_from: yearParam(f.yearFrom),
    year_to:   yearParam(f.yearTo),
    sort:      f.sortField,
    order:     f.sortOrder,
    page:      String(page),
    limit:     String(limit),
  });
  // Rich-extras filters — only sent when set, so backends that don't
  // implement them still see the canonical query.
  if (f.albumType) q.set('album_type', f.albumType);
  if (f.minPop > 0)   q.set('min_pop', String(f.minPop));
  if (f.maxPop < 100) q.set('max_pop', String(f.maxPop));
  return '/api/v1/albums?' + q.toString();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function queryRemoteAlbums(
  base: string, f: FilterState, limit: number, offset: number,
): Promise<{ albums: Album[]; total: number }> {
  const page = await apiFetch<AlbumsPage>(base, buildQuery(f, limit, offset));
  return { albums: (page.items ?? []).map(mapAlbum), total: page.total ?? 0 };
}

export async function fetchRemoteStats(base: string): Promise<LibraryStats> {
  const s = await apiFetch<RemoteStats>(base, '/api/v1/albums/stats');
  return {
    totalAlbums:  s.totalAlbums ?? 0,
    totalArtists: s.totalArtists ?? 0,
    totalGenres:  s.totalGenres ?? 0,
    newestYear:   s.newestYear ?? 0,
    oldestYear:   s.oldestYear ?? 0,
    // Accept either casing; csharp serves none of these (graceful default).
    topGenres:    s.topGenres    ?? s.top_genres    ?? [],
    topArtists:   s.topArtists   ?? s.top_artists   ?? [],
    albumsByYear: s.albumsByYear ?? s.albums_by_year ?? [],
  };
}

export interface RemoteFilterOptions {
  genres:  string[];
  artists: string[];
  years:   number[];
}

export async function fetchRemoteFilterOptions(base: string): Promise<RemoteFilterOptions> {
  const [g, a, y] = await Promise.all([
    apiFetch<{ data: string[] }>(base, '/api/v1/meta/genres'),
    apiFetch<{ data: string[] }>(base, '/api/v1/meta/artists'),
    apiFetch<{ data: number[] }>(base, '/api/v1/meta/years'),
  ]);
  return { genres: g.data ?? [], artists: a.data ?? [], years: y.data ?? [] };
}

// ---------------------------------------------------------------------------
// Sync (start → poll → cancel), mirroring the local staged flow
// ---------------------------------------------------------------------------

export async function startRemoteSync(base: string, clean: boolean): Promise<string> {
  const data = await apiFetch<{ job_id: string }>(
    base, '/api/v1/sync/albums', { method: 'POST', body: { clean } }
  );
  if (!data?.job_id) throw new Error('Server did not return a sync job');
  return data.job_id;
}

export async function getRemoteJob(base: string, jobId: string): Promise<RemoteJob> {
  return apiFetch<RemoteJob>(base, '/api/v1/jobs/' + encodeURIComponent(jobId));
}

export async function cancelRemoteJob(base: string, jobId: string): Promise<void> {
  await apiFetch(base, '/api/v1/jobs/' + encodeURIComponent(jobId) + '/cancel', { method: 'POST' });
}

/**
 * The server's recent runs, newest first — the canonical {data: [job envelope]}
 * shape, listing every job type (the caller filters to finished syncs). A
 * failure is the caller's to swallow: history is a nicety, never a reason to
 * block the sync UI.
 */
export async function fetchRemoteSyncHistory(base: string, limit = 5): Promise<RemoteJob[]> {
  const data = await apiFetch<{ data: RemoteJob[] }>(base, `/api/v1/sync/history?limit=${limit}`);
  return data?.data ?? [];
}

function jobResult(job: RemoteJob): SyncResult {
  const r = job.result;
  return {
    imported: r?.imported ?? 0,
    existing: r?.existing ?? 0,
    skipped:  r?.skipped ?? 0,
    errors:   r?.errors ?? [],
  };
}

/**
 * Polls a sync job until done/cancelled/error, driving the same progress
 * UI as local sync. Throws on error status; resolves partial counts when
 * cancelled via `token`.
 */
export async function pollRemoteSync(
  base: string,
  jobId: string,
  onProgress: (s: RemoteSyncState) => void,
  token?: { cancelled: boolean },
): Promise<SyncResult> {
  for (;;) {
    if (token?.cancelled) {
      await cancelRemoteJob(base, jobId).catch(() => {});
      const job = await getRemoteJob(base, jobId).catch(() => null);
      return job ? jobResult(job) : { imported: 0, skipped: 0, existing: 0, errors: [] };
    }

    const job = await getRemoteJob(base, jobId);
    onProgress({ active: true, stage: mapStage(job.stage), fetched: job.fetched, total: job.total });

    if (job.status === 'done')      return jobResult(job);
    if (job.status === 'cancelled') return jobResult(job);
    if (job.status === 'error')     throw new Error(job.error ?? 'Remote sync failed');

    await sleep(2000);
  }
}

// ---------------------------------------------------------------------------
// CSV import / export / clear (remote)
// ---------------------------------------------------------------------------

export async function importRemoteCsv(base: string, csvText: string): Promise<SyncResult> {
  const data = await apiFetch<SyncResult>(
    base, '/api/v1/import/csv', { method: 'POST', body: { csv_content: csvText } }
  );
  return {
    imported: data.imported ?? 0,
    existing: data.existing ?? 0,
    skipped:  data.skipped ?? 0,
    errors:   data.errors ?? [],
  };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Downloads the server-built library CSV (contract columns). */
export async function exportRemoteBackup(base: string): Promise<string> {
  const { blob, filename: serverFilename } = await apiFetchBlob(base, '/api/v1/albums/export');
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fallback = `spotify-library-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
  const filename = serverFilename ?? fallback;
  downloadBlob(blob, filename);
  return filename;
}

export async function clearRemoteLibrary(base: string): Promise<void> {
  await apiFetch(base, '/api/v1/albums', { method: 'DELETE' });
}

export interface ExportHistoryItem {
  filename:    string;
  row_count:   number;
  exported_at: string;
}

/** Past server-side CSV exports, newest first (backup tab). */
export async function fetchExportHistory(base: string): Promise<ExportHistoryItem[]> {
  const data = await apiFetch<{ data: ExportHistoryItem[] }>(base, '/api/v1/exports/history');
  return data.data ?? [];
}
