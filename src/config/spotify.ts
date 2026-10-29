import { Capacitor } from '@capacitor/core';

// Client ID is read from the environment so it is never committed to source control.
// Copy .env.example → .env and set VITE_SPOTIFY_CLIENT_ID.
const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
if (!clientId) {
  throw new Error(
    'VITE_SPOTIFY_CLIENT_ID is not set. ' +
    'Copy .env.example to .env and add your Spotify Client ID.',
  );
}
export const SPOTIFY_CLIENT_ID = clientId;

// Must be registered EXACTLY in your Spotify App's Redirect URIs
export const SPOTIFY_REDIRECT_URI = 'com.spotifydashboard.app://callback';

/**
 * Loopback callback for local web dev — desktop browsers can't handle the
 * custom scheme above. Spotify only whitelists the 127.0.0.1 loopback IP
 * (never the localhost name), so the app auto-parks localhost users on
 * 127.0.0.1 before starting the flow: register the dev origin exactly,
 *   http://127.0.0.1:3002/callback
 */
export const SPOTIFY_WEB_REDIRECT_PATH = '/callback';

/** True when running as a plain web page served from a loopback host. */
export function isWebLoopback(): boolean {
  if (typeof window === 'undefined') return false;
  if (Capacitor.getPlatform() !== 'web') return false; // native build keeps the scheme
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export const SPOTIFY_SCOPES = [
  // Library
  'user-library-read',
  'user-library-modify',

  // Follow artists
  'user-follow-read',
  'user-follow-modify',

  // User profile (needed to identify owned playlists + create playlists)
  'user-read-private',
  'user-read-email',

  // Playlists — read
  'playlist-read-private',
  'playlist-read-collaborative',

  // Playlists — write (create + add tracks)
  'playlist-modify-private',
  'playlist-modify-public',

  // Queue — requires Premium
  'user-modify-playback-state',
  // Player tab — read the current item, queue and devices
  'user-read-playback-state',
  'user-read-currently-playing',

  // Official Web Playback SDK (separate diagnostic path only)
  'streaming',
].join(' ');

export const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com';
export const SPOTIFY_API_URL      = 'https://api.spotify.com/v1';
