import React, { useState, useEffect, useCallback } from 'react';
import { Header }                from './components/Header';
import { StatsBar }              from './components/StatsBar';
import { FilterBar }             from './components/FilterBar';
import { AlbumGrid }             from './components/AlbumGrid';
import { EmptyState }            from './components/EmptyState';
import { SyncModal }             from './components/SyncModal';
import { LoginScreen }           from './components/LoginScreen';
import { SpotifyCredentialsScreen } from './components/SpotifyCredentialsScreen';
import { ServerLoginScreen }     from './components/ServerLoginScreen';
import { SpotifyLinkScreen }     from './components/SpotifyLinkScreen';
import { SelectionToolbar }      from './components/SelectionToolbar';
import { PlaylistModal }         from './components/PlaylistModal';
import { PlaylistPicker }        from './components/PlaylistPicker';
import { AlbumTrackSheet }         from './components/AlbumTrackSheet';
import { RetentionDialog }         from './components/RetentionDialog';
import { PlaylistDashboardView } from './components/PlaylistDashboardView';
import { SyncProgress }         from './components/SyncProgress';
import { PlayerView }           from './components/PlayerView';
import { useLibrary }           from './hooks/useLibrary';
import { StatsPanel }           from './components/StatsPanel';
import { SettingsView }         from './components/SettingsView';
import { DuplicatesDialog }     from './components/DuplicatesDialog';
import { AddFromSiteDialog }  from './components/AddFromSiteDialog';
import { ArtistDiscographyDialog } from './components/ArtistDiscographyDialog';
import { findDuplicates }         from './utils/duplicateFinder';
import type { DuplicateGroup, DuplicateAlbum } from './utils/duplicateFinder';
import { getHiddenDuplicateAlbums, hideDuplicateAlbums, restoreHiddenDuplicates, unhideDuplicateIds } from './utils/duplicateBlocklist';
import { SyncPhotosProvider }     from './contexts/SyncPhotosContext';
import { getExportAlbums, getExistingAlbumIds, upsertAlbum, saveToStore } from './services/DatabaseService';
import { exportRemoteBackup }   from './services/remote/libraryRemote';
import { useSpotifyAuth }       from './hooks/useSpotifyAuth';
import { useDataSource }        from './hooks/useDataSource';
import { useServerAuth }        from './hooks/useServerAuth';
import { useSelection }         from './hooks/useSelection';
import { useToast }             from './hooks/useToast';
import { useBackupSettings }    from './hooks/useBackupSettings';
import { Preferences } from '@capacitor/preferences';
import { usePlaylistDashboard } from './hooks/usePlaylistDashboard';
import { usePlayerQueue }       from './hooks/usePlayerQueue';
// Local librespot playback has been replaced by the Web Playback SDK player.
import { Artwork }              from './components/Artwork';
import { addAlbumsToQueue }     from './services/SpotifyPlaylistService';
import { removeSavedAlbums, getSavedAlbumArtistIds, areArtistsFollowed, followArtists } from './services/SpotifyApiService';
import { removeRemoteAlbumsFromPlaylist } from './services/remote/playlistRemote';
import { deletePlaylistAlbums } from './services/PlaylistDatabaseService';
import { getValidAccessToken }   from './services/SpotifyAuthService';
import { loadSpotifyCredentials, hasSpotifyCredentials } from './services/SpotifyCredentialsService';
import { initWebPlaybackSdk, disconnectWebPlaybackSdk } from './services/WebPlaybackSdkService';
import { SPOTIFY_API_URL }      from './config/spotify';
import {
  getLocalRetention, getLocalRetentionFor,
  startRetentionScheduler,
} from './services/PlaylistRetentionService';
import {
  listRemoteRetention,
} from './services/remote/retentionRemote';
import { queueRemoteAlbums }    from './services/remote/playlistRemote';
import { describeRemoteError }   from './services/errorCodes';
import { exportBackup }         from './services/ExportService';
import { Album, ViewMode }       from './types';
import { PlaylistAlbum }          from './services/SpotifyPlaylistFeedService';

type ActiveModal = 'sync' | 'playlist' | 'pl-playlist' | null;
type ActiveTab   = 'library' | 'playlists' | 'tools' | 'settings' | 'player';

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function App() {
  const auth   = useSpotifyAuth();
  const [showCreds, setShowCreds] = useState(false);
  const [credsVersion, setCredsVersion] = useState(0);

  useEffect(() => { void loadSpotifyCredentials(); }, []);

  // Auto-load the official Web Playback SDK as soon as this device has a
  // Spotify login. This registers the browser player without starting or
  // transferring playback; playback is only moved by explicit user actions.
  useEffect(() => {
    if (auth.authState !== 'authenticated') {
      disconnectWebPlaybackSdk();
      return;
    }
    void initWebPlaybackSdk(async () => getValidAccessToken()).catch(() => {});
  }, [auth.authState]);
  const ds     = useDataSource();
  const srv    = useServerAuth(ds.settings.serverUrl, ds.settings.mode === 'remote');
  // Remote library/playlist queries start only once the server session is
  // authenticated — otherwise they 401 at boot and leave a stale error banner
  // after sign-in.
  const sessionActive = ds.settings.mode !== 'remote' || srv.authState === 'authenticated';
  const lib    = useLibrary({ mode: ds.settings.mode, serverUrl: ds.settings.serverUrl, sessionActive });
  const sel    = useSelection<Album>(lib.albums);
  const { toasts, show: showToast } = useToast();
  const backup = useBackupSettings();
  const pld    = usePlaylistDashboard({ mode: ds.settings.mode, serverUrl: ds.settings.serverUrl, sessionActive });
  const isRemote = ds.settings.mode === 'remote';
  const remoteOpt = isRemote ? { serverUrl: ds.settings.serverUrl } : null;

  const openPlaylistId = pld.selectedPlaylist?.id ?? null;

  const refreshPlaylistRetention = useCallback(async () => {
    if (!openPlaylistId) { setPlRetention(null); return; }
    try {
      if (isRemote) {
        const rows = await listRemoteRetention(ds.settings.serverUrl);
        setPlRetention(rows.find((r: any) => r.playlist_id === openPlaylistId)?.expires_at ?? null);
      } else {
        const local = await getLocalRetentionFor(openPlaylistId);
        setPlRetention(local?.expiresAt ?? null);
      }
    } catch { setPlRetention(null); }
  }, [openPlaylistId, isRemote, ds.settings.serverUrl]);

  useEffect(() => { void refreshPlaylistRetention(); }, [refreshPlaylistRetention]);

  useEffect(() => {
    if (isRemote) return;
    const stop = startRetentionScheduler((r: any) => {
      if (r.deleted > 0) {
        showToast('Deleted ' + r.deleted + ' expired playlist' + (r.deleted === 1 ? '' : 's'));
        void pld.loadPlaylists();
        void refreshPlaylistRetention();
      }
    });
    return stop;
  }, [isRemote, pld, refreshPlaylistRetention]);

  const plSel = useSelection<PlaylistAlbum>(pld.albums);
  // The Player tab's merge action is global: a selection can come from the
  // library board or from an open playlist board, and both are valid albums.
  const playerSelected = React.useMemo(
    () => new Set([...sel.selected, ...plSel.selected]),
    [sel.selected, plSel.selected],
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>('library');
  const queueAvailable = auth.authState === 'authenticated';
  const player = usePlayerQueue({
    enabled:   activeTab === 'player',
    authState: auth.authState,
    onMessage: showToast,
    onPlaylistsChanged: () => { void pld.loadPlaylists(); },
  });
  // Account switch / logout drops all loaded state — cached playlist markers

  // and grids are per-user and would otherwise leak across accounts.
  const wasAuthedRef = React.useRef(false);
  useEffect(() => {
    const authed = isRemote
      ? srv.authState === 'authenticated'
      : auth.authState === 'authenticated';
    if (wasAuthedRef.current && !authed) {
      lib.resetAll();
      pld.resetAll();
      player.resetAll();
      sel.clear();
      plSel.clear();
    }
    wasAuthedRef.current = authed;
  }, [isRemote, srv.authState, auth.authState]); // eslint-disable-line react-hooks/exhaustive-deps

  const [modal,       setModal]       = useState<ActiveModal>(null);
  const [queueBusy,   setQueueBusy]   = useState(false);
  const [removeBusy,  setRemoveBusy]  = useState(false);
  const [plQueueBusy, setPlQueueBusy] = useState(false);
  const [gridSize,    setGridSize]    = useState(160);
  const [viewMode,     setViewMode]     = useState<ViewMode>('grid');
  const [playlistViewMode, setPlaylistViewMode] = useState<ViewMode>('grid');
  const [autohideNav, setAutohideNav]       = useState(true);
  const [autohideBoardBar, setAutohideBoardBar] = useState(false);
  const [navHidden, setNavHidden]   = useState(false);
  const [syncPhotos, setSyncPhotos] = useState(true);
  const [dupesOpen, setDupesOpen] = useState(false);
  const [addFromSiteOpen, setAddFromSiteOpen] = useState(false);
  const [discographyOpen, setDiscographyOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[] | null>(null);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [hiddenDuplicateAlbums, setHiddenDuplicateAlbums] = useState<DuplicateAlbum[]>([]);
  const [plRemoveBusy, setPlRemoveBusy] = useState(false);
  const [trackAlbum, setTrackAlbum]         = useState<Album | PlaylistAlbum | null>(null);
  const [trackAlbumPlaylistId, setTrackAlbumPlaylistId] = useState<string | null>(null);
  const [retentionFor, setRetentionFor]     = useState<{ playlist: any; current: string | null } | null>(null);
  const [plRetention,  setPlRetention]      = useState<string | null>(null);
  const navShouldHide = autohideNav && navHidden && !modal && !trackAlbum && !retentionFor && !discographyOpen;
  useEffect(() => { document.body.classList.toggle('board-autohide-bar', autohideBoardBar && navHidden); }, [autohideBoardBar, navHidden]);
  useEffect(() => { document.body.classList.toggle('photo-sync-off', !syncPhotos); }, [syncPhotos]);

  // Grid size persists across restarts (mirrors useBackupSettings).
  useEffect(() => {
    Preferences.get({ key: 'grid_size' })
      .then(({ value }) => {
        const n = parseInt(value ?? '', 10);
        if (Number.isFinite(n)) setGridSize(Math.min(280, Math.max(80, n)));
      })
      .catch(() => {});
  }, []);

  // View mode (grid / list / compact) persists too.
  useEffect(() => {
    Preferences.get({ key: 'view_mode' })
      .then(({ value }) => {
        if (value === 'grid' || value === 'list' || value === 'compact') setViewMode(value);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Preferences.get({ key: 'playlist_view_mode' })
      .then(({ value }) => {
        if (value === 'grid' || value === 'list' || value === 'compact') setPlaylistViewMode(value);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Preferences.get({ key: 'autohide_nav' })
      .then(({ value }) => { if (value !== null) setAutohideNav(value === 'true'); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    Preferences.get({ key: 'autohide_board_bar' })
      .then(({ value }) => { if (value !== null) setAutohideBoardBar(value === 'true'); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    Preferences.get({ key: 'sync_photos' })
      .then(({ value }) => { if (value !== null) setSyncPhotos(value === 'true'); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    getHiddenDuplicateAlbums().then((albums) => setHiddenDuplicateAlbums(albums)).catch(() => {});
  }, []);

  const handleToggleAutohide = useCallback((on: boolean) => {
    setAutohideNav(on);
    Preferences.set({ key: 'autohide_nav', value: String(on) }).catch(() => {});
  }, []);

  const handleToggleBoardAutohide = useCallback((on: boolean) => {
    setAutohideBoardBar(on);
    Preferences.set({ key: 'autohide_board_bar', value: String(on) }).catch(() => {});
  }, []);

  const handleToggleSyncPhotos = useCallback((on: boolean) => {
    setSyncPhotos(on);
    Preferences.set({ key: 'sync_photos', value: String(on) }).catch(() => {});
  }, []);

  const runDuplicateScan = useCallback(async () => {
    if (ds.settings.mode === 'remote') {
      setDupesOpen(true);
      setDuplicateGroups([]);
      setHiddenDuplicateAlbums([]);
      showToast('Duplicate cleanup is available in local mode only.', false);
      return;
    }
    setDupesOpen(true);
    setDuplicatesLoading(true);
    setDuplicateGroups(null);
    try {
      const hidden = await getHiddenDuplicateAlbums();
      setHiddenDuplicateAlbums(hidden);
      const hiddenIds = new Set(hidden.map((a) => a.id));
      const all = await lib.getAlbumsForDuplicateScan();
      setDuplicateGroups(findDuplicates(all.filter((album) => !hiddenIds.has(album.id))));
    } catch (e: any) {
      showToast(e?.message ?? 'Could not scan for duplicates.', false);
      setDuplicateGroups([]);
    } finally { setDuplicatesLoading(false); }
  }, [ds.settings.mode, lib, showToast]);

  const handleDuplicateRemove = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const selected = (duplicateGroups ?? []).flatMap((group) => group.albums).filter((album) => ids.includes(album.id));
    await hideDuplicateAlbums(selected);
    await lib.deleteLocalAlbums(ids);
    const hidden = await getHiddenDuplicateAlbums();
    setHiddenDuplicateAlbums(hidden);
    const hiddenIds = new Set(hidden.map((a) => a.id));
    const all = await lib.getAlbumsForDuplicateScan();
    setDuplicateGroups(findDuplicates(all.filter((album) => !hiddenIds.has(album.id))));
  }, [duplicateGroups, lib]);

  const handleDuplicateRemovePermanent = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const confirmed = window.confirm(
      'This will permanently remove ' + ids.length + ' album(s) from your Spotify library. Continue?',
    );
    if (!confirmed) return;
    try {
      await removeSavedAlbums(ids);
    } catch (e: any) {
      showToast(e?.message ?? 'Could not remove albums from Spotify.', false);
      return;
    }
    try { await lib.deleteLocalAlbums(ids); } catch { /* best effort */ }
    const hidden = await getHiddenDuplicateAlbums();
    const hiddenIds = new Set(hidden.map((a) => a.id));
    const all = await lib.getAlbumsForDuplicateScan();
    setDuplicateGroups(findDuplicates(all.filter((album) => !hiddenIds.has(album.id))));
    showToast(`Permanently removed ${ids.length} duplicate album(s) from Spotify.`, true);
  }, [lib]);

  const handleRemoveSelectedFromLibrary = useCallback(async () => {
    const ids = [...sel.selected];
    if (!ids.length) return;
    const confirmed = window.confirm(
      'This will permanently remove ' + ids.length + ' album(s) from your Spotify library. Continue?',
    );
    if (!confirmed) return;
    setRemoveBusy(true);
    try {
      await removeSavedAlbums(ids);
    } catch (e: any) {
      showToast(e?.message ?? 'Could not remove albums from Spotify.', false);
      setRemoveBusy(false);
      return;
    }
    try { await lib.deleteLocalAlbums(ids); } catch { /* best effort */ }
    sel.clear();
    showToast('Permanently removed ' + ids.length + ' album(s) from Spotify.', true);
    setRemoveBusy(false);
  }, [sel, lib, showToast]);

  const handleFollowLibraryArtists = useCallback(async () => {
    const confirmed = window.confirm(
      'This will follow all artists from your Spotify saved albums that you do not already follow. Continue?',
    );
    if (!confirmed) return;
    setFollowBusy(true);
    let total = 0;
    let already = 0;
    let followed = 0;
    try {
      const ids = await getSavedAlbumArtistIds();
      total = ids.length;
      if (!ids.length) {
        showToast('No artists found in your saved Spotify albums.', true);
        return;
      }
      const followedBefore = await areArtistsFollowed(ids);
      already = followedBefore.size;
      const toFollow = ids.filter((id) => !followedBefore.has(id));
      if (!toFollow.length) {
        showToast(`Already following all ${total} artist(s).`, true);
        return;
      }
      await followArtists(toFollow);
      followed = toFollow.length;
      showToast(`Followed ${followed} new artist(s) (${already} already, ${total} total).`, true);
    } catch (e: any) {
      showToast(e?.message ?? 'Could not follow artists.', false);
    } finally {
      setFollowBusy(false);
    }
  }, [showToast]);

  const handleGetLibraryAlbumIds = useCallback(async (): Promise<Set<string>> => {
    if (isRemote) return new Set<string>();
    return getExistingAlbumIds();
  }, [isRemote]);

  const handleDuplicateRestore = useCallback(async () => {
    try {
      const restored = await restoreHiddenDuplicates();
      for (const album of restored) {
        await upsertAlbum({
          id: album.id,
          title: album.title,
          artist: album.artist,
          year: album.year,
          genre: album.genre ?? '',
          image_url: album.image_url ?? '',
          image_path: album.image_path ?? '',
          added_at: album.added_at ?? '',
          album_type: album.album_type ?? '',
          popularity: album.popularity ?? null,
          spotify_url: album.spotify_url ?? '',
        });
      }
      await saveToStore();
      await lib.refresh();
      setHiddenDuplicateAlbums([]);
      const all = await lib.getAlbumsForDuplicateScan();
      setDuplicateGroups(findDuplicates(all));
      showToast(`Restored ${restored.length} hidden duplicate album(s).`, true);
    } catch (e: any) {
      showToast(e?.message ?? 'Could not restore hidden albums.', false);
    }
  }, [lib, showToast]);
  const handleRemoveSelectedFromPlaylist = useCallback(async () => {
    const pid = pld.selectedPlaylist?.id;
    if (!pid || plSel.selected.size === 0) return;
    const count = plSel.selected.size;
    if (!window.confirm(`Remove ${count} selected album(s) from this playlist? This cannot be undone on Spotify.`)) return;
    setPlRemoveBusy(true);
    try {
      const ids = [...plSel.selected];
      if (isRemote) {
        await removeRemoteAlbumsFromPlaylist(ds.settings.serverUrl, pid, ids);
      } else {
        const token = await getValidAccessToken();
        if (!token) throw new Error('Connect Spotify on this device.');
        for (const albumId of ids) {
          const res = await fetch(SPOTIFY_API_URL + '/albums/' + encodeURIComponent(albumId) + '/tracks?limit=50', {
            headers: { Authorization: 'Bearer ' + token },
          });
          if (!res.ok) throw new Error('Could not load tracks for ' + albumId + ' (' + res.status + ')');
          const data = await res.json();
          const uris = ((data.items ?? []) as any[]).map((track: any) => track.uri).filter(Boolean);
          for (let i = 0; i < uris.length; i += 100) {
            const del = await fetch(SPOTIFY_API_URL + '/playlists/' + encodeURIComponent(pid) + '/tracks', {
              method: 'DELETE',
              headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ tracks: uris.slice(i, i + 100).map((uri) => ({ uri })) }),
            });
            if (!del.ok) throw new Error('Could not remove tracks for ' + albumId + ' (' + del.status + ').');
          }
        }
        await deletePlaylistAlbums(pid, ids);
      }
      plSel.clear();
      await pld.syncPlaylist(pld.selectedPlaylist!);
      showToast('Removed ' + count + ' album(s) from the playlist.', true);
    } catch (e: any) {
      showToast(e?.message ?? 'Remove failed.', false);
    } finally { setPlRemoveBusy(false); }
  }, [pld.selectedPlaylist, plSel, isRemote, ds.settings.serverUrl]);
  const handleGridSize = useCallback((n: number) => {
    setGridSize(n);
    Preferences.set({ key: 'grid_size', value: String(n) }).catch(() => {});
  }, []);

  const handleViewMode = useCallback((m: ViewMode) => {
    setViewMode(m);
    Preferences.set({ key: 'view_mode', value: m }).catch(() => {});
  }, []);

  const handlePlaylistViewMode = useCallback((m: ViewMode) => {
    setPlaylistViewMode(m);
    Preferences.set({ key: 'playlist_view_mode', value: m }).catch(() => {});
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      if (Math.abs(delta) < 10) return;
      setNavHidden(delta > 0 && y > 80);
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Switch tabs — always reset scroll position so tabs don't share it
  const switchTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  const handleTabPlaylists = () => {
    switchTab('playlists');
    if (!pld.playlistsLoading) {
      void pld.loadPlaylists();
    }
  };

  // ── Online/offline (remote mode needs a connection) ──────────────────────
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline  = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const remoteOffline = ds.settings.mode === 'remote' && !online;

  // ── Queue handlers (dual-mode) ───────────────────────────────────────────
  // Remote: queue job on the server (no cap, live progress server-side).
  const handleQueue = async () => {
    setQueueBusy(true);
    try {
      const ids = [...sel.selected];
      const { success, failed, error } = isRemote
        ? await queueRemoteAlbums(ds.settings.serverUrl, ids)
        : await addAlbumsToQueue(sel.selectedAlbums);
      if (success === 0) showToast(error ?? 'Open Spotify on a device first', false);
      else { showToast('Added ' + success + ' tracks to queue' + (failed ? ' (' + failed + ' failed)' : '')); sel.clear(); }
    } catch (e: any) {
      showToast(describeRemoteError(e, 'Queue failed'), false);
    } finally { setQueueBusy(false); }
  };

  // ── Playlist-dashboard queue ─────────────────────────────────────────────
  const handlePlQueue = async () => {
    setPlQueueBusy(true);
    try {
      const ids = [...plSel.selected];
      const { success, failed, error } = isRemote
        ? await queueRemoteAlbums(ds.settings.serverUrl, ids)
        // PlaylistAlbum is structurally compatible with the Album id field addAlbumsToQueue needs
        : await addAlbumsToQueue(plSel.selectedAlbums as unknown as Album[]);
      if (success === 0) showToast(error ?? 'Open Spotify on a device first', false);
      else { showToast('Added ' + success + ' tracks to queue' + (failed ? ' (' + failed + ' failed)' : '')); plSel.clear(); }
    } catch (e: any) {
      showToast(describeRemoteError(e, 'Queue failed'), false);
    } finally { setPlQueueBusy(false); }
  };

  // ── Player / queue-playlist handlers ─────────────────────────────────────
  // All playback and queue-playlist calls use the on-device Spotify token.
  // In media-server mode the library still comes from the server, but the
  // Player tab needs a Spotify login on this device.
  const confirmQueueAction = (title: string, body: string, action: () => void) => {
    if (window.confirm(`${title}\n\n${body}`)) action();
  };

  const requestLocalCreate = (albumIds: string[]) => {
    confirmQueueAction(
      'Create local queue playlist?',
      'This creates one private playlist from what is playing now (plus any selected albums) and starts it. The current track is cut off.',
      () => { void player.createLocalQueue(albumIds, false); },
    );
  };

  const requestLocalReset = () => {
    if (!player.localQueue) {
      showToast('There is no local queue playlist to reset.', false);
      return;
    }
    confirmQueueAction(
      'Reset local queue playlist?',
      'Rebuilds the queue from the unplayed remainder of the current local queue. The old queue playlist is removed once the new one plays.',
      () => { void player.createLocalQueue([], true); },
    );
  };

  const requestLocalClear = () => {
    confirmQueueAction(
      'Clear local queue?',
      'Creates an empty local queue playlist. The previous queue playlist is kept on Spotify.',
      () => { void player.clearLocalQueue(); },
    );
  };

  const requestMergeCreate = () => {
    confirmQueueAction(
      'Create queue playlist?',
      'Creates one private playlist from the current Spotify queue and starts it immediately. The current track is cut off.',
      () => { void player.createMergeQueue([], false, false); },
    );
  };

  const requestMergeNew = () => {
    confirmQueueAction(
      'New queue playlist?',
      'Starts a brand-new queue from what is playing now. The old queue playlist is removed once the new one plays.',
      () => { void player.createMergeQueue([], false, true); },
    );
  };

  const requestMergeReset = () => {
    if (!player.localQueue) {
      showToast('Create a local queue playlist first, then reset/merge Spotify into it.', false);
      return;
    }
    confirmQueueAction(
      'Reset local queue + merge Spotify queue?',
      "Resets the local queue to the current track, then appends Spotify's current queue after it. No separate merge playlist is created. Skipped if playback already uses the local queue. Note: Spotify exposes at most 20 upcoming tracks, so only those can be merged.",
      () => { void (async () => {
        try {
          const { getCurrentPlayback, getQueue } = await import('./services/SpotifyPlaybackService');
          const snapshot = await getCurrentPlayback();
          if (snapshot?.context?.uri === `spotify:playlist:${player.localQueue?.playlistId ?? ''}`) {
            showToast('Playback already uses the local queue; nothing more to merge.', false);
            return;
          }
          // Capture Spotify's queue while it is still the active context, before this
          // switches playback to the local queue.
          const queued = await getQueue();
          const uris = queued.map((track: { uri: string }) => track.uri).filter((uri: string) => {
            const trimmed = (uri ?? '').trim();
            return trimmed.length > 0 && (trimmed.startsWith('spotify:track:') || trimmed.startsWith('spotify:episode:'));
          });

          if (uris.length === 0) {
            showToast('No Spotify queue to merge into the local queue.', false);
            return;
          }

          const startIndex = player.localCursor?.index ?? 0;
          await player.addTrackUrisToLocalQueue(uris, true);
          await player.playLocalQueueAt(startIndex);
          showToast(`Appended ${uris.length} Spotify track(s) to the local queue and reset playback to it (Spotify queue cap: 20).`);
        } catch (error) {
          showToast(error instanceof Error ? error.message : 'Reset/merge failed.', false);
        }
      })(); },
    );
  };

  const handleAddSelectedToMerge = () => {
    if (playerSelected.size === 0) {
      showToast('Select at least one album first.', false);
      return;
    }
    void player.addToMergeQueue([...playerSelected]);
  };

  // ── Sync ─────────────────────────────────────────────────────────────────
  const handleSyncSpotify = async (clean: boolean) => {
    const result = await lib.syncFromSpotify(clean);
    if (backup.settings.enabled && (result.imported > 0 || clean)) {
      try {
        if (isRemote) {
          const filename = await exportRemoteBackup(ds.settings.serverUrl);
          showToast('Backup downloaded: ' + filename);
        } else {
          const br = await exportBackup(await getExportAlbums(), backup.settings.subdirName);
          if (br) {
            backup.recordBackup(br.path);
            showToast('Backup saved' + (br.bytes > 0 ? ' (' + Math.round(br.bytes / 1024) + ' KB)' : ''));
          }
        }
      } catch (e: any) { showToast('Backup failed: ' + (e?.message ?? e), false); }
    }
    return result;
  };

  // Settings → Backup: export the whole library (local: every row; remote: server CSV).
  const handleExportNow = async () => {
    if (isRemote) {
      const filename = await exportRemoteBackup(ds.settings.serverUrl);
      showToast('Exported ' + filename);
      return;
    }
    const br = await exportBackup(await getExportAlbums(), backup.settings.subdirName);
    if (br) {
      backup.recordBackup(br.path);
      showToast('Backup saved' + (br.bytes > 0 ? ' (' + Math.round(br.bytes / 1024) + ' KB)' : ''));
    }
  };

  const handlePlaylistExport = async () => {
    try {
      const result = await pld.exportCSV();
      if (result) {
        showToast(
          result.path === '(browser download)'
            ? 'CSV downloaded'
            : 'Saved: ' + result.path.split('/').pop(),
        );
      }
    } catch (e: any) { showToast(e?.message ?? 'Export failed', false); }
  };

  if (auth.authState === 'loading') return <Splash />;
  if (showCreds) return <SpotifyCredentialsScreen onBack={() => setShowCreds(false)} onSaved={() => { setShowCreds(false); setCredsVersion(v => v + 1); }} />;
  if (srv.authState === 'loading' && ds.settings.mode === 'remote') return <Splash />;
  if (ds.settings.mode === 'remote') {
    if (srv.authState === 'unauthenticated') {
      return <ServerLoginScreen auth={srv} serverUrl={ds.settings.serverUrl} onSetServerUrl={ds.setServerUrl} onBack={() => ds.setMode('local')} />;
    }
    if (!srv.spotify.connected) {
      return <SpotifyLinkScreen auth={srv} onBack={() => ds.setMode('local')} />;
    }
  } else if (auth.authState === 'unauthenticated') {
    if (!hasSpotifyCredentials()) {
      return <SpotifyCredentialsScreen onBack={() => {}} onSaved={() => setCredsVersion(v => v + 1)} />;
    }
    return <LoginScreen onLogin={auth.login} error={auth.error} onConfigure={() => setShowCreds(true)} />;
  }

  const isBusy          = lib.syncing || lib.spotifySync.active || queueBusy;
  const hasActiveFilter = !!(lib.filters.search || lib.filters.genre || lib.filters.artist ||
                              lib.filters.yearFrom !== '' || lib.filters.yearTo !== '' ||
                              lib.filters.albumType !== '' || lib.filters.minPop > 0 || lib.filters.maxPop < 100);
  const showLibFilters  = lib.dbReady && (lib.albums.length > 0 || hasActiveFilter || lib.genres.length > 0);

  // Reflect selection from EITHER tab so bottom padding / toolbar spacing applies
  const hasSelection = sel.selected.size > 0 || plSel.selected.size > 0;
  const hasLocalMini = false;

  return (
    <SyncPhotosProvider value={syncPhotos}>
    <div className={'app ' + (hasSelection ? 'app--has-selection ' : '') + (hasSelection && queueAvailable ? 'app--queue-controls ' : '') + (hasLocalMini ? 'app--local-mini' : '')}>
      <Header
        stats={lib.stats}
        onSyncClick={() => setModal('sync')}
        onLogout={auth.logout}
        syncing={isBusy}
        activeTab={activeTab}
      />

      <main className="main-content">
        {/* ── Library tab ─────────────────────────────────────── */}
        {activeTab === 'library' && (
          <>
            {lib.error && <div className="error-banner" role="alert">&#x26A0; {lib.error}</div>}
            {remoteOffline && (
              <div className="error-banner" role="alert">
                &#x26A0; Offline — media-server mode needs a connection. Switch to “On this device” in Settings → Server to browse locally.
              </div>
            )}
            {lib.spotifySync.active && <SyncProgress sync={lib.spotifySync} onCancel={lib.cancelSync} />}
            {lib.stats && <StatsBar stats={lib.stats} />}
            {showLibFilters && (
              <FilterBar
                filters={lib.filters}
                genres={lib.genres}
                artists={lib.artists}
                years={lib.years}
                total={lib.total}
                gridSize={gridSize}
                onFilterChange={lib.updateFilter}
                onReset={lib.resetFilters}
                onGridSizeChange={handleGridSize}
                viewMode={viewMode}
                onViewModeChange={handleViewMode}
              />
            )}
            {!lib.loading && lib.albums.length === 0
              ? <EmptyState hasSearch={hasActiveFilter} onImport={() => setModal('sync')} />
              : <AlbumGrid
                  albums={lib.albums} loading={lib.loading}
                  loadingMore={lib.loadingMore} hasMore={lib.hasMore}
                  selected={sel.selected} onSelect={sel.toggle}
                  allSelected={sel.allSelected} onToggleAll={sel.toggleAll}
                  onLoadMore={lib.loadMore}
                  gridSize={gridSize} viewMode={viewMode}
        onInfo={(a: Album) => { setTrackAlbum(a); setTrackAlbumPlaylistId(null); }} />
            }
          </>
        )}

        {/* ── Playlists tab ────────────────────────────────────── */}
        {activeTab === 'playlists' && (
          <>
            {pld.selectedPlaylist ? (
              <PlaylistDashboardView
                playlist={pld.selectedPlaylist}
                meta={pld.playlistMeta}
                albums={pld.albums}
                total={pld.total}
                genres={pld.genres}
                artists={pld.artists}
                years={pld.years}
                syncState={pld.syncState}
                loading={pld.loading}
                loadingMore={pld.loadingMore}
                hasMore={pld.hasMore}
                filters={pld.filters}
                gridSize={gridSize}
                viewMode={playlistViewMode}
                onViewModeChange={handlePlaylistViewMode}
                onAlbumInfo={(a: PlaylistAlbum) => { setTrackAlbum(a); setTrackAlbumPlaylistId(pld.selectedPlaylist?.id ?? null); }}
                retention={plRetention}
                onSetRetention={() => { if (pld.selectedPlaylist) setRetentionFor({ playlist: pld.selectedPlaylist, current: plRetention }); }}
                selected={plSel.selected}
                selectedAlbums={plSel.selectedAlbums}
                queueBusy={plQueueBusy}
                onBack={() => { pld.clearPlaylist(); plSel.clear(); }}
                onCancel={pld.cancelFetch}
                onResync={() => pld.syncPlaylist(pld.selectedPlaylist!)}
                onExport={handlePlaylistExport}
                onFilter={pld.updateFilter}
                onReset={pld.resetFilters}
                onLoadMore={pld.loadMore}
                onGridSizeChange={handleGridSize}
                onSelect={plSel.toggle}
                onClearSelection={plSel.clear}
                onQueue={handlePlQueue}
                onAddToPlaylist={() => setModal('pl-playlist')}
                onRemoveSelected={handleRemoveSelectedFromPlaylist}
                removingSelected={plRemoveBusy}
                hasLocalQueue={!!player.localQueue}
                localQueueBusy={player.localBusy}
                activeQueueBusy={player.mergeBusy}
                queuePlaylistBusy={player.queuePlaylistBusy}
                queueAvailable={queueAvailable}
                onLocalQueueCreate={() => requestLocalCreate([...plSel.selected])}
                onLocalQueueAdd={() => void player.addToLocalQueue([...plSel.selected], false)}
                onLocalQueueNext={() => void player.addToLocalQueue([...plSel.selected], true)}
                onLocalQueueReset={requestLocalReset}
              />
            ) : (
              <PlaylistPicker
                playlists={pld.playlists}
                loading={pld.playlistsLoading}
                error={pld.playlistsError}
                cachedIds={pld.cachedIds}
                selectedIds={pld.selectedPlaylistIds}
                onToggleSelect={pld.togglePlaylistSelection}
                onClearSelection={pld.clearPlaylistSelection}
                onDeleteSelected={pld.deleteSelectedPlaylists}
                deleteBusy={pld.playlistDeleteBusy}
                onSelect={pld.selectPlaylist}
                onRefresh={pld.loadPlaylists}
                viewMode={playlistViewMode}
                onViewModeChange={handlePlaylistViewMode}
              />
            )}
          </>
        )}

        {/* ── Tools tab ────────────────────────────────────────── */}
        {activeTab === 'tools' && (
          <>
            <div className="tools-tab">
              <section className="settings-section" style={{ width: '100%' }}>
                <h3 className="settings-heading">Library tools</h3>
                <p className="settings-sub">
                  Local-only tools: duplicate releases are detected on the device and are not
                  removed from your Spotify account.
                </p>
                <button
                  type="button"
                  className="sync-btn sync-btn--ghost full-width"
                  onClick={() => setStatsOpen(true)}
                  disabled={!lib.stats}
                >
                  Library stats
                </button>
                <button
                  type="button"
                  className="sync-btn sync-btn--ghost full-width"
                  disabled={isRemote}
                  style={{ marginTop: '0.5rem', ...(isRemote ? { opacity: 0.5 } : {}) }}
                  onClick={() => void runDuplicateScan()}
                >
                  Scan duplicate albums
                </button>
                <button
                  type="button"
                  className="sync-btn sync-btn--ghost full-width"
                  disabled={followBusy}
                  style={{ marginTop: '0.5rem' }}
                  onClick={() => void handleFollowLibraryArtists()}
                >
                  {followBusy ? 'Following artists…' : 'Follow artists from saved Spotify albums'}
                </button>
                <button
                  type="button"
                  className="sync-btn sync-btn--ghost full-width"
                  onClick={() => setAddFromSiteOpen(true)}
                  style={{ marginTop: '0.5rem' }}
                >
                  Add albums from a website
                </button>
              </section>

              <section className="settings-section" style={{ width: '100%', marginTop: '1.5rem' }}>
                <h3 className="settings-heading">Spotify playlist tools</h3>
                <p className="settings-sub">
                  Search Spotify with the account connected on this device, choose Albums / Singles /
                  Appears On, review duplicate versions, then create a private playlist. Saving
                  albums to Spotify and importing them locally is available in local mode.
                </p>
                <button
                  type="button"
                  className="sync-btn sync-btn--ghost full-width"
                  onClick={() => setDiscographyOpen(true)}
                >
                  Artist discography &amp; playlist
                </button>
              </section>
            </div>

            {statsOpen && (
              <div className="modal-overlay" role="presentation" onClick={() => setStatsOpen(false)}>
                <div
                  className="duplicates-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="stats-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="duplicates-header">
                    <div>
                      <h3 id="stats-title">Library stats</h3>
                      <p className="queue-help">
                        Albums, artists, genres, years and top lists.
                      </p>
                    </div>
                    <button type="button" className="link-btn" onClick={() => setStatsOpen(false)} aria-label="Close stats">
                      close
                    </button>
                  </div>
                  {lib.stats && <StatsBar stats={lib.stats} />}
                  <StatsPanel stats={lib.stats} />
                </div>
              </div>
            )}
            {dupesOpen && (
              <DuplicatesDialog
                open={dupesOpen}
                groups={duplicateGroups ?? []}
                hiddenCount={hiddenDuplicateAlbums.length}
                loading={duplicatesLoading}
                isRemote={isRemote}
                onDismiss={() => setDupesOpen(false)}
                onRemove={(ids) => { void handleDuplicateRemove(ids); }}
                onRemovePermanent={(ids) => { void handleDuplicateRemovePermanent(ids); }}
                onRestore={() => { void handleDuplicateRestore(); }}
              />
            )}
            {addFromSiteOpen && (
              <AddFromSiteDialog
                open={addFromSiteOpen}
                onClose={() => setAddFromSiteOpen(false)}
                onImportCsv={lib.syncCSV}
                onImported={() => {
                  setAddFromSiteOpen(false);
                  showToast('Imported albums from website.', true);
                }}
              />
            )}
            {discographyOpen && (
              <ArtistDiscographyDialog
                open={discographyOpen}
                onClose={() => setDiscographyOpen(false)}
                onToast={showToast}
                isRemote={isRemote}
                serverUrl={ds.settings.serverUrl}
                canAddToLibrary={!isRemote}
                getLibraryAlbumIds={handleGetLibraryAlbumIds}
                importAlbumsToLibrary={lib.importAlbums}
                onPlaylistsChanged={() => { void pld.loadPlaylists(); }}
              />
            )}
          </>
        )}

        {/* ── Settings tab ─────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <SettingsView
            backup={backup.settings}
            onToggleBackup={backup.toggle}
            onSetSubdir={backup.setSubdir}
            onExportNow={handleExportNow}
            dataSource={ds.settings}
            onSetMode={ds.setMode}
            onSetServerUrl={ds.setServerUrl}
            onTestConnection={ds.testConnection}
            autohideNav={autohideNav}
            onToggleAutohide={handleToggleAutohide}
            autohideBoardBar={autohideBoardBar}
            onToggleBoardAutohide={handleToggleBoardAutohide}
            syncPhotos={syncPhotos}
            onToggleSyncPhotos={handleToggleSyncPhotos}
            isRemote={isRemote}
          />
        )}

        {/* ── Player tab ───────────────────────────────────────── */}
        {activeTab === 'player' && (
          <PlayerView
            player={player}
            authState={auth.authState}
            onRequestLocalCreate={() => requestLocalCreate([])}
            onRequestLocalReset={requestLocalReset}
            onRequestLocalClear={requestLocalClear}
            onRequestMergeCreate={requestMergeCreate}
            onRequestMergeNew={requestMergeNew}
            onRequestMergeReset={requestMergeReset}
          />
        )}
      </main>

      {retentionFor && (
        <RetentionDialog
          playlist={retentionFor.playlist}
          remote={isRemote ? { serverUrl: ds.settings.serverUrl } : null}
          current={retentionFor.current}
          onClose={() => setRetentionFor(null)}
          onSaved={() => { void refreshPlaylistRetention(); pld.loadPlaylists(); }}
          onToast={(msg, ok) => showToast(msg, ok)}
        />
      )}

      {trackAlbum && (
        <AlbumTrackSheet
          album={trackAlbum}
          isRemote={isRemote}
          serverUrl={ds.settings.serverUrl}
          playlistId={trackAlbumPlaylistId ?? undefined}
          localPlaybackAvailable={false}
          localPlaybackEnabled={false}
          hasLocalQueue={!!player.localQueue}
          localQueueBusy={player.localBusy}
          activeQueueBusy={player.mergeBusy}
          queuePlaylistBusy={player.queuePlaylistBusy}
          onLocalQueueCreate={() => requestLocalCreate([trackAlbum.id])}
          onLocalQueueAdd={() => void player.addToLocalQueue([trackAlbum.id], false)}
          onLocalQueueNext={() => void player.addToLocalQueue([trackAlbum.id], true)}
          onLocalQueueReset={requestLocalReset}
          onLocalQueueTrack={(uri) => void player.addTrackUrisToLocalQueue([uri], true)}
          onClose={() => { setTrackAlbum(null); setTrackAlbumPlaylistId(null); }}
        />
      )}


      {/* ── Bottom tab bar ─────────────────────────────────────── */}
      <nav className={'bottom-tabs' + (navShouldHide ? ' bottom-tabs--hidden' : '')} aria-label="Main navigation">
        <button
          className={'bottom-tab ' + (activeTab === 'library' ? 'active' : '')}
          onClick={() => switchTab('library')}
          aria-current={activeTab === 'library' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
            <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
            <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
            <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
          </svg>
          <span>Library</span>
        </button>

        <button
          className={'bottom-tab ' + (activeTab === 'playlists' ? 'active' : '')}
          onClick={handleTabPlaylists}
          aria-current={activeTab === 'playlists' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden="true">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <span>Playlists</span>
        </button>

        <button
          className={'bottom-tab ' + (activeTab === 'tools' ? 'active' : '')}
          onClick={() => switchTab('tools')}
          aria-current={activeTab === 'tools' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden="true">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.414l1.414 1.414a1 1 0 0 0 1.414 0l3.182-3.182a4 4 0 0 1-5.657 5.657l-9.192 9.192a2 2 0 1 1-2.829-2.828l9.193-9.193A4 4 0 0 1 17.88 3.12l-3.18 3.18z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
          <span>Tools</span>
        </button>

        <button
          className={'bottom-tab ' + (activeTab === 'settings' ? 'active' : '')}
          onClick={() => switchTab('settings')}
          aria-current={activeTab === 'settings' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.94 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.94a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9.1a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
          <span>Settings</span>
        </button>

        <button
          className={'bottom-tab ' + (activeTab === 'player' ? 'active' : '')}
          onClick={() => switchTab('player')}
          aria-current={activeTab === 'player' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M10 8.5l6 3.5-6 3.5v-7z" fill="currentColor"/>
          </svg>
          <span>Player</span>
        </button>
      </nav>

      {/* Library selection toolbar */}
      <SelectionToolbar
        selectedAlbums={sel.selectedAlbums}
        onQueue={handleQueue}
        onPlaylist={() => setModal('playlist')}
        onClear={sel.clear}
        busy={queueBusy}
        onRemove={handleRemoveSelectedFromLibrary}
        removing={removeBusy}
        hasLocalQueue={!!player.localQueue}
        localQueueBusy={player.localBusy}
        activeQueueBusy={player.mergeBusy}
        queuePlaylistBusy={player.queuePlaylistBusy}
        queueAvailable={queueAvailable}
        onLocalQueueCreate={() => requestLocalCreate([...sel.selected])}
        onLocalQueueAdd={() => void player.addToLocalQueue([...sel.selected], false)}
        onLocalQueueNext={() => void player.addToLocalQueue([...sel.selected], true)}
        onLocalQueueReset={requestLocalReset}
      />

      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={'toast ' + (t.ok ? 'toast--ok' : 'toast--err')}>
              {t.msg}
            </div>
          ))}
        </div>
      )}

      {modal === 'sync' && (
        <SyncModal
          onSyncCSV={lib.syncCSV}
          onSyncSpotify={handleSyncSpotify}
          onClose={() => setModal(null)}
          syncing={isBusy}
          dataSource={ds.settings}
        />
      )}

      {modal === 'playlist' && (
        <PlaylistModal
          selectedAlbums={sel.selectedAlbums}
          remote={remoteOpt}
          onClose={() => { setModal(null); sel.clear(); }}
          onDone={showToast}
        />
      )}

      {modal === 'pl-playlist' && (
        <PlaylistModal
          selectedAlbums={plSel.selectedAlbums as unknown as Album[]}
          remote={remoteOpt}
          onClose={() => { setModal(null); plSel.clear(); }}
          onDone={showToast}
        />
      )}
    </div>
    </SyncPhotosProvider>
  );
}

const Splash: React.FC = () => (
  <div className="splash">
    <img src="/icon-192x192.png" alt="reSpotIt" width="64" height="64" style={{ borderRadius: 16 }} />
  </div>
);
