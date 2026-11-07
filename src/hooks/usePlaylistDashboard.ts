import { useState, useEffect, useCallback, useRef } from 'react';
import { SpotifyPlaylist, getUserPlaylists, unfollowPlaylist } from '../services/SpotifyPlaylistService';
import { fetchPlaylistAlbums, PlaylistAlbum, PlaylistFetchProgress } from '../services/SpotifyPlaylistFeedService';
import {
  savePlaylistAlbums, loadPlaylistAlbums, countPlaylistAlbums,
  getPlaylistMeta, getCachedPlaylistIds, getPlaylistFilterOptions,
  exportPlaylistCSV, deletePlaylistCache, StoredPlaylistMeta,
} from '../services/PlaylistDatabaseService';
import { CancellationToken, SyncCancelledError } from '../services/SpotifyApiService';
import { FilterState } from '../types';
import { clearLocalRetention } from '../services/PlaylistRetentionService';
import { PAGE_SIZE } from '../services/DatabaseService';
import { useDebounce, yearStr } from '../utils/debounce';
import { DataSourceMode } from '../config/server';
import {
  listRemotePlaylists, queryRemotePlaylistAlbums, fetchRemotePlaylistMeta,
  startRemotePlaylistSync, pollRemotePlaylistSync,
  exportRemotePlaylist,
} from '../services/remote/playlistRemote';
import { cancelRemoteJob } from '../services/remote/libraryRemote';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FILTER: FilterState = {
  search: '', genre: '', artist: '', yearFrom: '', yearTo: '',
  sortField: 'added_at', sortOrder: 'desc',
  albumType: '', minPop: 0, maxPop: 100,
};

export interface PlaylistSyncState {
  active:  boolean;
  stage:   'tracks' | 'genres' | 'idle';
  fetched: number;
  total:   number;
}
const IDLE: PlaylistSyncState = { active: false, stage: 'idle', fetched: 0, total: 0 };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlaylistDashboard(ds: { mode: DataSourceMode; serverUrl: string; sessionActive: boolean }) {
  const remote = ds.mode === 'remote';
  const serverUrl = ds.serverUrl;
  // Same rule as useLibrary: don't probe the server before sign-in.
  const sessionReady = !remote || ds.sessionActive;

  const [playlists,        setPlaylists]        = useState<SpotifyPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError,   setPlaylistsError]   = useState('');
  const [cachedIds,        setCachedIds]        = useState<Set<string>>(new Set());
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string>>(new Set());
  const [playlistDeleteBusy, setPlaylistDeleteBusy] = useState(false);
  // Server synced_at per playlist id (remote picker badge + cache check).
  const syncedAtRef = useRef<Map<string, string>>(new Map());

  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylist | null>(null);
  const [playlistMeta,     setPlaylistMeta]     = useState<StoredPlaylistMeta | null>(null);

  const [albums,      setAlbums]      = useState<PlaylistAlbum[]>([]);
  const [total,       setTotal]       = useState(0);
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);

  const [genres,  setGenres]  = useState<string[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [years,   setYears]   = useState<number[]>([]);

  const [loading,   setLoading]   = useState(false);
  const [syncState, setSyncState] = useState<PlaylistSyncState>(IDLE);

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER);
  const dFilters = useDebounce(filters, 250);

  const cancelRef = useRef<CancellationToken>({ cancelled: false });
  const remoteJobRef = useRef<string | null>(null);

  // ── Load list of playlists ────────────────────────────────────────────────
  // Remote: live server list; cached badge comes from server synced_at.
  const loadPlaylists = useCallback(async () => {
    setPlaylistsLoading(true); setPlaylistsError('');
    try {
      if (remote) {
        const { playlists: list, syncedAt } = await listRemotePlaylists(serverUrl);
        syncedAtRef.current = syncedAt;
        setPlaylists(list);
        setCachedIds(new Set(syncedAt.keys()));
      } else {
        const [list, ids] = await Promise.all([getUserPlaylists(), getCachedPlaylistIds()]);
        setPlaylists(list);
        setCachedIds(ids);
      }
    } catch (e: any) {
      setPlaylistsError(e?.message ?? 'Failed to load playlists');
    } finally {
      setPlaylistsLoading(false);
    }
  }, [remote, serverUrl]);

  // ── Core query (resets list) ──────────────────────────────────────────────
  // Remote: single albums endpoint (items+total) plus meta options.
  const runQuery = useCallback(async (playlistId: string, f: FilterState) => {
    if (!sessionReady) return;
    setLoading(true);
    offsetRef.current = 0;
    try {
      if (remote) {
        const [page, opts] = await Promise.all([
          queryRemotePlaylistAlbums(serverUrl, playlistId, f, PAGE_SIZE, 0),
          fetchRemotePlaylistMeta(serverUrl, playlistId),
        ]);
        const sel = selectedPlaylistRef.current;
        offsetRef.current = page.albums.length;
        setAlbums(page.albums); setTotal(page.total); setHasMore(page.albums.length < page.total);
        setGenres(opts.genres); setArtists(opts.artists); setYears(opts.years);
        setPlaylistMeta(sel ? {
          id:          sel.id,
          name:        sel.name,
          image_url:   sel.images?.[0]?.url ?? '',
          track_count: sel.tracks.total,
          album_count: page.total,
          synced_at:   syncedAtRef.current.get(sel.id) ?? '',
        } : null);
      } else {
        const [first, cnt, opts, meta] = await Promise.all([
          loadPlaylistAlbums(
            playlistId, f.search, f.genre, f.sortField, f.sortOrder,
            yearStr(f.yearFrom), yearStr(f.yearTo), f.artist, PAGE_SIZE, 0,
          ),
          countPlaylistAlbums(
            playlistId, f.search, f.genre,
            yearStr(f.yearFrom), yearStr(f.yearTo), f.artist,
          ),
          getPlaylistFilterOptions(playlistId),
          getPlaylistMeta(playlistId),
        ]);
        offsetRef.current = first.length;
        setAlbums(first); setTotal(cnt); setHasMore(first.length < cnt);
        setGenres(opts.genres); setArtists(opts.artists); setYears(opts.years);
        setPlaylistMeta(meta);
      }
    } finally {
      setLoading(false);
    }
  }, [remote, serverUrl, sessionReady]);

  const selectedIdRef = useRef<string | null>(null);
  const selectedPlaylistRef = useRef<SpotifyPlaylist | null>(null);
  useEffect(() => {
    if (selectedIdRef.current) runQuery(selectedIdRef.current, dFilters);
  }, [dFilters, runQuery]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading || !selectedIdRef.current) return;
    setLoadingMore(true);
    try {
      const f = dFilters;
      const more = remote
        ? (await queryRemotePlaylistAlbums(
            serverUrl, selectedIdRef.current, f, PAGE_SIZE, offsetRef.current)).albums
        : await loadPlaylistAlbums(
            selectedIdRef.current, f.search, f.genre, f.sortField, f.sortOrder,
            yearStr(f.yearFrom), yearStr(f.yearTo), f.artist, PAGE_SIZE, offsetRef.current,
          );
      if (!more.length) { setHasMore(false); return; }
      offsetRef.current += more.length;
      setAlbums((prev) => [...prev, ...more]);
      setHasMore(offsetRef.current < total);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loading, dFilters, total, remote, serverUrl]);

  // ── Select a playlist: cached first, auto-sync when not cached ────────────
  // Remote: "cached" means the server reports synced_at for it.
  const selectPlaylist = useCallback(async (playlist: SpotifyPlaylist) => {
    selectedIdRef.current = playlist.id;
    selectedPlaylistRef.current = playlist;
    setSelectedPlaylist(playlist);
    setFilters(DEFAULT_FILTER);
    setAlbums([]); setTotal(0); setHasMore(false);

    if (remote) {
      const cached = syncedAtRef.current.has(playlist.id);
      if (cached) await runQuery(playlist.id, DEFAULT_FILTER);
      else await syncPlaylist(playlist);
      return;
    }

    const meta = await getPlaylistMeta(playlist.id);
    if (meta && meta.album_count > 0) {
      // Cached — load from DB immediately
      await runQuery(playlist.id, DEFAULT_FILTER);
    } else {
      // Not cached — auto-sync from Spotify
      await syncPlaylist(playlist);
    }
  }, [runQuery, remote, serverUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync / re-sync ──────────────────────────────────────────────────────
  // Remote: start a server job and poll it — same progress UI.
  const syncPlaylist = useCallback(async (playlist: SpotifyPlaylist) => {
    selectedIdRef.current = playlist.id;
    selectedPlaylistRef.current = playlist;
    setSyncState({ active: true, stage: 'tracks', fetched: 0, total: playlist.tracks.total });

    if (remote) {
      const token: CancellationToken = { cancelled: false };
      cancelRef.current = token;
      try {
        const jobId = await startRemotePlaylistSync(serverUrl, playlist.id);
        remoteJobRef.current = jobId;
        await pollRemotePlaylistSync(
          serverUrl, jobId,
          (p) => setSyncState(p),
          token,
        );
        // Refresh cache markers (synced_at) then reload the grid.
        try {
          const { syncedAt } = await listRemotePlaylists(serverUrl);
          syncedAtRef.current = syncedAt;
          setCachedIds(new Set(syncedAt.keys()));
        } catch { /* non-critical */ }
      } catch (e) {
        if (e instanceof SyncCancelledError) {
          // Partial data may exist — reload what's there (fall through)
        } else throw e;
      } finally {
        remoteJobRef.current = null;
        setSyncState(IDLE);
      }
      if (selectedIdRef.current) await runQuery(selectedIdRef.current, DEFAULT_FILTER);
      setFilters(DEFAULT_FILTER);
      return;
    }

    const token: CancellationToken = { cancelled: false };
    cancelRef.current = token;
    try {
      const fetched = await fetchPlaylistAlbums(
        playlist.id,
        (p: PlaylistFetchProgress) => setSyncState({ active: true, ...p }),
        token,
      );
      await savePlaylistAlbums(
        playlist.id,
        { name: playlist.name, image_url: playlist.images?.[0]?.url ?? '', track_count: playlist.tracks.total },
        fetched,
      );
      setCachedIds((prev) => new Set([...prev, playlist.id]));
      await runQuery(playlist.id, DEFAULT_FILTER);
      setFilters(DEFAULT_FILTER);
    } catch (e) {
      if (e instanceof SyncCancelledError) {
        // Partial data may exist — reload what's there
        if (selectedIdRef.current) await runQuery(selectedIdRef.current, DEFAULT_FILTER);
      } else throw e;
    } finally {
      setSyncState(IDLE);
    }
  }, [runQuery, remote, serverUrl]);

  const cancelFetch = useCallback(() => {
    cancelRef.current.cancelled = true;
    const jobId = remoteJobRef.current;
    if (remote && jobId) cancelRemoteJob(serverUrl, jobId).catch(() => {});
  }, [remote, serverUrl]);

  const clearPlaylist = useCallback(() => {
    cancelRef.current.cancelled = true;
    remoteJobRef.current = null;
    selectedIdRef.current = null;
    selectedPlaylistRef.current = null;
    setSelectedPlaylist(null); setPlaylistMeta(null);
    setAlbums([]); setTotal(0); setHasMore(false);
    setSyncState(IDLE); setFilters(DEFAULT_FILTER);
  }, []);

  const togglePlaylistSelection = useCallback((id: string) => {
    setSelectedPlaylistIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearPlaylistSelection = useCallback(() => {
    setSelectedPlaylistIds(new Set());
  }, []);

  const deleteSelectedPlaylists = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    if (remote) {
      setPlaylistsError('Playlist deletion is currently local-only.');
      return;
    }
    setPlaylistDeleteBusy(true);
    setPlaylistsError('');
    try {
      for (const id of ids) {
        await unfollowPlaylist(id);
        await clearLocalRetention(id);
        await deletePlaylistCache(id);
      }
      setPlaylists((prev) => prev.filter((p) => !ids.includes(p.id)));
      setSelectedPlaylistIds(new Set());
      await loadPlaylists();
    } catch (e: any) {
      setPlaylistsError(e?.message ?? 'Could not delete selected playlists.');
    } finally {
      setPlaylistDeleteBusy(false);
    }
  }, [loadPlaylists]);

  // Switching data source drops the selection (backends differ) — user re-picks.
  const modeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = ds.mode + '|' + ds.serverUrl;
    if (modeKeyRef.current === null) { modeKeyRef.current = key; return; }
    if (modeKeyRef.current !== key) {
      modeKeyRef.current = key;
      clearPlaylist();
      setPlaylists([]); setCachedIds(new Set());
    }
  });

  // ── Export CSV ────────────────────────────────────────────────────────────
  const exportCSV = useCallback(async (): Promise<{ path: string; bytes: number } | null> => {
    if (!selectedPlaylist) return null;
    if (remote) return exportRemotePlaylist(serverUrl, selectedPlaylist.id, selectedPlaylist.name);
    return exportPlaylistCSV(selectedPlaylist.id, selectedPlaylist.name);
  }, [selectedPlaylist, remote, serverUrl]);

  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTER), []);

  // Drops everything including the list + per-user cache markers (account
  // switch / logout) — the next loadPlaylists repopulates for the new user.
  const resetAll = useCallback(() => {
    clearPlaylist();
    syncedAtRef.current = new Map();
    setPlaylists([]); setCachedIds(new Set()); setPlaylistsError('');
    setGenres([]); setArtists([]); setYears([]);
  }, [clearPlaylist]);

  return {
    playlists, playlistsLoading, playlistsError, cachedIds, loadPlaylists,
    selectedPlaylistIds, togglePlaylistSelection, clearPlaylistSelection, deleteSelectedPlaylists, playlistDeleteBusy,
    selectedPlaylist, playlistMeta, selectPlaylist, clearPlaylist,
    syncPlaylist, cancelFetch, syncState,
    albums, total, hasMore, loadingMore, loading,
    genres, artists, years,
    filters, updateFilter, resetFilters, resetAll, loadMore,
    exportCSV,
  };
}
