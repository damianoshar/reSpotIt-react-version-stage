import { useCallback, useEffect, useState } from 'react';
import {
  clearLocalQueueState,
  enqueueLocalTrack,
  forgetLocalPlaybackAccount,
  getLocalPlaybackSettings,
  getLocalPlaybackState,
  isLocalPlaybackAvailable,
  setLocalPlaybackSettings,
  jumpToLocalQueueIndex,
  moveLocalQueueItem,
  nextLocalTrack,
  pauseLocalPlayback,
  playLocalTracks,
  playNextLocalTrack,
  previousLocalTrack,
  removeLocalQueueItem,
  resumeLocalPlayback,
  seekLocalPlayback,
  setLocalPlaybackEnabled,
  setLocalPlaybackKeepConnected,
  stopLocalPlayback,
  toggleLocalPlayback,
  type LocalPlaybackSettings,
  type LocalPlaybackState,
  type LocalPlaybackTrack,
} from '../services/librespotPlayer';

export interface LocalPlayerController {
  available: boolean;
  state:     LocalPlaybackState | null;
  busy:      boolean;
  error:     string;
  setEnabled:       (enabled: boolean) => Promise<void>;
  setKeepConnected: (enabled: boolean) => Promise<void>;
  playAlbum:        (tracks: LocalPlaybackTrack[], startIndex?: number) => Promise<void>;
  enqueueTrack:    (track: LocalPlaybackTrack, next?: boolean) => Promise<void>;
  jumpToQueueIndex: (index: number) => Promise<void>;
  removeQueueItem: (index: number) => Promise<void>;
  moveQueueItem:   (from: number, to: number) => Promise<void>;
  clearQueue:      () => Promise<void>;
  toggle:           () => Promise<void>;
  pause:            () => Promise<void>;
  resume:           () => Promise<void>;
  stop:             () => Promise<void>;
  next:             () => Promise<void>;
  previous:         () => Promise<void>;
  seek:             (positionMs: number) => Promise<void>;
  forgetAccount:    () => Promise<void>;
  applySettings:    (settings: LocalPlaybackSettings) => Promise<void>;
  getSettings:      () => Promise<LocalPlaybackSettings>;
  refresh:          () => Promise<void>;
}

/**
 * Polls the native librespot session. Playback itself lives in a foreground
 * service, so this hook only mirrors state into the WebView UI.
 */
export function useLocalPlayback(): LocalPlayerController {
  const [available] = useState(() => isLocalPlaybackAvailable());
  const [state, setState] = useState<LocalPlaybackState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = useCallback((next: LocalPlaybackState) => {
    setState(next);
    // The native player clears its error after a successful automatic retry;
    // mirror that so the stale "channel closed" banner disappears.
    setError(next.error ?? '');
  }, []);

  const refresh = useCallback(async () => {
    if (!available) return;
    try {
      apply(await getLocalPlaybackState());
    } catch {
      // The native side can be briefly unavailable during process restart.
    }
  }, [available, apply]);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await getLocalPlaybackState();
        if (!cancelled) apply(next);
      } catch {
        // Keep the last known state; actions report their own errors.
      }
    };

    void poll();
    const timer = window.setInterval(() => { void poll(); }, 600);
    const onVisible = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [available, apply]);

  const run = useCallback(async (action: () => Promise<LocalPlaybackState>) => {
    if (!available) return;
    setBusy(true);
    try {
      apply(await action());
    } catch (e: any) {
      setError(e?.message ?? 'Local playback failed.');
    } finally {
      setBusy(false);
    }
  }, [available, apply]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    await run(() => setLocalPlaybackEnabled(enabled));
  }, [run]);

  const setKeepConnected = useCallback(async (enabled: boolean) => {
    await run(() => setLocalPlaybackKeepConnected(enabled));
  }, [run]);

  const playAlbum = useCallback(async (tracks: LocalPlaybackTrack[], startIndex = 0) => {
    if (!tracks.length) return;
    await run(() => playLocalTracks(tracks, startIndex));
  }, [run]);

  const enqueueTrack = useCallback(async (track: LocalPlaybackTrack, next = false) => {
    if (!track.uri) return;
    await run(() => (next ? playNextLocalTrack(track) : enqueueLocalTrack(track)));
  }, [run]);

  const jumpToQueueIndex = useCallback(async (index: number) => {
    await run(() => jumpToLocalQueueIndex(index));
  }, [run]);

  const removeQueueItem = useCallback(async (index: number) => {
    await run(() => removeLocalQueueItem(index));
  }, [run]);

  const moveQueueItem = useCallback(async (from: number, to: number) => {
    await run(() => moveLocalQueueItem(from, to));
  }, [run]);

  const clearQueue = useCallback(async () => {
    await run(clearLocalQueueState);
  }, [run]);

  const toggle = useCallback(async () => { await run(toggleLocalPlayback); }, [run]);
  const pause = useCallback(async () => { await run(pauseLocalPlayback); }, [run]);
  const resume = useCallback(async () => { await run(resumeLocalPlayback); }, [run]);
  const stop = useCallback(async () => { await run(stopLocalPlayback); }, [run]);
  const next = useCallback(async () => { await run(nextLocalTrack); }, [run]);
  const previous = useCallback(async () => { await run(previousLocalTrack); }, [run]);
  const seek = useCallback(async (positionMs: number) => {
    await run(() => seekLocalPlayback(positionMs));
  }, [run]);
  const forgetAccount = useCallback(async () => {
    await run(forgetLocalPlaybackAccount);
  }, [run]);

  const applySettings = useCallback(async (settings: LocalPlaybackSettings) => {
    if (!available) return;
    setBusy(true);
    try {
      await setLocalPlaybackSettings(settings);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to apply audio settings.');
    } finally {
      setBusy(false);
    }
  }, [available, refresh]);

  const getSettings = useCallback(async () => {
    return getLocalPlaybackSettings();
  }, []);

  return {
    available,
    state,
    busy,
    error,
    setEnabled,
    setKeepConnected,
    playAlbum,
    enqueueTrack,
    jumpToQueueIndex,
    removeQueueItem,
    moveQueueItem,
    clearQueue,
    toggle,
    pause,
    resume,
    stop,
    next,
    previous,
    seek,
    forgetAccount,
    applySettings,
    getSettings,
    refresh,
  };
}
