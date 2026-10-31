import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import {
  SpotifyTokens,
  loadStoredTokens,
  startAuthFlow,
  clearTokens,
  registerAppUrlListener,
  setAuthUrlHandler,
  consumeLoopbackCallback,
  completeAuthFromUrl,
  isAuthCallbackUrl,
  matchesPendingPkce,
} from '../services/SpotifyAuthService';
import { clearUserIdCache } from '../services/SpotifyPlaylistService';

export type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

// React StrictMode mounts effects twice in development. The ?connect=1
// hand-off must launch at most one Spotify authorization; a second pass would
// open another login tab (or replay the redirect) before the first returns.
let autoConnectStarted = false;

export function useSpotifyAuth() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [tokens, setTokens]       = useState<SpotifyTokens | null>(null);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Completes the login and publishes the result. The service dedupes
    // concurrent completions of the same callback URL.
    const completeFromUrl = async (url: string) => {
      try {
        const t = await completeAuthFromUrl(url);
        if (cancelled) return;
        setTokens(t);
        setAuthState('authenticated');
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? 'Login failed');
        setAuthState('unauthenticated');
      }
    };

    // ✅ Register the deep-link listener immediately at app boot,
    //    BEFORE any browser is ever opened — prevents race conditions.
    registerAppUrlListener();

    // A callback can arrive without a live startAuthFlow() promise when the OS
    // killed the WebView while the browser was open. Only act when a persisted
    // PKCE attempt is waiting, so stale launch intents aren't replayed.
    setAuthUrlHandler((url) => {
      if (isAuthCallbackUrl(url) && matchesPendingPkce(url)) {
        void completeFromUrl(url);
      }
    });

    (async () => {
      try {
        // Cold start from the OAuth deep link: recover the code exchange from
        // localStorage instead of dropping the URL (previous behaviour).
        if (Capacitor.getPlatform() !== 'web') {
          const launch = await App.getLaunchUrl();
          if (launch?.url && isAuthCallbackUrl(launch.url) && matchesPendingPkce(launch.url)) {
            await completeFromUrl(launch.url);
            return;
          }
        }

        // Web loopback return-trip (?code=…) completes here; native resolves
        // null and falls through to stored tokens below.
        const t = await consumeLoopbackCallback();
        if (t) {
          if (!cancelled) { setTokens(t); setAuthState('authenticated'); }
          return;
        }
        const stored = await loadStoredTokens();
        if (cancelled) return;

        const autoConnect = new URLSearchParams(window.location.search).get('connect') === '1';
        if (autoConnect && !stored && !autoConnectStarted) {
          autoConnectStarted = true;
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('connect');
          window.history.replaceState({}, '', cleanUrl.toString());
          try {
            const t = await startAuthFlow();
            if (cancelled) return;
            setTokens(t);
            setAuthState('authenticated');
            setError(null);
          } catch (e: any) {
            autoConnectStarted = false;
            if (cancelled) return;
            setError(e?.message ?? 'Login failed');
            setAuthState('unauthenticated');
          }
          return;
        }

        if (stored) { setTokens(stored); setAuthState('authenticated'); }
        else        { setAuthState('unauthenticated'); }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? 'Login failed');
        setAuthState('unauthenticated');
      }
    })();

    return () => {
      cancelled = true;
      setAuthUrlHandler(null);
    };
  }, []);

  const login = useCallback(async () => {
    setError(null);
    try {
      const t = await startAuthFlow();
      setTokens(t);
      setAuthState('authenticated');
    } catch (e: any) {
      setError(e?.message ?? 'Login failed');
      setAuthState('unauthenticated');
    }
  }, []);

  const logout = useCallback(async () => {
    await clearTokens();
    clearUserIdCache();
    setTokens(null);
    setAuthState('unauthenticated');
  }, []);

  return { authState, tokens, error, login, logout };
}
