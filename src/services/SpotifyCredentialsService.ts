import { Preferences } from '@capacitor/preferences';

const PREFS_CLIENT_ID   = 'spotify_creds_client_id';
const PREFS_CLIENT_SECRET = 'spotify_creds_client_secret';

// Dev-only: allow quick login using VITE_SPOTIFY_CLIENT_ID without shipping it to end users.
const DEV_CLIENT_ID = import.meta.env.DEV ? ((import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) ?? '') : '';

let _clientId    = DEV_CLIENT_ID;
let _clientSecret = '';

export async function loadSpotifyCredentials(): Promise<void> {
  try {
    const { value: cid } = await Preferences.get({ key: PREFS_CLIENT_ID });
    if (cid) _clientId = cid;
    const { value: cs } = await Preferences.get({ key: PREFS_CLIENT_SECRET });
    if (cs) _clientSecret = cs;
  } catch { /* ignore */ }
  if (!_clientId && DEV_CLIENT_ID) _clientId = DEV_CLIENT_ID;
}

export function getSpotifyClientId(): string {
  return _clientId.trim() || DEV_CLIENT_ID;
}

export function getSpotifyClientSecret(): string {
  return _clientSecret.trim();
}

export function hasSpotifyCredentials(): boolean {
  if (_clientId.trim().length > 0) return true;
  return !!DEV_CLIENT_ID;
}

export async function saveSpotifyCredentials(
  clientId: string,
  clientSecret: string,
): Promise<void> {
  _clientId = clientId.trim();
  _clientSecret = clientSecret.trim();
  if (_clientId) {
    await Preferences.set({ key: PREFS_CLIENT_ID, value: _clientId });
  } else {
    await Preferences.remove({ key: PREFS_CLIENT_ID });
  }
  if (_clientSecret) {
    await Preferences.set({ key: PREFS_CLIENT_SECRET, value: _clientSecret });
  } else {
    await Preferences.remove({ key: PREFS_CLIENT_SECRET });
  }
}