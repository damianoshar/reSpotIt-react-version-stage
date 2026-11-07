import { getValidAccessToken } from './SpotifyAuthService';
import { SPOTIFY_API_URL } from '../config/spotify';
import { sleep } from '../utils/spotifyFetch';

// ---------------------------------------------------------------------------
// Playback / device types (only the fields the Player UI uses)
// ---------------------------------------------------------------------------

export interface PlaybackArtist { name: string; }

export interface PlaybackAlbum {
  name:    string;
  images?: { url: string }[];
}

export interface PlaybackTrack {
  uri:         string;
  name:        string;
  duration_ms: number;
  artists:     PlaybackArtist[];
  album:       PlaybackAlbum | null;
}

export interface PlaybackState {
  isPlaying:         boolean;
  progressMs:        number;
  progressAt:        number;
  deviceName:        string;
  track:             PlaybackTrack | null;
  queue:             PlaybackTrack[];
  contextUri:        string;
  contextType:       string;
  contextPlaylistId: string | null;
  contextName:       string;
  contextEditable:   boolean;
  repeatState:       string;
}

export interface PlaybackDevice {
  id:          string;
  name:        string;
  is_active:   boolean;
  is_restricted: boolean;
  type:        string;
}

interface RawTrack {
  uri?:         string;
  name?:        string;
  duration_ms?: number;
  artists?:     { name?: string }[];
  album?:       { name?: string; images?: { url?: string }[] } | null;
}

interface RawCurrentPlayback {
  is_playing?:  boolean;
  progress_ms?: number;
  repeat_state?: string;
  device?:      { name?: string } | null;
  item?:        RawTrack | null;
  context?:     { uri?: string; type?: string } | null;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export class SpotifyPlaybackError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SpotifyPlaybackError';
    this.status = status;
  }
}

async function spotifyRequest<T>(
  path: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<T | null> {
  const token = await getValidAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${SPOTIFY_API_URL}${path}`, { ...init, headers });

  if (res.status === 204) return null;

  if (res.status === 429) {
    if (attempt >= 3) throw new SpotifyPlaybackError(429, 'Spotify rate limit reached — try again shortly.');
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '2', 10);
    await sleep(retryAfter * 1000);
    return spotifyRequest<T>(path, init, attempt + 1);
  }

  if (res.status === 401) {
    throw new SpotifyPlaybackError(401, 'Spotify session expired. Sign in to Spotify again.');
  }
  if (res.status === 403) {
    throw new SpotifyPlaybackError(403, 'Spotify Premium and playback permission are required.');
  }
  if (!res.ok) {
    throw new SpotifyPlaybackError(res.status, `Spotify request failed (HTTP ${res.status}).`);
  }

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SpotifyPlaybackError(res.status, 'Spotify returned an unreadable response.');
  }
}

function mapTrack(raw: RawTrack | null | undefined): PlaybackTrack | null {
  if (!raw?.uri) return null;
  return {
    uri:         raw.uri,
    name:        raw.name ?? 'Unknown track',
    duration_ms: raw.duration_ms ?? 0,
    artists:     (raw.artists ?? []).map((artist) => ({ name: artist.name ?? '' })),
    album:       raw.album
      ? {
          name:   raw.album.name ?? '',
          images: (raw.album.images ?? []).map((image) => ({ url: image.url ?? '' })),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Read-only snapshot of Spotify's current playback state. `null` = stopped. */
export async function getCurrentPlayback(): Promise<RawCurrentPlayback | null> {
  return spotifyRequest<RawCurrentPlayback>('/me/player');
}

/** The up-next queue. Spotify returns the current item separately. */
export async function getQueue(): Promise<PlaybackTrack[]> {
  const data = await spotifyRequest<{ queue?: RawTrack[] }>('/me/player/queue');
  return (data?.queue ?? []).map(mapTrack).filter((track): track is PlaybackTrack => track != null);
}

/** Devices that can play right now (needs `user-read-playback-state`). */
export async function getDevices(): Promise<PlaybackDevice[]> {
  const data = await spotifyRequest<{ devices?: PlaybackDevice[] }>('/me/player/devices');
  return data?.devices ?? [];
}

/**
 * The device that should receive a playback command: the active one, or the
 * first controllable device when nothing is active yet. Restricted devices
 * (private sessions) refuse every Web API command.
 */
export function pickPlaybackDevice(devices: PlaybackDevice[]): PlaybackDevice | null {
  return devices.find((device) => device.is_active && !device.is_restricted && !!device.id)
    ?? devices.find((device) => !device.is_restricted && !!device.id)
    ?? null;
}

// ---------------------------------------------------------------------------
// Playback command
// ---------------------------------------------------------------------------

/**
 * Hand playback over to a playlist, continuing at `offset` inside it. This is
 * how the queue playlist works: the playlist holds the current track, the
 * up-next queue and the selected albums; playback continues at the first
 * queued track.
 */
export async function playPlaylistAsContext(
  playlistId: string,
  deviceId: string | null,
  offset: number,
): Promise<void> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  try {
    await spotifyRequest<unknown>(`/me/player/play${query}`, {
      method: 'PUT',
      body: JSON.stringify({
        context_uri: `spotify:playlist:${playlistId}`,
        offset: { position: Math.max(0, offset) },
      }),
    });
  } catch (error) {
    if (error instanceof SpotifyPlaybackError) {
      if (error.status === 403) throw new Error('Premium required or no active device.');
      if (error.status === 404) throw new Error('No active device found — open Spotify on a device first.');
    }
    throw error;
  }
}

/**
 * Start playback of a single track on the active Spotify device. Used by the
 * Player tab's up-next list so a queued track can be played directly.
 */
export async function playTrack(uri: string): Promise<void> {
  try {
    await spotifyRequest<unknown>('/me/player/play', {
      method: 'PUT',
      body: JSON.stringify({ uris: [uri] }),
    });
  } catch (error) {
    if (error instanceof SpotifyPlaybackError) {
      if (error.status === 403) throw new Error('Premium required or no active device.');
      if (error.status === 404) throw new Error('No active device found — open Spotify on a device first.');
    }
    throw error;
  }
}

/**
 * Start playback from a chosen point in the current up-next queue. Passing the
 * selected track and everything after it keeps the queue playing instead of
 * replacing playback with a single track.
 */
export async function playTracks(uris: string[]): Promise<void> {
  const playable = uris.filter(Boolean);
  if (!playable.length) return;
  try {
    await spotifyRequest<unknown>('/me/player/play', {
      method: 'PUT',
      body: JSON.stringify({ uris: playable }),
    });
  } catch (error) {
    if (error instanceof SpotifyPlaybackError) {
      if (error.status === 403) throw new Error('Premium required or no active device.');
      if (error.status === 404) throw new Error('No active device found — open Spotify on a device first.');
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Mapping / formatting
// ---------------------------------------------------------------------------

export async function queueTrackToSpotifyActive(uri: string): Promise<boolean> {
  const token = await getValidAccessToken();
  const res = await fetch(
    `${SPOTIFY_API_URL}/me/player/queue?uri=${encodeURIComponent(uri)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 403) throw new Error('Spotify Premium required or no active device');
  if (res.status !== 204) return false;
  await sleep(80);
  return true;
}

export function toPlaybackState(
  current: RawCurrentPlayback | null,
  queue: PlaybackTrack[],
  contextName = '',
  contextEditable = false,
): PlaybackState {
  const contextUri = current?.context?.uri ?? '';
  const contextType = current?.context?.type ?? '';
  const contextPlaylistId = contextUri.startsWith('spotify:playlist:')
    ? contextUri.slice('spotify:playlist:'.length)
    : null;

  return {
    isPlaying:         current?.is_playing === true,
    progressMs:        current?.progress_ms ?? 0,
    progressAt:        Date.now(),
    deviceName:        current?.device?.name ?? '',
    track:             mapTrack(current?.item),
    queue,
    contextUri,
    contextType,
    contextPlaylistId,
    contextName,
    contextEditable,
    repeatState:       current?.repeat_state ?? 'off',
  };
}

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
