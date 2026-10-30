import { useState, useEffect, useCallback, useRef } from 'react';
import { Browser } from '@capacitor/browser';
import {
  serverLogin, serverRegister, serverLogout,
  fetchServerAuthStatus, fetchSpotifyStatus, fetchSpotifyAuthUrl, disconnectSpotify,
  SpotifyLink, ServerUser,
} from '../services/remote/serverAuth';
import { clearSession } from '../services/remote/apiClient';

export type ServerAuthState = 'loading' | 'authenticated' | 'unauthenticated';

export interface ServerAuth {
  authState: ServerAuthState;
  error:     string | null;
  busy:      boolean;
  user:      ServerUser | null;
  spotify:   SpotifyLink;
  login:     (email: string, password: string) => Promise<void>;
  register:  (email: string, password: string) => Promise<void>;
  logout:    () => Promise<void>;
  retry:     () => Promise<void>;
  openSpotifyLink:   () => Promise<void>;
  refreshSpotifyStatus: () => Promise<void>;
  disconnectSpotifyAccount: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Server auth — active only in remote (network) mode. Local mode keeps the
// existing PKCE hook untouched. Session validity is confirmed with
// /api/v1/auth/status (one transparent refresh-and-retry inside apiFetch);
// the Spotify link state is only fetched afterwards, since Phase 2 gates
// /spotify/status behind the user JWT.
// ---------------------------------------------------------------------------

export function useServerAuth(serverUrl: string, enabled: boolean): ServerAuth {
  const [authState, setAuthState] = useState<ServerAuthState>('loading');
  const [error,     setError]     = useState<string | null>(null);
  const [user,      setUser]      = useState<ServerUser | null>(null);
  const [spotify,   setSpotify]   = useState<SpotifyLink>({ connected: false, displayName: null });
  const [busy,      setBusy]      = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const checkSession = useCallback(async () => {
    if (!enabled) { setAuthState('unauthenticated'); return; }
    setAuthState('loading'); setError(null);
    try {
      const session = await fetchServerAuthStatus(serverUrl);
      if (!aliveRef.current) return;
      if (!session.authenticated) {
        setUser(null);
        setSpotify({ connected: false, displayName: null });
        setAuthState('unauthenticated');
        return;
      }
      setUser(session.user);
      // Authenticated: the link check rides the same JWT.
      const link = await fetchSpotifyStatus(serverUrl);
      if (!aliveRef.current) return;
      setSpotify(link);
      setAuthState('authenticated');
    } catch (e: any) {
      await clearSession();
      if (!aliveRef.current) return;
      // An error carrying no HTTP status never reached the server at all (refused
      // connection, wrong host, CORS) and is worth saying out loud. A real
      // response — even a plain 401 — just means logged out. Keyed on the status
      // rather than on message text, which used to never match here because the
      // failure arrives as a browser TypeError, leaving a silent logout.
      const status = typeof e?.status === 'number' ? e.status : 0;
      setError(status ? null : `Cannot reach ${serverUrl} — is the server running?`);
      setUser(null);
      setSpotify({ connected: false, displayName: null });
      setAuthState('unauthenticated');
    }
  }, [serverUrl, enabled]);

  useEffect(() => { checkSession(); }, [checkSession]);

  const login = useCallback(async (email: string, password: string) => {
    setBusy(true); setError(null);
    try {
      const u = await serverLogin(serverUrl, email.trim(), password);
      const link = await fetchSpotifyStatus(serverUrl);
      if (!aliveRef.current) return;
      setUser(u); setSpotify(link); setAuthState('authenticated');
    } catch (e: any) {
      if (aliveRef.current) setError(e?.message ?? 'Login failed');
      throw e;
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [serverUrl]);

  const register = useCallback(async (email: string, password: string) => {
    setBusy(true); setError(null);
    try {
      const u = await serverRegister(serverUrl, email.trim(), password);
      const link = await fetchSpotifyStatus(serverUrl);
      if (!aliveRef.current) return;
      setUser(u); setSpotify(link); setAuthState('authenticated');
    } catch (e: any) {
      if (aliveRef.current) setError(e?.message ?? 'Registration failed');
      throw e;
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [serverUrl]);

  const logout = useCallback(async () => {
    try { await serverLogout(serverUrl); } catch { /* session cleared regardless */ }
    setUser(null);
    setSpotify({ connected: false, displayName: null });
    setError(null);
    setAuthState('unauthenticated');
  }, [serverUrl]);

  const refreshSpotifyStatus = useCallback(async () => {
    const link = await fetchSpotifyStatus(serverUrl);
    if (aliveRef.current) setSpotify(link);
  }, [serverUrl]);

  const openSpotifyLink = useCallback(async () => {
    const url = await fetchSpotifyAuthUrl(serverUrl);
    await Browser.open({ url });
  }, [serverUrl]);

  const disconnectSpotifyAccount = useCallback(async () => {
    await disconnectSpotify(serverUrl);
    await refreshSpotifyStatus();
  }, [serverUrl, refreshSpotifyStatus]);

  return {
    authState, error, busy, user, spotify,
    login, register, logout, retry: checkSession,
    openSpotifyLink, refreshSpotifyStatus, disconnectSpotifyAccount,
  };
}
