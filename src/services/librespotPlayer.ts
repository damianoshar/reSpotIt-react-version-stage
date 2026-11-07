import { Capacitor, registerPlugin } from '@capacitor/core';

// ---------------------------------------------------------------------------
// On-device librespot playback
//
// This is the JS side of native/audio-librespot. It is independent from the
// dashboard's Spotify Web API login: the native player owns its own reusable
// librespot credentials (first play opens Spotify's consent page).
// ---------------------------------------------------------------------------

export interface LocalPlaybackTrack {
  uri:        string;
  title:      string;
  artist:     string;
  durationMs: number;
  artUrl?:    string | null;
}

export interface LocalPlaybackSettings {
  bitrateKbps: number;
  bufferSeconds: number;
  cacheMb: number;
  deviceName: string;
  audioFocusPauseTransient: boolean;
}

export interface LocalPlaybackState {
  enabled:       boolean;
  keepConnected: boolean;
  connected:     boolean;
  connecting:    boolean;
  isPlaying:     boolean;
  remote:        boolean;
  title:         string;
  artist:        string;
  artUrl:        string | null;
  durationMs:    number;
  positionMs:    number;
  error:         string | null;
  needsAuth:     boolean;
  /**
   * Window of the local queue starting at the current track (capped by the
   * native bridge). Use `queueTotal`/`queuePosition` for the real counts.
   */
  queue:         LocalPlaybackTrack[];
  /** Index of the current track in `queue`, or -1 when there is no queue. */
  queueIndex:    number;
  /** Total number of tracks in the native queue. */
  queueTotal?:   number;
  /** Real zero-based position of the current track in the native queue. */
  queuePosition?: number;
  available?:    boolean;
}

interface LibrespotPlayerPlugin {
  getState(): Promise<LocalPlaybackState>;
  setEnabled(options: { enabled: boolean }): Promise<LocalPlaybackState>;
  setKeepConnected(options: { enabled: boolean }): Promise<LocalPlaybackState>;
  play(options: { tracks: LocalPlaybackTrack[]; startIndex: number }): Promise<LocalPlaybackState>;
  enqueue(options: { uri: string; title: string; artist: string; durationMs: number; artUrl?: string | null }): Promise<LocalPlaybackState>;
  insertNext(options: { uri: string; title: string; artist: string; durationMs: number; artUrl?: string | null }): Promise<LocalPlaybackState>;
  insertAt(options: { index: number; uri: string; title: string; artist: string; durationMs: number; artUrl?: string | null }): Promise<LocalPlaybackState>;
  remove(options: { index: number }): Promise<LocalPlaybackState>;
  move(options: { from: number; to: number }): Promise<LocalPlaybackState>;
  clearQueue(): Promise<LocalPlaybackState>;
  playIndex(options: { index: number }): Promise<LocalPlaybackState>;
  toggle(): Promise<LocalPlaybackState>;
  pause(): Promise<LocalPlaybackState>;
  resume(): Promise<LocalPlaybackState>;
  stop(): Promise<LocalPlaybackState>;
  next(): Promise<LocalPlaybackState>;
  previous(): Promise<LocalPlaybackState>;
  seek(options: { positionMs: number }): Promise<LocalPlaybackState>;
  forgetAccount(): Promise<LocalPlaybackState>;
  setSettings(options: {
    bitrate: string;
    bufferSeconds: number;
    cacheMb: number;
    deviceName: string;
    audioFocusPauseTransient: boolean;
  }): Promise<LocalPlaybackSettings>;
  getSettings(): Promise<LocalPlaybackSettings>;
}

const plugin = registerPlugin<LibrespotPlayerPlugin>('LibrespotPlayer');

export function isLocalPlaybackAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('LibrespotPlayer');
}

export function getLocalPlaybackState(): Promise<LocalPlaybackState> {
  return plugin.getState();
}

export function setLocalPlaybackEnabled(enabled: boolean): Promise<LocalPlaybackState> {
  return plugin.setEnabled({ enabled });
}

export function setLocalPlaybackKeepConnected(enabled: boolean): Promise<LocalPlaybackState> {
  return plugin.setKeepConnected({ enabled });
}

export function playLocalTracks(
  tracks: LocalPlaybackTrack[],
  startIndex = 0,
): Promise<LocalPlaybackState> {
  return plugin.play({ tracks, startIndex });
}

function trackBridgeArgs(track: LocalPlaybackTrack): {
  uri: string;
  title: string;
  artist: string;
  durationMs: number;
  artUrl: string | null;
} {
  return {
    uri:        track.uri,
    title:      track.title,
    artist:     track.artist,
    durationMs: track.durationMs,
    artUrl:     track.artUrl ?? null,
  };
}

export function enqueueLocalTrack(track: LocalPlaybackTrack): Promise<LocalPlaybackState> {
  return plugin.enqueue(trackBridgeArgs(track));
}

export function playNextLocalTrack(track: LocalPlaybackTrack): Promise<LocalPlaybackState> {
  return plugin.insertNext(trackBridgeArgs(track));
}

export function insertLocalTrack(index: number, track: LocalPlaybackTrack): Promise<LocalPlaybackState> {
  return plugin.insertAt({ index, ...trackBridgeArgs(track) });
}

export function removeLocalQueueItem(index: number): Promise<LocalPlaybackState> {
  return plugin.remove({ index });
}

export function moveLocalQueueItem(from: number, to: number): Promise<LocalPlaybackState> {
  return plugin.move({ from, to });
}

export function clearLocalQueueState(): Promise<LocalPlaybackState> {
  return plugin.clearQueue();
}

export function jumpToLocalQueueIndex(index: number): Promise<LocalPlaybackState> {
  return plugin.playIndex({ index });
}
export function toggleLocalPlayback(): Promise<LocalPlaybackState> {
  return plugin.toggle();
}

export function pauseLocalPlayback(): Promise<LocalPlaybackState> {
  return plugin.pause();
}

export function resumeLocalPlayback(): Promise<LocalPlaybackState> {
  return plugin.resume();
}

export function stopLocalPlayback(): Promise<LocalPlaybackState> {
  return plugin.stop();
}

export function nextLocalTrack(): Promise<LocalPlaybackState> {
  return plugin.next();
}

export function previousLocalTrack(): Promise<LocalPlaybackState> {
  return plugin.previous();
}

export function seekLocalPlayback(positionMs: number): Promise<LocalPlaybackState> {
  return plugin.seek({ positionMs: Math.max(0, Math.round(positionMs)) });
}

export function forgetLocalPlaybackAccount(): Promise<LocalPlaybackState> {
  return plugin.forgetAccount();
}

export function getLocalPlaybackSettings(): Promise<LocalPlaybackSettings> {
  return plugin.getSettings();
}

export function setLocalPlaybackSettings(settings: LocalPlaybackSettings): Promise<LocalPlaybackSettings> {
  return plugin.setSettings({
    bitrate: String(settings.bitrateKbps),
    bufferSeconds: settings.bufferSeconds,
    cacheMb: settings.cacheMb,
    deviceName: settings.deviceName,
    audioFocusPauseTransient: settings.audioFocusPauseTransient,
  });
}
