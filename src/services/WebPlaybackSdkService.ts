// Web Playback SDK player service.
//
// This is intentionally NOT used by PlayerView.tsx. The on-device player remains
// untouched; this service exists so the official SDK can be evaluated without
// changing the existing player path.

interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, callback: (...args: any[]) => void): void;
  setVolume(volume: number): Promise<void>;
  togglePlay(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  activateElement(): Promise<void>;
}

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (callback: (token: string) => void) => void;
        volume?: number;
        enableMediaSession?: boolean;
      }) => SdkPlayer;
    };
    __spotifyWebPlaybackSdkPromise?: Promise<void>;
  }
}

let sdkPromise: Promise<void> | null = null;
let player: SdkPlayer | null = null;
let deviceId: string | null = null;
let readyPromise: Promise<string> | null = null;
let tokenGetter: (() => Promise<string>) | null = null;

export interface WebPlaybackSdkTrack {
  name: string;
  artist: string;
  album: string;
  image: string | null;
  uri: string;
}

export interface WebPlaybackSdkState {
  ready: boolean;
  deviceId: string | null;
  error: string | null;
  playbackError: string | null;
  playing: boolean;
  track: WebPlaybackSdkTrack | null;
  nextTracks: WebPlaybackSdkTrack[];
  position: number;
  duration: number;
  volume: number;
}

let state: WebPlaybackSdkState = {
  ready: false,
  deviceId: null,
  error: null,
  playbackError: null,
  playing: false,
  track: null,
  nextTracks: [],
  position: 0,
  duration: 0,
  volume: 0.5,
};

const listeners = new Set<(state: WebPlaybackSdkState) => void>();

function setState(patch: Partial<WebPlaybackSdkState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

export function getWebPlaybackSdkState(): WebPlaybackSdkState {
  return state;
}

export function subscribeWebPlaybackSdk(listener: (state: WebPlaybackSdkState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function setWebPlaybackSdkTokenGetter(getter: () => Promise<string>): void {
  tokenGetter = getter;
}

export interface WebPlaybackCapabilities {
  /** Encrypted Media Extensions are exposed at all. */
  eme: boolean;
  /** Key system the SDK will end up using, if any. */
  keySystem: string | null;
  /** DRM robustness actually granted by the device. */
  robustness: string | null;
  audioCodecs: string[];
  webViewVersion: string | null;
  secureContext: boolean;
  checkedAt: number;
}

function detectChromiumVersion(): string | null {
  const match = navigator.userAgent.match(/Chrome\/([\d.]+)/);
  return match ? match[1] : null;
}

/**
 * Report what the current WebView can actually decrypt.
 *
 * The Web Playback SDK streams through EME/Widevine, so a device that answers
 * `requestMediaKeySystemAccess` with a weaker robustness (or not at all) is the
 * usual explanation for audio that stalls or jumps forward mid-track.
 */
export async function probeWebPlaybackCapabilities(): Promise<WebPlaybackCapabilities> {
  const capabilities: WebPlaybackCapabilities = {
    eme: typeof navigator !== 'undefined' && typeof navigator.requestMediaKeySystemAccess === 'function',
    keySystem: null,
    robustness: null,
    audioCodecs: [],
    webViewVersion: detectChromiumVersion(),
    secureContext: typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false,
    checkedAt: Date.now(),
  };
  if (!capabilities.eme) return capabilities;

  const configurations: MediaKeySystemConfiguration[] = [
    {
      initDataTypes: ['cenc'],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: 'SW_SECURE_CRYPTO' }],
    },
    {
      initDataTypes: ['cenc'],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
    },
  ];

  for (const keySystem of ['com.widevine.alpha', 'com.microsoft.playready', 'org.w3.clearkey']) {
    for (const configuration of configurations) {
      try {
        const access = await navigator.requestMediaKeySystemAccess(keySystem, [configuration]);
        const granted = access.getConfiguration();
        capabilities.keySystem = keySystem;
        capabilities.robustness = granted.audioCapabilities?.[0]?.robustness || null;
        capabilities.audioCodecs = (granted.audioCapabilities ?? [])
          .map((item) => item.contentType)
          .filter((contentType): contentType is string => Boolean(contentType));
        return capabilities;
      } catch {
        // Try the next configuration, then the next key system.
      }
    }
  }

  return capabilities;
}

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load the Spotify Web Playback SDK.'));
    document.body.appendChild(script);
    (window as any).onSpotifyWebPlaybackSDKReady = () => resolve();
  });

  return sdkPromise;
}

export async function initWebPlaybackSdk(getToken?: () => Promise<string>): Promise<string> {
  if (getToken) tokenGetter = getToken;
  if (deviceId) return deviceId;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    await loadSdk();
    if (deviceId) return deviceId;
    if (!window.Spotify) throw new Error('Spotify Web Playback SDK is not available.');

    player = new window.Spotify.Player({
      name: 'reSpotIt Player',
      getOAuthToken: (callback) => {
        void (tokenGetter ? tokenGetter() : Promise.reject(new Error('No Spotify token.')))
          .then(callback)
          .catch((error: unknown) => {
            setState({ error: error instanceof Error ? error.message : 'Spotify token failed.' });
          });
      },
      volume: 0.5,
      enableMediaSession: true,
    });

    player.addListener('ready', ({ device_id }: { device_id: string }) => {
      deviceId = device_id;
      setState({ ready: true, deviceId: device_id, error: null });
    });    player.addListener('not_ready', () => {
      setState({ ready: false });
    });
    player.addListener('initialization_error', ({ message }: { message: string }) => {
      console.warn(`[spotify-sdk] initialization_error: ${message}`);
      setState({ error: message });
    });
    player.addListener('authentication_error', ({ message }: { message: string }) => {
      console.warn(`[spotify-sdk] authentication_error: ${message}`);
      setState({ error: message });
    });
    player.addListener('account_error', () => {
      console.warn('[spotify-sdk] account_error: Premium required');
      setState({ error: 'Spotify Premium is required for the Web Playback SDK.' });
    });
    player.addListener('autoplay_failed', () => {
      console.warn('[spotify-sdk] autoplay_failed');
      setState({ error: 'Autoplay is blocked. Tap Connect to activate playback on this device.' });
    });
    player.addListener('playback_error', ({ message }: { message: string }) => {
      // Also goes to logcat so the exact SDK message can be pulled with adb.
      console.warn(`[spotify-sdk] playback_error: ${message}`);
      setState({ playbackError: message || 'Spotify reported a playback error on this device.' });
    });
    player.addListener('player_state_changed', (sdkState: any) => {
      if (!sdkState) return;
      const current = sdkState.track_window?.current_track;
      const nextTracks = (sdkState.track_window?.next_tracks ?? []).map((track: any) => ({
        name: track.name ?? 'Unknown track',
        artist: (track.artists ?? []).map((artist: any) => artist.name).join(', '),
        album: track.album?.name ?? '',
        image: track.album?.images?.[0]?.url ?? null,
        uri: track.uri ?? '',
      }));
      setState({
        playing: !sdkState.paused,
        position: sdkState.position ?? 0,
        duration: sdkState.duration ?? 0,
        track: current
          ? {
              name: current.name ?? 'Unknown track',
              artist: (current.artists ?? []).map((artist: any) => artist.name).join(', '),
              album: current.album?.name ?? '',
              image: current.album?.images?.[0]?.url ?? null,
              uri: current.uri ?? '',
            }
          : state.track,
        nextTracks,
      });
    });

    const connected = await player.connect();
    if (!connected) throw new Error('Could not connect the Web Playback SDK.');

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Web Playback SDK did not become ready.')), 15000);
      const interval = window.setInterval(() => {
        if (deviceId) {
          window.clearInterval(interval);
          window.clearTimeout(timer);
          resolve();
        }
      }, 100);
    });

    if (!deviceId) throw new Error('Web Playback SDK did not provide a device ID.');
    return deviceId;
  })();

  try {
    return await readyPromise;
  } catch (error) {
    readyPromise = null;
    player = null;
    deviceId = null;
    setState({ ready: false, error: error instanceof Error ? error.message : 'Web Playback SDK setup failed.' });
    throw error;
  }
}

export async function playContextWithWebPlaybackSdk(
  contextUri: string,
  getToken?: () => Promise<string>,
  offset = 0,
): Promise<void> {
  const token = getToken ? await getToken() : tokenGetter ? await tokenGetter() : null;
  if (!token) throw new Error('Spotify token is not available.');

  const id = await initWebPlaybackSdk(getToken ?? tokenGetter ?? undefined);
  const url = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(id)}`;
  const body: Record<string, unknown> = { context_uri: contextUri };
  if (offset > 0) body.offset = { position: offset };
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify play failed (${response.status}): ${text}`);
  }
  setState({ error: null });
}

export async function playWithWebPlaybackSdk(uris: string[], getToken?: () => Promise<string>): Promise<void> {
  if (getToken) tokenGetter = getToken;
  const token = tokenGetter ? await tokenGetter() : null;
  if (!token) throw new Error('Spotify token is not available.');

  const id = await initWebPlaybackSdk(tokenGetter ?? undefined);
  const url = `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify play failed (${response.status}): ${text}`);
  }
  setState({ error: null });
}

async function getToken(): Promise<string> {
  if (!tokenGetter) throw new Error('Spotify token is not available.');
  const token = await tokenGetter();
  if (!token) throw new Error('Spotify token is not available.');
  return token;
}

export async function activateWebPlaybackElement(): Promise<void> {
  try { await player?.activateElement?.(); } catch { /* ignore */ }
}

export async function toggleWebPlayback(): Promise<void> {
  const token = await getToken();
  const endpoint = state.playing ? 'pause' : 'play';
  const url = deviceId
    ? `https://api.spotify.com/v1/me/player/${endpoint}?device_id=${encodeURIComponent(deviceId)}`
    : `https://api.spotify.com/v1/me/player/${endpoint}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`Spotify ${endpoint} failed (${response.status}): ${text}`);
  }
  try { await player?.togglePlay?.(); } catch { /* ignore */ }
}

export async function nextWebPlayback(): Promise<void> {
  const token = await getToken();
  const response = await fetch('https://api.spotify.com/v1/me/player/next', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`Spotify next failed (${response.status}): ${text}`);
  }
  try { await player?.nextTrack?.(); } catch { /* ignore */ }
}

export async function previousWebPlayback(): Promise<void> {
  const token = await getToken();
  const response = await fetch('https://api.spotify.com/v1/me/player/previous', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`Spotify previous failed (${response.status}): ${text}`);
  }
  try { await player?.previousTrack?.(); } catch { /* ignore */ }
}

export async function seekWebPlayback(value: number): Promise<void> {
  const token = await getToken();
  const positionMs = Number(value);
  const url = deviceId
    ? `https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}&device_id=${encodeURIComponent(deviceId)}`
    : `https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`Spotify seek failed (${response.status}): ${text}`);
  }
  try { await player?.seek?.(positionMs); } catch { /* ignore */ }
}

export async function setWebPlaybackVolume(value: number): Promise<void> {
  const volume = Number(value);
  setState({ volume });
  await player?.setVolume?.(volume);
}

export function disconnectWebPlaybackSdk(): void {
  try {
    player?.disconnect();
  } catch {
    // Ignore cleanup errors.
  }
  player = null;
  deviceId = null;
  readyPromise = null;
  state = { ready: false, deviceId: null, error: null, playbackError: null, playing: false, track: null, nextTracks: [], position: 0, duration: 0, volume: 0.5 };
  listeners.forEach((listener) => listener(state));
}


export interface SpotifyPlaybackDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
}

export async function getSpotifyPlaybackDevices(getToken?: () => Promise<string>): Promise<SpotifyPlaybackDevice[]> {
  const token = getToken ? await getToken() : tokenGetter ? await tokenGetter() : null;
  if (!token) throw new Error('Spotify token is not available.');

  const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify devices failed (${response.status}): ${text}`);
  }
  const data = (await response.json()) as { devices?: SpotifyPlaybackDevice[] };
  return data.devices ?? [];
}

export async function transferPlaybackToDevice(
  targetDeviceId: string,
  getToken?: () => Promise<string>,
  play = false,
): Promise<void> {
  const token = getToken ? await getToken() : tokenGetter ? await tokenGetter() : null;
  if (!token) throw new Error('Spotify token is not available.');

  const response = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_ids: [targetDeviceId], play }),
  });

  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`Spotify device transfer failed (${response.status}): ${text}`);
  }
}

interface PlaybackSnapshot {
  wasPlaying: boolean;
  itemUri: string | null;
  contextUri: string | null;
  progressMs: number;
  deviceId: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchPlaybackSnapshot(token: string): Promise<PlaybackSnapshot> {
  const empty: PlaybackSnapshot = {
    wasPlaying: false,
    itemUri: null,
    contextUri: null,
    progressMs: 0,
    deviceId: null,
  };
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok || response.status === 204) return empty;
    const data = await response.json() as {
      is_playing?: boolean;
      progress_ms?: number;
      item?: { uri?: string };
      context?: { uri?: string };
      device?: { id?: string };
    };
    return {
      wasPlaying: Boolean(data.is_playing),
      itemUri: data.item?.uri ?? null,
      contextUri: data.context?.uri ?? null,
      progressMs: data.progress_ms ?? 0,
      deviceId: data.device?.id ?? null,
    };
  } catch {
    return empty;
  }
}

async function waitForActiveDevice(
  token: string,
  targetDeviceId: string,
  timeoutMs = 8000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await fetchPlaybackSnapshot(token);
    if (snapshot.deviceId === targetDeviceId) return true;
    await sleep(250);
  }
  return false;
}

async function playOnDevice(
  token: string,
  deviceId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`Spotify play failed (${response.status}): ${text}`);
  }
}

async function waitForTrack(
  token: string,
  targetDeviceId: string,
  expectedUri: string,
  timeoutMs = 6000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await fetchPlaybackSnapshot(token);
    if (snapshot.deviceId === targetDeviceId && snapshot.itemUri === expectedUri) return true;
    await sleep(250);
  }
  return false;
}

export async function transferPlaybackToDeviceAndResume(
  targetDeviceId: string,
  getToken?: () => Promise<string>,
): Promise<void> {
  const token = getToken ? await getToken() : tokenGetter ? await tokenGetter() : null;
  if (!token) throw new Error('Spotify token is not available.');

  const snapshot = await fetchPlaybackSnapshot(token);

  const transferRes = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_ids: [targetDeviceId], play: false }),
  });
  if (!transferRes.ok && transferRes.status !== 204) {
    const text = await transferRes.text();
    throw new Error(`Spotify device transfer failed (${transferRes.status}): ${text}`);
  }

  if (!snapshot.wasPlaying) return;

  // Give Spotify Connect time to make the target the active device before
  // issuing the explicit play. Playing too early can start the target's own
  // stale queue and skip tracks.
  await waitForActiveDevice(token, targetDeviceId);

  const body: Record<string, unknown> = {};
  if (snapshot.contextUri) {
    body.context_uri = snapshot.contextUri;
    if (snapshot.itemUri) body.offset = { uri: snapshot.itemUri };
  } else if (snapshot.itemUri) {
    body.uris = [snapshot.itemUri];
  }
  if (snapshot.progressMs > 0) body.position_ms = snapshot.progressMs;

  await playOnDevice(token, targetDeviceId, body);

  if (!snapshot.itemUri) return;

  const matched = await waitForTrack(token, targetDeviceId, snapshot.itemUri);
  if (matched) return;

  // The context/offset can resolve to a different duplicate. Fall back to an
  // explicit single-track play so the transfer never skips ahead.
  await playOnDevice(token, targetDeviceId, {
    uris: [snapshot.itemUri],
    ...(snapshot.progressMs > 0 ? { position_ms: snapshot.progressMs } : {}),
  });

  if (!await waitForTrack(token, targetDeviceId, snapshot.itemUri)) {
    throw new Error('Playback transferred, but the target device did not resume the expected track.');
  }
}
