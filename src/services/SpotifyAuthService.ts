import { Browser }      from '@capacitor/browser';
import { App }          from '@capacitor/app';
import { Preferences }  from '@capacitor/preferences';
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_WEB_REDIRECT_PATH,
  SPOTIFY_SCOPES,
  SPOTIFY_ACCOUNTS_URL,
  isWebLoopback,
} from '../config/spotify';

// ---------------------------------------------------------------------------
// Dev-only logger — stripped entirely in production builds
// ---------------------------------------------------------------------------

const isDev = import.meta.env.DEV;
function devLog(...args: unknown[]): void {
  if (isDev) console.log(...args); // eslint-disable-line no-console
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpotifyTokens {
  access_token:  string;
  refresh_token: string;
  expires_at:    number;
  token_type:    string;
}

// ---------------------------------------------------------------------------
// Module-level callback store  (avoids listener race condition)
// ---------------------------------------------------------------------------

type AuthCallback = (url: string) => void;
let _pendingCallback: AuthCallback | null = null;
let _urlHandler: AuthCallback | null = null;
let _listenerRegistered = false;

// Dedupes concurrent completions of the same callback URL (single-use code).
let _inflightUrl: string | null = null;
let _inflightCompletion: Promise<SpotifyTokens> | null = null;

/**
 * Call this ONCE at app startup (e.g. inside useSpotifyAuth) so the listener
 * is always live — never registered inside an async function after Browser.open.
 */
export function registerAppUrlListener(): void {
  if (_listenerRegistered) return;
  _listenerRegistered = true;

  App.addListener('appUrlOpen', (event: { url: string }) => {
    devLog('[SpotifyAuth] appUrlOpen fired');
    if (_pendingCallback) {
      const cb = _pendingCallback;
      _pendingCallback = null;
      cb(event.url);
      return;
    }
    // No live startAuthFlow() promise: the WebView was restarted while the
    // browser was open. Let the app recover from the persisted PKCE state.
    _urlHandler?.(event.url);
  });
}

/**
 * Handler for callback URLs that arrive outside a live startAuthFlow() call
 * (cold start after the OS killed the WebView). Pass null on unmount.
 */
export function setAuthUrlHandler(handler: AuthCallback | null): void {
  _urlHandler = handler;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier(): string {
  const array = new Uint8Array(96);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data   = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

const PREFS_KEY = 'spotify_tokens';

export async function loadStoredTokens(): Promise<SpotifyTokens | null> {
  const { value } = await Preferences.get({ key: PREFS_KEY });
  return value ? (JSON.parse(value) as SpotifyTokens) : null;
}

async function saveTokens(t: SpotifyTokens): Promise<void> {
  await Preferences.set({ key: PREFS_KEY, value: JSON.stringify(t) });
}

export async function clearTokens(): Promise<void> {
  await Preferences.remove({ key: PREFS_KEY });
  _inflightUrl = null;
  _inflightCompletion = null;
  clearPkce();
}

// ---------------------------------------------------------------------------
// PKCE state for the auth return trip
// ---------------------------------------------------------------------------

// localStorage, not sessionStorage: on low-RAM Android devices the OS can kill
// the WebView while the system browser/Custom Tab is in front. The callback
// then cold-starts the app and per-tab sessionStorage (and all module state)
// is gone. The verifier is short-lived and useless without the auth code.
const PKCE_STORAGE_KEY = 'spotify_pkce';
const PKCE_TTL_MS      = 30 * 60 * 1000;

interface StoredPkce {
  verifier:    string;
  state:       string;
  redirectUri: string;
  createdAt:   number;
}

function storePkce(verifier: string, state: string, redirectUri: string): void {
  try {
    const entry: StoredPkce = { verifier, state, redirectUri, createdAt: Date.now() };
    localStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(entry));
  } catch { /* private mode — flow will fail with a clear message on return */ }
}

/** Read without consuming, so a transient token-exchange failure can retry. */
function readPkce(): StoredPkce | null {
  try {
    const raw = localStorage.getItem(PKCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPkce>;
    if (
      typeof parsed.verifier !== 'string' ||
      typeof parsed.state !== 'string' ||
      typeof parsed.redirectUri !== 'string' ||
      typeof parsed.createdAt !== 'number'
    ) {
      localStorage.removeItem(PKCE_STORAGE_KEY);
      return null;
    }
    if (Date.now() - parsed.createdAt > PKCE_TTL_MS) {
      localStorage.removeItem(PKCE_STORAGE_KEY);
      return null;
    }
    return {
      verifier:    parsed.verifier,
      state:       parsed.state,
      redirectUri: parsed.redirectUri,
      createdAt:   parsed.createdAt,
    };
  } catch {
    return null;
  }
}

function clearPkce(): void {
  try { localStorage.removeItem(PKCE_STORAGE_KEY); } catch { /* ignore */ }
  _codeVerifier = '';
  _authState = '';
  _authRedirectUri = '';
}

/**
 * True when a callback URL belongs to the pending PKCE attempt (its state
 * matches). Used to ignore stale launch intents after a completed login.
 */
export function matchesPendingPkce(rawUrl: string): boolean {
  const stored = readPkce();
  if (!stored) return false;
  try {
    return new URL(rawUrl).searchParams.get('state') === stored.state;
  } catch {
    return false;
  }
}

/** True when a URL is our Spotify OAuth redirect (works for custom schemes). */
export function isAuthCallbackUrl(rawUrl: string): boolean {
  return rawUrl.startsWith(SPOTIFY_REDIRECT_URI);
}

// ---------------------------------------------------------------------------
// Auth flow
// ---------------------------------------------------------------------------

let _codeVerifier = '';
let _authState    = '';
let _authRedirectUri = '';

export async function startAuthFlow(): Promise<SpotifyTokens> {
  // New attempt: never reuse a completion cached for a previous callback URL.
  _inflightUrl = null;
  _inflightCompletion = null;

  _codeVerifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(_codeVerifier);
  _authState = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  const redirectUri = isWebLoopback()
    ? window.location.origin + SPOTIFY_WEB_REDIRECT_PATH
    : SPOTIFY_REDIRECT_URI;
  _authRedirectUri = redirectUri;

  const params = new URLSearchParams({
    client_id:             SPOTIFY_CLIENT_ID,
    response_type:         'code',
    redirect_uri:          redirectUri,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
    state:                 _authState,
    scope:                 SPOTIFY_SCOPES,
    show_dialog:           'false',
  });

  const authUrl = `${SPOTIFY_ACCOUNTS_URL}/authorize?${params}`;
  devLog('[SpotifyAuth] Starting auth flow');

  if (isWebLoopback()) {
    if (window.location.hostname === 'localhost') {
      // Spotify only whitelists the 127.0.0.1 loopback (not the localhost
      // name), and the PKCE state must live on the same origin that receives
      // the callback — so park the app on 127.0.0.1 first. The ?connect=1
      // hand-off lets useSpotifyAuth start the real authorization there.
      const resumeUrl = new URL(`http://127.0.0.1:${window.location.port}/`);
      resumeUrl.searchParams.set('connect', '1');
      window.location.replace(resumeUrl.toString());
      return new Promise<SpotifyTokens>(() => {});
    }
    // Full-page redirect: persist before unload so the return trip can finish
    // even if the browser discarded and reloaded the tab.
    storePkce(_codeVerifier, _authState, redirectUri);
    window.location.href = authUrl;
    // Never resolves — the page unloads.
    return new Promise<SpotifyTokens>(() => {});
  }

  // Native: persist before leaving the app. If the OS kills the WebView while
  // the Custom Tab is open, the appUrlOpen listener (or getLaunchUrl on cold
  // start) recovers with this entry instead of failing on lost module state.
  storePkce(_codeVerifier, _authState, redirectUri);

  return new Promise((resolve, reject) => {
    // Set the callback BEFORE opening the browser
    _pendingCallback = async (rawUrl: string) => {
      try {
        await Browser.close().catch(() => {});
        devLog('[SpotifyAuth] Callback received');
        resolve(await completeAuthFromUrl(rawUrl));
      } catch (err) {
        reject(err);
      }
    };

    Browser.open({ url: authUrl }).catch((err) => {
      _pendingCallback = null;
      clearPkce();
      reject(err);
    });
  });
}

/**
 * Complete an OAuth callback from the persisted PKCE state. Works after
 * process death: verifier, state and redirect URI come from localStorage,
 * not module memory. Concurrent calls for the same URL (appUrlOpen +
 * getLaunchUrl, StrictMode remounts) share one exchange — the auth code is
 * single-use, so running it twice would fail the second time.
 */
export function completeAuthFromUrl(rawUrl: string): Promise<SpotifyTokens> {
  if (_inflightUrl === rawUrl && _inflightCompletion) return _inflightCompletion;

  _inflightUrl = rawUrl;
  _inflightCompletion = runAuthCompletion(rawUrl).catch((err) => {
    if (_inflightUrl === rawUrl) {
      _inflightUrl = null;
      _inflightCompletion = null;
    }
    throw err;
  });
  return _inflightCompletion;
}

async function runAuthCompletion(rawUrl: string): Promise<SpotifyTokens> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid callback URL received');
  }

  const errorParam = url.searchParams.get('error');
  if (errorParam) {
    clearPkce();
    throw new Error(`Spotify denied access: ${errorParam}`);
  }

  const code = url.searchParams.get('code');
  if (!code) {
    clearPkce();
    throw new Error('No authorization code in callback URL');
  }

  // Fall back to module state if storage is blocked (private mode / storage
  // cleared). Without this, a healthy same-process login would fail purely
  // because localStorage was unavailable.
  const inMemory = (_codeVerifier && _authState && _authRedirectUri)
    ? {
        verifier:    _codeVerifier,
        state:       _authState,
        redirectUri: _authRedirectUri,
        createdAt:   Date.now(),
      }
    : null;

  const pending = readPkce() ?? inMemory;
  if (!pending) {
    throw new Error('Login session expired — please try again');
  }

  const returnedState = url.searchParams.get('state');
  if (returnedState !== pending.state) {
    clearPkce();
    throw new Error('State mismatch — possible CSRF');
  }

  devLog('[SpotifyAuth] Exchanging code for tokens…');
  const tokens = await exchangeCodeForTokens(code, pending.redirectUri, pending.verifier);
  await saveTokens(tokens);
  clearPkce();
  devLog('[SpotifyAuth] Auth complete');
  return tokens;
}

/**
 * Completes a loopback login after Spotify redirects back to
 * http://127.0.0.1:<port>/callback?code=…&state=…. Returns the saved tokens,
 * or null when this load is not a login return-trip. Throws on denial, CSRF
 * mismatch, or a lost PKCE session. Native builds always resolve null — they
 * complete via the appUrlOpen listener instead.
 */
export async function consumeLoopbackCallback(): Promise<SpotifyTokens | null> {
  if (!isWebLoopback()) return null;

  const rawUrl     = window.location.href;
  const url        = new URL(rawUrl);
  const code       = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');
  if (!code && !errorParam) return null;

  // Clean the address bar first so reloads don't reprocess the callback.
  window.history.replaceState({}, '', '/');

  devLog('[SpotifyAuth] Exchanging loopback code for tokens…');
  return completeAuthFromUrl(rawUrl);
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  verifier: string = _codeVerifier,
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUri,
    client_id:     SPOTIFY_CLIENT_ID,
    code_verifier: verifier,
  });

  const res = await fetch(`${SPOTIFY_ACCOUNTS_URL}/api/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) throw new Error('Authentication failed. Please try again.');
  return normaliseTokenResponse(await res.json());
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     SPOTIFY_CLIENT_ID,
  });

  const res = await fetch(`${SPOTIFY_ACCOUNTS_URL}/api/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) throw new Error('Session expired — please log in again.');
  const data = await res.json();
  if (!data.refresh_token) data.refresh_token = refreshToken;
  const tokens = normaliseTokenResponse(data);
  await saveTokens(tokens);
  return tokens;
}

export async function getValidAccessToken(): Promise<string> {
  const tokens = await loadStoredTokens();
  if (!tokens) throw new Error('Not authenticated');
  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  return (await refreshAccessToken(tokens.refresh_token)).access_token;
}

function normaliseTokenResponse(data: Record<string, unknown>): SpotifyTokens {
  return {
    access_token:  data.access_token  as string,
    refresh_token: data.refresh_token as string,
    expires_at:    Date.now() + ((data.expires_in as number) ?? 3600) * 1000,
    token_type:    (data.token_type as string) ?? 'Bearer',
  };
}
