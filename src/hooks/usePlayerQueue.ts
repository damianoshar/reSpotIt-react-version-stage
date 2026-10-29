import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAlbumTrackUris,
  addTrackUrisToPlaylist,
  createPlaylist,
  createPlaylistWithUris,
  getPlaylistAccess,
  getPlaylistTrackUris,
  insertTrackUrisToPlaylist,
  unfollowPlaylist,
} from '../services/SpotifyPlaylistService';
import {
  getCurrentPlayback,
  getDevices,
  getQueue,
  pickPlaybackDevice,
  playPlaylistAsContext,
  toPlaybackState,
  type PlaybackState,
} from '../services/SpotifyPlaybackService';
import {
  clearQueueState,
  loadQueueState,
  queuePlaylistName,
  saveLocalCursor,
  saveLocalQueue,
  saveMergeQueue,
  saveQueueMode,
  type LocalQueueCursor,
  type QueueMode,
  type QueuePlaylistRef,
} from '../services/QueuePlaylistStore';
import {
  isPlayable,
  newQueueContent,
  playlistUris,
  queueUris,
  upNextIncludingPrevious,
} from '../utils/queueSnapshot';
import { newAlbumUris, nextAlbumUris, extraUpcoming } from '../utils/activeQueuePlanner';

// ---------------------------------------------------------------------------
// Types / helpers
// ---------------------------------------------------------------------------

type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

interface Options {
  enabled:      boolean;
  authState:    AuthState;
  onMessage?:   (message: string, ok?: boolean) => void;
  onPlaylistsChanged?: () => void;
}

interface Snapshot {
  current: Awaited<ReturnType<typeof getCurrentPlayback>>;
  queue:   Awaited<ReturnType<typeof getQueue>>;
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/403|forbidden|permission|refused/i.test(raw)) {
    return 'Spotify refused the edit. Only playlists you own or collaborate on can be changed.';
  }
  return raw.trim() || 'Unknown error';
}

function contextPlaylistId(uri: string): string | null {
  return uri.startsWith('spotify:playlist:') ? uri.slice('spotify:playlist:'.length) : null;
}

/** Locate the current URI in a local queue playlist, preserving duplicate order. */
function locateLocalIndex(
  active: QueuePlaylistRef,
  cursor: LocalQueueCursor | null,
  currentUri: string | null,
): { index: number; cursor: LocalQueueCursor } {
  const uris = active.uris;
  const uri = (currentUri ?? '').trim();
  let next: LocalQueueCursor = cursor && cursor.playlistId === active.playlistId
    ? cursor
    : { playlistId: active.playlistId, index: -1, uri: null };

  if (!uri || uris.length === 0) return { index: -1, cursor: next };

  const sameAsLast = next.uri === uri;
  const start = sameAsLast && next.index >= 0 && next.index < uris.length ? next.index : 0;
  let found = -1;
  for (let i = start; i < uris.length; i++) {
    if (uris[i] === uri) { found = i; break; }
  }
  if (found < 0) {
    for (let i = 0; i < start; i++) {
      if (uris[i] === uri) { found = i; break; }
    }
  }
  if (found >= 0) next = { playlistId: active.playlistId, index: found, uri };
  return { index: found, cursor: next };
}

/** Locate the current URI in the merge queue, advancing past earlier duplicates. */
function locateMergeIndex(
  active: QueuePlaylistRef,
  cursor: LocalQueueCursor | null,
  currentUri: string | null,
): { index: number; cursor: LocalQueueCursor } {
  const uris = active.uris;
  const uri = (currentUri ?? '').trim();
  let next: LocalQueueCursor = cursor && cursor.playlistId === active.playlistId
    ? cursor
    : { playlistId: active.playlistId, index: -1, uri: null };

  if (!uri || uris.length === 0) return { index: -1, cursor: next };

  const sameAsLast = next.uri === uri;
  let index = sameAsLast ? Math.max(0, next.index) : Math.max(0, next.index + 1);
  let found = -1;
  while (index < uris.length) {
    if (uris[index].trim() === uri) { found = index; break; }
    index++;
  }
  if (found < 0) found = uris.findIndex((candidate) => candidate.trim() === uri);
  if (found >= 0) next = { playlistId: active.playlistId, index: found, uri };
  return { index: found, cursor: next };
}

function sameCursor(a: LocalQueueCursor | null, b: LocalQueueCursor | null): boolean {
  if (a == null || b == null) return a === b;
  return a.playlistId === b.playlistId && a.index === b.index && a.uri === b.uri;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlayerQueue({
  enabled,
  authState,
  onMessage,
  onPlaylistsChanged,
}: Options) {
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState('');

  const [queueMode, setQueueModeState] = useState<QueueMode>('local');
  const [mergeQueue, setMergeQueue] = useState<QueuePlaylistRef | null>(null);
  const [mergeStatus, setMergeStatus] = useState('No queue playlist yet');
  const [mergeBusy, setMergeBusy] = useState(false);

  const [localQueue, setLocalQueue] = useState<QueuePlaylistRef | null>(null);
  const [localStatus, setLocalStatus] = useState('No local queue playlist yet');
  const [localCursor, setLocalCursor] = useState<LocalQueueCursor | null>(null);
  const [localBusy, setLocalBusy] = useState(false);

  const [queuePlaylistBusy, setQueuePlaylistBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionOk, setActionOk] = useState(true);

  const playbackRef = useRef<PlaybackState | null>(null);
  const mergeQueueRef = useRef<QueuePlaylistRef | null>(null);
  const localQueueRef = useRef<QueuePlaylistRef | null>(null);
  const localCursorRef = useRef<LocalQueueCursor | null>(null);
  const mergeCursorRef = useRef<LocalQueueCursor | null>(null);
  const localBusyRef = useRef(false);
  const mergeBusyRef = useRef(false);
  const queuePlaylistBusyRef = useRef(false);
  const accessCacheRef = useRef(new Map<string, { name: string; editable: boolean }>());
  const lastPlaybackContextUriRef = useRef('');
  const loadedRef = useRef(false);

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onPlaylistsChangedRef = useRef(onPlaylistsChanged);
  onPlaylistsChangedRef.current = onPlaylistsChanged;

  useEffect(() => { playbackRef.current = playback; }, [playback]);
  useEffect(() => { mergeQueueRef.current = mergeQueue; }, [mergeQueue]);
  useEffect(() => { localQueueRef.current = localQueue; }, [localQueue]);
  useEffect(() => { localCursorRef.current = localCursor; }, [localCursor]);

  const notify = useCallback((message: string, ok = true) => {
    setActionMessage(message);
    setActionOk(ok);
    onMessageRef.current?.(message, ok);
  }, []);

  const setLocalQueueState = useCallback((ref: QueuePlaylistRef | null) => {
    localQueueRef.current = ref;
    setLocalQueue(ref);
    void saveLocalQueue(ref);
  }, []);

  const setMergeQueueState = useCallback((ref: QueuePlaylistRef | null) => {
    mergeQueueRef.current = ref;
    setMergeQueue(ref);
    void saveMergeQueue(ref);
  }, []);

  const setLocalCursorState = useCallback((cursor: LocalQueueCursor | null) => {
    localCursorRef.current = cursor;
    setLocalCursor(cursor);
    void saveLocalCursor(cursor);
  }, []);

  const setLocalBusyState = useCallback((value: boolean) => {
    localBusyRef.current = value;
    setLocalBusy(value);
  }, []);

  const setMergeBusyState = useCallback((value: boolean) => {
    mergeBusyRef.current = value;
    setMergeBusy(value);
  }, []);

  const setQueuePlaylistBusyState = useCallback((value: boolean) => {
    queuePlaylistBusyRef.current = value;
    setQueuePlaylistBusy(value);
  }, []);

  // Load persisted pointers once.
  useEffect(() => {
    let cancelled = false;
    loadQueueState()
      .then((state) => {
        if (cancelled) return;
        loadedRef.current = true;
        setQueueModeState(state.mode);
        mergeQueueRef.current = state.merge;
        setMergeQueue(state.merge);
        localQueueRef.current = state.local;
        setLocalQueue(state.local);
        localCursorRef.current = state.cursor;
        setLocalCursor(state.cursor);
        if (!state.local) setLocalStatus('No local queue playlist yet');
        if (!state.merge) setMergeStatus('No queue playlist yet');
      })
      .catch(() => { loadedRef.current = true; });
    return () => { cancelled = true; };
  }, []);

  const updateStatuses = useCallback((state: PlaybackState | null) => {
    const activeLocal = localQueueRef.current;
    if (activeLocal) {
      const ownContext = state?.contextUri === `spotify:playlist:${activeLocal.playlistId}`;
      if (!ownContext) {
        setLocalStatus(
          `Local queue: "${activeLocal.name}" (${activeLocal.uris.length} tracks) · not the current context`,
        );
      } else {
        const located = locateLocalIndex(activeLocal, localCursorRef.current, state?.track?.uri ?? null);
        if (!sameCursor(located.cursor, localCursorRef.current)) {
          setLocalCursorState(located.cursor);
        }
        if (located.index >= 0) {
          const total = activeLocal.uris.length;
          const remaining = Math.max(0, total - located.index - 1);
          setLocalStatus(
            `Local queue: ${located.index + 1}/${total} · ${state?.track?.name ?? ''} · ${remaining} left`,
          );
        } else {
          setLocalStatus(
            `Local queue: "${activeLocal.name}" (${activeLocal.uris.length} tracks) · current track not in the playlist`,
          );
        }
      }
    } else {
      setLocalStatus('No local queue playlist yet');
    }

    const activeMerge = mergeQueueRef.current;
    if (activeMerge) {
      const ownContext = state?.contextUri === `spotify:playlist:${activeMerge.playlistId}`;
      if (!ownContext) {
        setMergeStatus(
          `Queue playlist ready: "${activeMerge.name}" (${activeMerge.uris.length} tracks) · not the current context`,
        );
      } else {
        const located = locateMergeIndex(activeMerge, mergeCursorRef.current, state?.track?.uri ?? null);
        mergeCursorRef.current = located.cursor;
        if (located.index < 0) {
          setMergeStatus(`Queue playlist is the current context (${activeMerge.uris.length} tracks)`);
        } else {
          const tail = activeMerge.uris.slice(located.index + 1);
          const extras = extraUpcoming((state?.queue ?? []).map((track) => track.uri), tail);
          const extraText = extras.length > 0
            ? ` · ${extras.length} manual Spotify queue item(s) waiting`
            : '';
          const trackName = state?.track?.name ?? 'current track';
          const status = state?.isPlaying ? 'Playing' : 'Paused';
          setMergeStatus(
            `${status} ${located.index + 1}/${activeMerge.uris.length}: ${trackName}${extraText}`,
          );
        }
      }
    } else {
      setMergeStatus('No queue playlist yet');
    }
  }, [setLocalCursorState]);

  const fetchSnapshot = useCallback(async (): Promise<Snapshot> => {
    const current = await getCurrentPlayback();
    const queue = await getQueue().catch(() => []);
    return { current, queue };
  }, []);

  const refreshPlayback = useCallback(async () => {
    if (authState === 'loading') {
      setPlaybackLoading(true);
      return;
    }
    if (authState !== 'authenticated') {
      setPlayback(null);
      playbackRef.current = null;
      setPlaybackError('Connect Spotify on this device to use the Player.');
      setPlaybackLoading(false);
      return;
    }

    if (!playbackRef.current) setPlaybackLoading(true);
    try {
      const { current, queue } = await fetchSnapshot();
      const contextUri = current?.context?.uri ?? '';
      if (current != null) lastPlaybackContextUriRef.current = contextUri;
      const contextId = contextPlaylistId(contextUri);
      let contextName = current?.item?.album?.name ?? '';
      let contextEditable = false;

      if (contextId) {
        const cached = accessCacheRef.current.get(contextId);
        if (cached) {
          contextName = cached.name;
          contextEditable = cached.editable;
        } else {
          try {
            const access = await getPlaylistAccess(contextId);
            accessCacheRef.current.set(contextId, access);
            contextName = access.name;
            contextEditable = access.editable;
          } catch {
            // Playback still works when details are unavailable.
          }
        }
      }

      const next = toPlaybackState(current, queue, contextName, contextEditable);
      playbackRef.current = next;
      setPlayback(next);
      setPlaybackError('');
      updateStatuses(next);
    } catch (error) {
      setPlaybackError(errorText(error));
    } finally {
      setPlaybackLoading(false);
    }
  }, [authState, fetchSnapshot, updateStatuses]);

  // Poll only while the Player tab is visible.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refreshPlayback();
    };
    void tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, refreshPlayback]);

  const setQueueMode = useCallback((mode: QueueMode) => {
    setQueueModeState(mode);
    void saveQueueMode(mode);
    updateStatuses(playbackRef.current);
  }, [updateStatuses]);

  const resolveAlbumUris = useCallback(async (albumIds: string[]): Promise<string[]> => {
    const unique = Array.from(new Set(albumIds.filter((id) => id.trim().length > 0)));
    if (unique.length === 0) return [];
    const uris: string[] = [];
    for (const id of unique) {
      uris.push(...await getAlbumTrackUris(id));
    }
    return uris.map((uri) => uri.trim()).filter((uri) => isPlayable(uri));
  }, []);

  const createLocalQueueFromUris = useCallback(async (albumUris: string[], reset = false) => {
    if (localBusyRef.current) return;
    setLocalBusyState(true);
    try {
      const extras = albumUris
        .map((uri) => uri.trim())
        .filter((uri) => isPlayable(uri));
      const { current, queue } = await fetchSnapshot();
      const previous = localQueueRef.current;
      let previousUris: string[] = [];
      if (reset && previous) {
        const fetched = await getPlaylistTrackUris(previous.playlistId).catch(() => previous.uris);
        previousUris = fetched.length > 0 ? fetched : previous.uris;
      }
      const currentUri = current?.item?.uri ?? null;
      const ownContext = previous != null
        && current?.context?.uri === `spotify:playlist:${previous.playlistId}`;

      let content: string[];
      let playbackOffset = 0;
      if (reset && previous) {
        let anchorIndex = -1;
        if (ownContext) {
          anchorIndex = locateLocalIndex(
            { ...previous, uris: previousUris },
            localCursorRef.current,
            currentUri,
          ).index;
        } else if (localCursorRef.current?.playlistId === previous.playlistId
          && localCursorRef.current.uri != null) {
          anchorIndex = localCursorRef.current.index;
        }
        if (anchorIndex < 0 && currentUri) {
          anchorIndex = previousUris.findIndex((uri) => uri === currentUri);
        }
        // A reset is non-destructive: keep the whole previous playlist and return
        // to the current track. Drop nothing, including already-played history.
        content = previousUris.length > 0 ? [...previousUris] : [];
        playbackOffset = anchorIndex >= 0 ? anchorIndex : 0;
      } else {
        // A new queue starts with only the currently playing track, then extras.
        // Do not carry Spotify's existing up-next tail into the new playlist.
        content = currentUri && isPlayable(currentUri) ? [currentUri.trim()] : [];
      }

      const merged = [...content];
      for (const uri of extras) {
        if (!merged.includes(uri)) merged.push(uri);
      }

      if (merged.length === 0) {
        if (reset) {
          setLocalStatus(previous
            ? 'Already at the current track; local queue unchanged.'
            : 'No local queue playlist yet');
          notify(previous
            ? 'Nothing to reset — the current track is already the anchor. No history was deleted.'
            : 'Nothing to queue — start Spotify playback or select an album.', !previous);
        } else {
          notify('Nothing to queue — start Spotify playback or select an album.', false);
        }
        return;
      }

      const name = queuePlaylistName();
      const created = await createPlaylistWithUris(name, merged);
      const fetched = await getPlaylistTrackUris(created.id).catch(() => merged);
      const actual = fetched.length > 0 ? fetched : merged;
      const playlistName = created.name || name;
      setLocalQueueState({ playlistId: created.id, name: playlistName, uris: actual });
      setLocalCursorState({ playlistId: created.id, index: 0, uri: actual[0] ?? null });
      setLocalStatus(`Local queue ready: "${playlistName}" (${actual.length} tracks)`);
      onPlaylistsChangedRef.current?.();

      try {
        const device = pickPlaybackDevice(await getDevices());
        if (!device) throw new Error('Open Spotify on a device first — no device can play right now.');
        await playPlaylistAsContext(created.id, device.id, playbackOffset);
        if (reset && previous && previous.playlistId !== created.id) {
          void unfollowPlaylist(previous.playlistId).catch(() => {});
        }
        notify(`Playing local queue "${playlistName}" on ${device.name || 'the active device'}`);
      } catch (playbackFailure) {
        notify(
          `Created local queue "${playlistName}" but playback did not start: ${errorText(playbackFailure)}`,
          false,
        );
      }

      await refreshPlayback();
    } catch (error) {
      notify(`Local queue failed: ${errorText(error)}`, false);
    } finally {
      setLocalBusyState(false);
    }
  }, [
    fetchSnapshot, notify, refreshPlayback,
    setLocalBusyState, setLocalCursorState, setLocalQueueState,
  ]);

  const createLocalQueue = useCallback(async (albumIds: string[] = [], reset = false) => {
    const albumUris = await resolveAlbumUris(albumIds);
    await createLocalQueueFromUris(albumUris, reset);
  }, [createLocalQueueFromUris, resolveAlbumUris]);

  const publishLocalQueueFromUris = useCallback(async (uris: string[], reset = true) => {
    if (uris.length === 0) return;
    await createLocalQueueFromUris(uris, reset);
  }, [createLocalQueueFromUris]);

  const playLocalQueueAt = useCallback(async (index = 0) => {
    const active = localQueueRef.current;
    if (!active?.playlistId) return;
    try {
      const device = pickPlaybackDevice(await getDevices());
      if (!device?.id) throw new Error('Open Spotify on a device first — no device can play right now.');
      await playPlaylistAsContext(active.playlistId, device.id, Math.max(0, index));
      await refreshPlayback();
    } catch (error) {
      notify(`Local queue playback failed: ${errorText(error)}`, false);
    }
  }, [notify, refreshPlayback]);

  const clearLocalQueue = useCallback(async () => {
    if (localBusyRef.current) return;
    setLocalBusyState(true);
    try {
      const previous = localQueueRef.current;
      const name = queuePlaylistName();
      const created = await createPlaylist(name);
      const playlistName = created.name || name;
      setLocalQueueState({ playlistId: created.id, name: playlistName, uris: [] });
      setLocalCursorState({ playlistId: created.id, index: 0, uri: null });
      setLocalStatus(
        previous
          ? `Local queue: "${playlistName}" (0 tracks) · empty, previous queue kept`
          : `Local queue: "${playlistName}" (0 tracks) · empty`,
      );
      onPlaylistsChangedRef.current?.();
      notify(
        previous
          ? `Created an empty local queue "${playlistName}". The previous queue "${previous.name}" was kept on Spotify.`
          : `Created an empty local queue "${playlistName}".`,
      );
    } catch (error) {
      notify(`Clear local queue failed: ${errorText(error)}`, false);
    } finally {
      setLocalBusyState(false);
    }
  }, [
    notify, setLocalBusyState, setLocalCursorState, setLocalQueueState,
  ]);

  const addUrisToLocalQueue = useCallback(async (uris: string[], insertNext = false) => {
    const requestedUris = uris
      .map((uri) => uri.trim())
      .filter((uri) => isPlayable(uri));
    if (requestedUris.length === 0) {
      notify('No playable tracks to queue.', false);
      return;
    }
    const active = localQueueRef.current;
    if (!active) {
      if (insertNext) {
        notify('Create a local queue playlist first, then queue tracks next.', false);
        return;
      }
      await createLocalQueueFromUris(requestedUris, false);
      return;
    }
    if (localBusyRef.current) return;
    setLocalBusyState(true);
    try {
      const { current, queue } = await fetchSnapshot();
      const fetched = await getPlaylistTrackUris(active.playlistId).catch(() => active.uris);
      const activeUris = fetched.length > 0 ? fetched : active.uris;
      const ownContext = current?.context?.uri === `spotify:playlist:${active.playlistId}`;
      const currentUri = current?.item?.uri ?? null;
      const playingLocalQueue = localQueueRef.current != null
        && current?.context?.uri === `spotify:playlist:${localQueueRef.current.playlistId}`;
      const sideQueue = playingLocalQueue ? [] : queue.map((track) => track.uri);
      const activeWithUris = { ...active, uris: activeUris };
      const located = ownContext
        ? locateLocalIndex(activeWithUris, localCursorRef.current, currentUri)
        : { index: -1, cursor: localCursorRef.current };
      if (ownContext && !sameCursor(located.cursor, localCursorRef.current)) {
        setLocalCursorState(located.cursor);
      }
      const liveIndex = located.index;

      const anchorIndex = insertNext
        ? liveIndex >= 0
          ? liveIndex
          : localCursorRef.current?.playlistId === active.playlistId
            && localCursorRef.current.index >= 0
            && localCursorRef.current.index < activeUris.length
            ? localCursorRef.current.index
            : activeUris.length === 0 ? 0 : -1
        : liveIndex;

      if (insertNext && anchorIndex < 0) {
        notify('Start playback from the local queue first so the app knows the current position.', false);
        return;
      }

      const insertAt = insertNext
        ? Math.min(Math.max(anchorIndex + 1, 0), activeUris.length)
        : -1;
      const upcoming = insertNext
        ? activeUris.slice(insertAt)
        : liveIndex >= 0
          ? activeUris.slice(liveIndex + 1)
          : activeUris;

      const toAdd = insertNext
        ? nextAlbumUris(requestedUris, ownContext ? currentUri : null, upcoming)
        : newAlbumUris(requestedUris, upcoming);

      if (toAdd.length === 0) {
        notify(
          insertNext
            ? 'Those tracks are already queued next.'
            : 'Those tracks are already in the local queue playlist.',
          false,
        );
        return;
      }

      const fallback = insertNext
        ? [...activeUris.slice(0, insertAt), ...toAdd, ...activeUris.slice(insertAt)]
        : [...activeUris, ...toAdd];

      if (insertNext) {
        await insertTrackUrisToPlaylist(active.playlistId, toAdd, insertAt);
      } else {
        await addTrackUrisToPlaylist(active.playlistId, toAdd);
      }

      const updatedFetched = await getPlaylistTrackUris(active.playlistId).catch(() => fallback);
      const updated = updatedFetched.length > 0 ? updatedFetched : fallback;
      setLocalQueueState({ playlistId: active.playlistId, name: active.name, uris: updated });
      setLocalStatus(
        insertNext && activeUris.length === 0
          ? `Local queue: ${updated.length} tracks · ${toAdd.length} added`
          : insertNext && ownContext
            ? `Local queue: ${updated.length} tracks · ${toAdd.length} queued next`
            : insertNext
              ? `Local queue: ${updated.length} tracks · ${toAdd.length} queued after the saved position`
              : ownContext
                ? `Local queue: ${updated.length} tracks · ${toAdd.length} just added`
                : `Local queue: ${updated.length} tracks · not the current playback context`,
      );
      notify(
        insertNext
          ? `Queued ${toAdd.length} track(s) next in "${active.name}".`
          : `Added ${toAdd.length} track(s) to the end of "${active.name}".`,
      );
      await refreshPlayback();
    } catch (error) {
      notify(
        `${insertNext ? 'Queue next' : 'Add to local queue'} failed: ${errorText(error)}`,
        false,
      );
    } finally {
      setLocalBusyState(false);
    }
  }, [
    createLocalQueueFromUris, fetchSnapshot, notify, refreshPlayback,
    setLocalBusyState, setLocalCursorState, setLocalQueueState,
  ]);

  const addToLocalQueue = useCallback(async (albumIds: string[], insertNext = false) => {
    if (albumIds.length === 0) {
      notify('Select at least one album first.', false);
      return;
    }
    const albumUris = await resolveAlbumUris(albumIds);
    if (albumUris.length === 0) {
      notify('No playable tracks found for the selected album(s).', false);
      return;
    }
    await addUrisToLocalQueue(albumUris, insertNext);
  }, [addUrisToLocalQueue, notify, resolveAlbumUris]);

  const createMergeQueue = useCallback(async (
    albumIds: string[] = [],
    reset = false,
    newFromCurrent = false,
  ) => {
    if (mergeBusyRef.current) return;
    setMergeBusyState(true);
    try {
      const { current, queue } = await fetchSnapshot();
      const previous = mergeQueueRef.current;
      const currentUri = current?.item?.uri ?? null;
      // Spotify's manual up-next should not be folded into the merge playlist when
      // the playing context is already the app's local queue playlist; there those
      // items are already represented and re-importing would double them up.
      const playingLocalQueue = localQueueRef.current != null
        && current?.context?.uri === `spotify:playlist:${localQueueRef.current.playlistId}`;
      const sideQueue = playingLocalQueue ? [] : queue.map((track) => track.uri);
      const previousContext = previous != null
        && current?.context?.uri === `spotify:playlist:${previous.playlistId}`;
      const stoppedOnPrevious = current == null
        && previous != null
        && mergeCursorRef.current?.playlistId === previous.playlistId
        && mergeCursorRef.current.index >= 0
        && lastPlaybackContextUriRef.current === `spotify:playlist:${previous.playlistId}`;
      const keepPreviousTail = !newFromCurrent && (previousContext || stoppedOnPrevious);
      let previousUris: string[] = [];
      if (keepPreviousTail && previous) {
        const fetched = await getPlaylistTrackUris(previous.playlistId).catch(() => previous.uris);
        previousUris = fetched.length > 0 ? fetched : previous.uris;
      }

      let previousIndex = -1;
      if (previousContext && previous) {
        const located = locateMergeIndex(previous, mergeCursorRef.current, currentUri);
        mergeCursorRef.current = located.cursor;
        previousIndex = located.index;
      } else if (stoppedOnPrevious && mergeCursorRef.current) {
        previousIndex = mergeCursorRef.current.index;
      }

      const anchorUri = previousContext
        ? currentUri
        : stoppedOnPrevious
          ? mergeCursorRef.current?.uri ?? null
          : null;
      let upNext: string[];
      if (keepPreviousTail && previousUris.length > 0) {
        upNext = upNextIncludingPrevious(
          // Reset keeps the ordinary Spotify-merge behavior and is not subject to
          // the "currently playing local queue" guard below.
          reset ? queue.map((track) => track.uri) : sideQueue,
          previousUris,
          anchorUri,
          current?.repeat_state === 'context' || current?.repeat_state === 'track',
          previousIndex >= 0 ? previousIndex : null,
        );
      } else if (reset) {
        // The reset button keeps its existing behavior: it is not affected by the
        // "only when the current context is not the local queue" guard above.
        upNext = queueUris(queue.map((track) => track.uri));
      } else {
        upNext = newQueueContent(currentUri, sideQueue);
      }

      const albumUris = await resolveAlbumUris(albumIds);
      const content = [...upNext, ...newAlbumUris(albumUris, upNext)];

      if (content.length === 0) {
        if (reset) {
          setMergeQueueState(null);
          mergeCursorRef.current = null;
          if (previous) void unfollowPlaylist(previous.playlistId).catch(() => {});
          setMergeStatus('No queue playlist yet');
          notify('Queue playlist reset. Nothing is queued.');
        } else {
          notify('Nothing to queue — there is no current queue or selected album.', false);
        }
        return;
      }

      const name = queuePlaylistName();
      const created = await createPlaylistWithUris(name, content);
      const fetched = await getPlaylistTrackUris(created.id).catch(() => content);
      const actual = fetched.length > 0 ? fetched : content;
      const playlistName = created.name || name;
      setMergeQueueState({ playlistId: created.id, name: playlistName, uris: actual });
      setMergeStatus(`Queue playlist ready: "${playlistName}" (${actual.length} tracks)`);
      onPlaylistsChangedRef.current?.();

      try {
        const device = pickPlaybackDevice(await getDevices());
        if (!device) throw new Error('Open Spotify on a device first — no device can play right now.');
        await playPlaylistAsContext(created.id, device.id, 0);
        if ((reset || newFromCurrent) && previous && previous.playlistId !== created.id) {
          void unfollowPlaylist(previous.playlistId).catch(() => {});
        }
        notify(`Playing "${playlistName}" on ${device.name || 'the active device'}`);
      } catch (playbackFailure) {
        notify(
          `Created "${playlistName}" but playback did not start: ${errorText(playbackFailure)}`,
          false,
        );
      }

      await refreshPlayback();
    } catch (error) {
      notify(`Queue playlist failed: ${errorText(error)}`, false);
    } finally {
      setMergeBusyState(false);
    }
  }, [
    fetchSnapshot, notify, refreshPlayback, resolveAlbumUris,
    setMergeBusyState, setMergeQueueState,
  ]);

  const addToMergeQueue = useCallback(async (albumIds: string[]) => {
    if (albumIds.length === 0) {
      notify('Select at least one album first.', false);
      return;
    }
    const active = mergeQueueRef.current;
    if (!active) {
      await createMergeQueue(albumIds, false, false);
      return;
    }
    if (mergeBusyRef.current) return;
    setMergeBusyState(true);
    try {
      const { current, queue } = await fetchSnapshot();
      const fetched = await getPlaylistTrackUris(active.playlistId).catch(() => active.uris);
      const activeUris = fetched.length > 0 ? fetched : active.uris;
      const ownContext = current?.context?.uri === `spotify:playlist:${active.playlistId}`;
      const playingLocalQueue = localQueueRef.current != null
        && current?.context?.uri === `spotify:playlist:${localQueueRef.current.playlistId}`;
      const sideQueue = playingLocalQueue ? [] : queue.map((track) => track.uri);
      let upcoming: string[] = [];
      if (ownContext) {
        const located = locateMergeIndex(
          { ...active, uris: activeUris },
          mergeCursorRef.current,
          current?.item?.uri ?? null,
        );
        mergeCursorRef.current = located.cursor;
        upcoming = upNextIncludingPrevious(
          sideQueue,
          activeUris,
          current?.item?.uri ?? null,
          current?.repeat_state === 'context' || current?.repeat_state === 'track',
          located.index >= 0 ? located.index : null,
        );
      }

      const albumUris = await resolveAlbumUris(albumIds);
      const toAppend = newAlbumUris(albumUris, upcoming);
      if (toAppend.length === 0) {
        notify('Those album tracks are already in the queue playlist or Spotify queue.', false);
        return;
      }

      await addTrackUrisToPlaylist(active.playlistId, toAppend);
      const updatedFetched = await getPlaylistTrackUris(active.playlistId).catch(() => [...activeUris, ...toAppend]);
      const updated = updatedFetched.length > 0 ? updatedFetched : [...activeUris, ...toAppend];
      setMergeQueueState({ playlistId: active.playlistId, name: active.name, uris: updated });
      setMergeStatus(
        ownContext
          ? `Queue playlist: ${updated.length} tracks · ${toAppend.length} just added`
          : `Queue playlist: ${updated.length} tracks · not the current playback context`,
      );
      notify(`Added ${toAppend.length} track(s) to the end of "${active.name}".`);
      await refreshPlayback();
    } catch (error) {
      notify(`Add to queue playlist failed: ${errorText(error)}`, false);
    } finally {
      setMergeBusyState(false);
    }
  }, [
    createMergeQueue, fetchSnapshot, notify, refreshPlayback, resolveAlbumUris,
    setMergeBusyState, setMergeQueueState,
  ]);

  const saveQueue = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      notify('Playlist name cannot be empty.', false);
      return;
    }
    if (queuePlaylistBusyRef.current) return;
    setQueuePlaylistBusyState(true);
    try {
      const { current, queue } = await fetchSnapshot();
      const currentUri = current?.item?.uri ?? null;
      const raw = [
        ...(currentUri ? [currentUri] : []),
        ...queue.map((track) => track.uri),
      ].filter((uri) => uri.trim().length > 0);
      const uris = playlistUris(currentUri, queue.map((track) => track.uri));
      if (uris.length === 0) {
        notify('Nothing to save — the current item and queue are empty or local files.', false);
        return;
      }
      const created = await createPlaylistWithUris(trimmed, uris);
      const playlistName = created.name || trimmed;
      const skipped = raw.length - uris.length;
      onPlaylistsChangedRef.current?.();
      notify(
        `Saved ${uris.length} item(s) to "${playlistName}"`
        + (skipped > 0 ? ` (skipped ${skipped} unsupported item(s))` : ''),
      );
    } catch (error) {
      notify(`Save failed: ${errorText(error)}`, false);
    } finally {
      setQueuePlaylistBusyState(false);
    }
  }, [fetchSnapshot, notify, setQueuePlaylistBusyState]);

  const appendQueue = useCallback(async () => {
    if (queuePlaylistBusyRef.current) return;
    setQueuePlaylistBusyState(true);
    try {
      const { current, queue } = await fetchSnapshot();
      const playlistId = contextPlaylistId(current?.context?.uri ?? '');
      if (!playlistId) {
        notify('Playback is not from a playlist.', false);
        return;
      }
      const access = await getPlaylistAccess(playlistId);
      if (!access.editable) {
        notify('This playlist is not editable from this account.', false);
        return;
      }
      const uris = queueUris(queue.map((track) => track.uri));
      if (uris.length === 0) {
        notify('Nothing queued to append.', false);
        return;
      }
      const added = await addTrackUrisToPlaylist(playlistId, uris);
      onPlaylistsChangedRef.current?.();
      notify(`Appended ${added} item(s) to "${access.name || 'the current playlist'}".`);
    } catch (error) {
      notify(`Append failed: ${errorText(error)}`, false);
    } finally {
      setQueuePlaylistBusyState(false);
    }
  }, [fetchSnapshot, notify, setQueuePlaylistBusyState]);

  const resetAll = useCallback(() => {
    setPlayback(null);
    playbackRef.current = null;
    setPlaybackError('');
    setQueueModeState('local');
    mergeQueueRef.current = null;
    setMergeQueue(null);
    mergeCursorRef.current = null;
    setMergeStatus('No queue playlist yet');
    localQueueRef.current = null;
    setLocalQueue(null);
    localCursorRef.current = null;
    setLocalCursor(null);
    setLocalStatus('No local queue playlist yet');
    accessCacheRef.current.clear();
    lastPlaybackContextUriRef.current = '';
    void clearQueueState();
  }, []);

  return {
    playback,
    playbackLoading,
    playbackError,
    queueMode,
    mergeQueue,
    mergeStatus,
    mergeBusy,
    localQueue,
    localStatus,
    localCursor,
    localBusy,
    queuePlaylistBusy,
    actionMessage,
    actionOk,
    refreshPlayback,
    setQueueMode,
    createLocalQueue,
    clearLocalQueue,
    publishLocalQueueFromUris,
    playLocalQueueAt,
    addToLocalQueue,
    addTrackUrisToLocalQueue: addUrisToLocalQueue,
    createMergeQueue,
    addToMergeQueue,
    saveQueue,
    appendQueue,
    resetAll,
  };
}

export type PlayerQueueController = ReturnType<typeof usePlayerQueue>;
