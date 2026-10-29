import { apiFetch, setSession, clearSession } from './apiClient';

// ---------------------------------------------------------------------------
// Server auth — email/password account JWT + Spotify account linking.
// Pairs with the elixir Api.AuthController / Api.SpotifyAuthController.
// ---------------------------------------------------------------------------

export interface ServerUser {
  id:    number | string;
  email: string;
}

interface SessionPayload {
  access_token:  string;
  refresh_token: string;
  user:          ServerUser;
}

export async function serverLogin(base: string, email: string, password: string): Promise<ServerUser> {
  const s = await apiFetch<SessionPayload>(
    base, '/api/v1/auth/login', { method: 'POST', body: { email, password }, auth: false }
  );
  if (!s?.access_token || !s?.refresh_token) throw new Error('Login failed — bad server response');
  await setSession(s.access_token, s.refresh_token);
  return s.user;
}

export async function serverRegister(base: string, email: string, password: string): Promise<ServerUser> {
  const s = await apiFetch<SessionPayload>(
    base, '/api/v1/auth/register', { method: 'POST', body: { email, password }, auth: false }
  );
  if (!s?.access_token || !s?.refresh_token) throw new Error('Registration failed — bad server response');
  await setSession(s.access_token, s.refresh_token);
  return s.user;
}

export async function serverLogout(base: string): Promise<void> {
  // Best-effort: JWTs are stateless, the client session is the source of truth.
  await apiFetch(base, '/api/v1/auth/logout', { method: 'POST' }).catch(() => null);
  await clearSession();
}

export interface SpotifyLink {
  connected:   boolean;
  displayName: string | null;
}

export async function fetchServerAuthStatus(base: string): Promise<{
  authenticated: boolean;
  user: ServerUser | null;
}> {
  const data = await apiFetch<{
    authenticated: boolean;
    user_id?: string | number | null;
    email?: string | null;
  }>(base, '/api/v1/auth/status');
  if (!data?.authenticated) return { authenticated: false, user: null };
  const id = data.user_id ?? null;
  return {
    authenticated: true,
    user: { id: id as number | string, email: data.email ?? String(id ?? '') },
  };
}

export async function fetchSpotifyStatus(base: string): Promise<SpotifyLink> {
  const data = await apiFetch<{ connected: boolean; display_name: string | null }>(
    base, '/api/v1/spotify/status'
  );
  return { connected: !!data.connected, displayName: data.display_name ?? null };
}

/** Returns the Spotify authorize URL to open in a system browser/Custom Tab. */
export async function fetchSpotifyAuthUrl(base: string): Promise<string> {
  const data = await apiFetch<{ auth_url: string }>(base, '/api/v1/auth/spotify/login');
  if (!data?.auth_url) throw new Error('Server did not return an auth URL');
  return data.auth_url;
}

export async function disconnectSpotify(base: string): Promise<void> {
  await apiFetch(base, '/api/v1/auth/spotify', { method: 'DELETE' });
}
