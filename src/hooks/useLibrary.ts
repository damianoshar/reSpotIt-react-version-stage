import { useState, useEffect, useCallback, useRef } from 'react';
import { Album, LibraryStats, FilterState } from '../types';
import {
  initDB, getAllAlbums, countAlbums, getDistinctGenres, getDistinctArtists,
  getDistinctYears, getStats, clearLibrary, upsertAlbum, saveToStore,
  getExistingAlbumIds, getExportAlbums, upsertAlbums, PAGE_SIZE, deleteAlbums,
} from '../services/DatabaseService';
import { importFromCSV, SyncResult } from '../services/SyncService';
import {
  fetchAllSavedAlbums, FetchProgress, SyncStage,
  CancellationToken, SyncCancelledError,
} from '../services/SpotifyApiService';
import { useDebounce, yearStr } from '../utils/debounce';
import { getHiddenDuplicateIds } from '../utils/duplicateBlocklist';
import { DataSourceMode } from '../config/server';
import {
  queryRemoteAlbums, fetchRemoteStats, fetchRemoteFilterOptions,
  startRemoteSync, pollRemoteSync, cancelRemoteJob,
  importRemoteCsv, clearRemoteLibrary,
} from '../services/remote/libraryRemote';
import { describeRemoteError } from '../services/errorCodes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FILTER: FilterState = {
  search: '', genre: '', artist: '', yearFrom: '', yearTo: '',
  sortField: 'artist', sortOrder: 'asc',
  albumType: '', minPop: 0, maxPop: 100,
};

export interface SpotifySyncState {
  active:  boolean;
  stage:   SyncStage;
  fetched: number;
  total:   number;
}
const IDLE_SYNC: SpotifySyncState = { active: false, stage: 'albums', fetched: 0, total: 0 };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLibrary(ds: { mode: DataSourceMode; serverUrl: string; sessionActive: boolean }) {
  const remote = ds.mode === 'remote';
  const serverUrl = ds.serverUrl;
  // Remote queries wait until the server session is authenticated — probing
  // without one only produces 401s and a stale error banner after login.
  const sessionReady = !remote || ds.sessionActive;

  const [albums,      setAlbums]      = useState<Album[]>([]);
  const [total,       setTotal]       = useState(0);
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);

  const [genres,  setGenres]  = useState<string[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [years,   setYears]   = useState<number[]>([]);
  const [stats,   setStats]   = useState<LibraryStats | null>(null);

  const [filters, setFilters]   = useState<FilterState>(DEFAULT_FILTER);
  const queryFilters = useDebounce(filters, 250);

  const [loading,     setLoading]     = useState(true);
  const [dbReady,     setDbReady]     = useState(false);
  const [syncing,     setSyncing]     = useState(false);
  const [spotifySync, setSpotifySync] = useState<SpotifySyncState>(IDLE_SYNC);
  const [error,       setError]       = useState<string | null>(null);

  const cancelTokenRef = useRef<CancellationToken>({ cancelled: false });
  const remoteJobRef   = useRef<string | null>(null);

  useEffect(() => {
    initDB()
      .then(() => setDbReady(true))
      .catch((e) => setError('DB init failed: ' + (e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  // ── Core query — resets album list, runs on debounced filter change ───────
  // Remote mode reads the server (paginated envelope + stats + options);
  // local mode reads SQLite. Same state shapes either way.
  const runQuery = useCallback(async (f: FilterState) => {
    if (!dbReady) return;
    if (!sessionReady) { setLoading(false); return; }
    setLoading(true);
    offsetRef.current = 0;
    try {
      if (remote) {
        const [page, s, opts] = await Promise.all([
          queryRemoteAlbums(serverUrl, f, PAGE_SIZE, 0),
          fetchRemoteStats(serverUrl),
          fetchRemoteFilterOptions(serverUrl),
        ]);
        offsetRef.current = page.albums.length;
        setAlbums(page.albums);
        setTotal(page.total);
        setHasMore(page.albums.length < page.total);
        setGenres(opts.genres); setArtists(opts.artists); setYears(opts.years); setStats(s);
      } else {
        const [first, cnt, g, ar, y, s] = await Promise.all([
          getAllAlbums(
            f.search, f.genre, f.sortField, f.sortOrder,
            yearStr(f.yearFrom), yearStr(f.yearTo), f.artist,
            PAGE_SIZE, 0,
            f.albumType, f.minPop, f.maxPop
          ),
          countAlbums(f.search, f.genre, yearStr(f.yearFrom), yearStr(f.yearTo), f.artist,
                      f.albumType, f.minPop, f.maxPop),
          getDistinctGenres(),
          getDistinctArtists(),
          getDistinctYears(),
          getStats(),
        ]);
        offsetRef.current = first.length;
        setAlbums(first);
        setTotal(cnt);
        setHasMore(first.length < cnt);
        setGenres(g); setArtists(ar); setYears(y); setStats(s);
      }
      setError(null);
    } catch (e: any) {
      setError(remote
        ? describeRemoteError(e, 'Failed to load library')
        : 'Failed to load library: ' + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [dbReady, remote, serverUrl, sessionReady]);

  useEffect(() => { runQuery(queryFilters); }, [runQuery, queryFilters]);

  // Switching data source resets the grid and re-queries the other backend.
  const modeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = ds.mode + '|' + ds.serverUrl;
    if (modeKeyRef.current === null) { modeKeyRef.current = key; return; }
    if (modeKeyRef.current !== key) {
      modeKeyRef.current = key;
      offsetRef.current = 0;
      setAlbums([]); setTotal(0); setHasMore(false); setError(null);
      forceRefresh();
    }
  });

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const f = queryFilters;
      const more = remote
        ? (await queryRemoteAlbums(serverUrl, f, PAGE_SIZE, offsetRef.current)).albums
        : await getAllAlbums(
            f.search, f.genre, f.sortField, f.sortOrder,
            yearStr(f.yearFrom), yearStr(f.yearTo), f.artist,
            PAGE_SIZE, offsetRef.current,
            f.albumType, f.minPop, f.maxPop
          );
      if (more.length === 0) { setHasMore(false); return; }
      offsetRef.current += more.length;
      setAlbums((prev) => [...prev, ...more]);
      setHasMore(offsetRef.current < total);
    } catch (e: any) {
      // Remote failures show canonical wording keyed on the contract error code;
      // local failures keep their own message.
      setError(remote
        ? describeRemoteError(e, 'Failed to load more albums')
        : 'Failed to load more: ' + (e?.message ?? e));
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loading, queryFilters, total, remote, serverUrl]);

  const forceRefresh = useCallback(() => runQuery(queryFilters), [runQuery, queryFilters]);

  const syncCSV = useCallback(async (csvText: string): Promise<SyncResult> => {
    setSyncing(true);
    try {
      const r = remote
        ? await importRemoteCsv(serverUrl, csvText)
        : await importFromCSV(csvText);
      await forceRefresh();
      return r;
    } finally { setSyncing(false); }
  }, [forceRefresh, remote, serverUrl]);

  /**
   * Import full Album rows from the catalog picker. Unlike the CSV path this
   * keeps album_type/popularity/spotify_url intact, so the rich library filters
   * work for newly added releases. Local mode only — remote callers use the
   * server's canonical CSV import instead.
   */
  const importAlbums = useCallback(async (albums: Album[]): Promise<SyncResult> => {
    if (remote) throw new Error('Adding albums to the library is available in local mode.');

    const result: SyncResult = { imported: 0, skipped: 0, existing: 0, errors: [] };
    const [existingIds, hiddenIds] = await Promise.all([
      getExistingAlbumIds(),
      getHiddenDuplicateIds(),
    ]);

    const importedAt = new Date().toISOString();
    const fresh: Album[] = [];
    for (const album of albums) {
      if (hiddenIds.has(album.id)) { result.skipped++; continue; }
      if (existingIds.has(album.id)) { result.existing++; continue; }
      fresh.push({
        ...album,
        added_at: album.added_at || importedAt,
        image_path: album.image_path || '',
      });
    }

    if (fresh.length) await upsertAlbums(fresh);
    await saveToStore();
    await forceRefresh();
    result.imported = fresh.length;
    return result;
  }, [forceRefresh, remote]);

  // ── Sync Spotify ──────────────────────────────────────────────────────────
  // Local: fetch from Spotify on-device. Remote: start a server job and poll
  // it — same progress UI, same SyncResult shape.
  const syncFromSpotify = useCallback(async (clean = false): Promise<SyncResult> => {
    const token: CancellationToken = { cancelled: false };
    cancelTokenRef.current = token;

    if (remote) {
      setSpotifySync({ active: true, stage: 'albums', fetched: 0, total: 0 });
      try {
        const jobId = await startRemoteSync(serverUrl, clean);
        remoteJobRef.current = jobId;
        const result = await pollRemoteSync(
          serverUrl, jobId,
          (p) => setSpotifySync(p),
          token,
        );
        await forceRefresh();
        return result;
      } finally {
        remoteJobRef.current = null;
        setSpotifySync(IDLE_SYNC);
      }
    }

    if (clean) await clearLibrary();
    setSpotifySync({ active: true, stage: 'albums', fetched: 0, total: 0 });
    const result: SyncResult = { imported: 0, skipped: 0, existing: 0, errors: [] };

    try {
      const fetched = await fetchAllSavedAlbums(
        (p: FetchProgress) => setSpotifySync({ active: true, ...p }), token,
      );
      const existingIds: Set<string> = clean ? new Set() : await getExistingAlbumIds();
      const hiddenIds  = await getHiddenDuplicateIds();
      const total = fetched.length;

      // Prepare the rows first; the expensive part is the actual SQLite write,
      // which is now batched instead of one round-trip per album.
      const fresh: Album[] = [];
      for (const album of fetched) {
        if (hiddenIds.has(album.id)) {
          result.skipped++;
          continue;
        }
        if (existingIds.has(album.id)) {
          result.existing++;
          continue;
        }
        fresh.push({ ...album, image_path: '' });
      }

      const chunkSize = 100;
      const freshTotal = fresh.length;
      setSpotifySync({ active: true, stage: 'saving', fetched: 0, total });
      let saved = 0;
      for (let offset = 0; offset < freshTotal; offset += chunkSize) {
        if (token.cancelled) break;
        const chunk = fresh.slice(offset, offset + chunkSize);
        try {
          await upsertAlbums(chunk);
          result.imported += chunk.length;
          saved += chunk.length;
        } catch (e: any) {
          result.skipped += chunk.length;
          result.errors.push('Batch ' + offset + ': ' + (e?.message ?? e));
        }
        setSpotifySync({ active: true, stage: 'saving', fetched: Math.min(saved, total), total });
      }

      await saveToStore();
      await forceRefresh();
      return result;
    } catch (e) {
      if (e instanceof SyncCancelledError) {
        await saveToStore(); await forceRefresh(); return result;
      }
      throw e;
    } finally { setSpotifySync(IDLE_SYNC); }
  }, [forceRefresh, remote, serverUrl]);

  const cancelSync = useCallback(() => {
    cancelTokenRef.current.cancelled = true;
    // Remote: also cancel server-side immediately (the poll loop cancels on its next tick too).
    const jobId = remoteJobRef.current;
    if (remote && jobId) cancelRemoteJob(serverUrl, jobId).catch(() => {});
  }, [remote, serverUrl]);
  const clearAll = useCallback(async () => {
    if (remote) await clearRemoteLibrary(serverUrl);
    else await clearLibrary();
    await forceRefresh();
  }, [forceRefresh, remote, serverUrl]);
  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTER), []);

  // Drops all loaded state (account switch / logout) — the next query
  // repopulates from the current backend. Does not touch the server.
  const resetAll = useCallback(() => {
    cancelTokenRef.current.cancelled = true;
    remoteJobRef.current = null;
    offsetRef.current = 0;
    setAlbums([]); setTotal(0); setHasMore(false); setError(null);
    setGenres([]); setArtists([]); setYears([]); setStats(null);
    setFilters(DEFAULT_FILTER);
    setSpotifySync(IDLE_SYNC);
  }, []);

  const getAlbumsForDuplicateScan = useCallback(async (): Promise<Album[]> => {
    if (remote) return [];
    return getExportAlbums();
  }, [remote]);

  const deleteLocalAlbums = useCallback(async (ids: string[]): Promise<void> => {
    if (remote || !ids.length) return;
    await deleteAlbums(ids);
    await forceRefresh();
  }, [forceRefresh, remote]);

  return {
    albums, total, hasMore, loadingMore,
    genres, artists, years, stats,
    filters, loading, dbReady, syncing, spotifySync, error,
    refresh: forceRefresh, syncCSV, importAlbums, syncFromSpotify, cancelSync, clearAll,
    updateFilter, resetFilters, resetAll, loadMore, deleteLocalAlbums, getAlbumsForDuplicateScan,
  };
}
