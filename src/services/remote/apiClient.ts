import { Preferences } from '@capacitor/preferences';
import { normalizeServerUrl } from '../../config/server';

// ---------------------------------------------------------------------------
// Remote API client — speaks the canonical /api/v1 contract
// (API-PARITY-PLAN.md §1) to any conformant backend (Elixir/Phoenix,
// .NET, FastAPI).
//
// Session: access + refresh JWTs in Preferences. apiFetch attaches the
// access token and, on a single 401, refreshes once and retries — mirroring
// the local getValidAccessToken() behavior.
// ---------------------------------------------------------------------------

const ACCESS_PREFS_KEY  = 'server_access_jwt';
const REFRESH_PREFS_KEY = 'server_refresh_jwt';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function getAccessJwt(): Promise<string | null> {
  const { value } = await Preferences.get({ key: ACCESS_PREFS_KEY });
  return value;
}

async function getRefreshJwt(): Promise<string | null> {
  const { value } = await Preferences.get({ key: REFRESH_PREFS_KEY });
  return value;
}

export async function setSession(access: string, refresh: string): Promise<void> {
  await Preferences.set({ key: ACCESS_PREFS_KEY, value: access });
  await Preferences.set({ key: REFRESH_PREFS_KEY, value: refresh });
}

export async function clearSession(): Promise<void> {
  await Preferences.remove({ key: ACCESS_PREFS_KEY });
  await Preferences.remove({ key: REFRESH_PREFS_KEY });
}

/** Back-compat for callers written before the refresh flow existed. */
export async function getJwt(): Promise<string | null> {
  return getAccessJwt();
}
export async function setJwt(token: string): Promise<void> {
  await Preferences.set({ key: ACCESS_PREFS_KEY, value: token });
}
export async function clearJwt(): Promise<void> {
  await clearSession();
}

interface FetchOpts {
  method?: string;
  body?: unknown;
  /** Attach the stored access JWT (default true; false for login/refresh/health). */
  auth?: boolean;
  /** Extra request headers (e.g. Accept for CSV downloads). */
  headers?: Record<string, string>;
}

async function rawFetch(base: string, path: string, token: string | null, opts: FetchOpts): Promise<Response> {
  return fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: {
      // Only send a JSON content type when there is a JSON body. A bare
      // Content-Type on GETs triggers an extra CORS preflight for no reason.
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function throwForStatus(res: Response): Promise<never> {
  let code: string | undefined;
  let message = 'Server error ' + res.status;
  try {
    const data = await res.json();
    // Canonical nested envelope {error:{code,message}} + legacy flat shape.
    code = data?.error?.code ?? (typeof data?.error === 'string' ? data.error : undefined);
    message = data?.error?.message ?? data?.message ?? message;
  } catch {
    try { message = await res.text(); } catch { /* keep default */ }
  }
  throw new ApiError(res.status, code, message);
}

async function authorizedFetch(
  serverUrl: string,
  path: string,
  opts: FetchOpts = {},
): Promise<Response> {
  const base = normalizeServerUrl(serverUrl);
  const useAuth = opts.auth ?? true;
  const token = useAuth ? await getAccessJwt() : null;

  let res = await rawFetch(base, path, token, opts);

  // Single transparent refresh-and-retry on 401 (never for the refresh call itself).
  if (res.status === 401 && useAuth && path !== '/api/v1/auth/refresh') {
    const refresh = await getRefreshJwt();
    if (refresh) {
      try {
        const rr = await rawFetch(base, '/api/v1/auth/refresh', null,
          { method: 'POST', body: { refresh_token: refresh }, auth: false });
        if (rr.ok) {
          const data = await rr.json();
          if (data?.access_token) {
            await Preferences.set({ key: ACCESS_PREFS_KEY, value: data.access_token as string });
            res = await rawFetch(base, path, data.access_token as string, opts);
          }
        }
      } catch { /* fall through to the 401 below */ }
    }
    if (res.status === 401) {
      await clearSession();
      throw new ApiError(401, 'unauthorized', 'Server session expired — log in again');
    }
  }

  // A 401 on an unauthenticated endpoint (login / register / refresh) is the
  // server's own verdict — fall through to throwForStatus so its envelope
  // surfaces (invalid_credentials → "Email or password is incorrect.")
  // instead of being mislabelled as an expired session.
  if (!res.ok) await throwForStatus(res);
  return res;
}

export async function apiFetch<T>(serverUrl: string, path: string, opts: FetchOpts = {}): Promise<T> {
  const res = await authorizedFetch(serverUrl, path, opts);

  // 204/empty bodies (e.g. DELETE) have no JSON payload.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface RemoteDownload {
  blob: Blob;
  filename: string | null;
}

/**
 * Authenticated binary download (CSV export, etc.). Uses the same
 * single-refresh-and-retry path as apiFetch, so an expired server JWT is
 * renewed instead of surfacing a bare 401 from the download fetch.
 */
export async function apiFetchBlob(
  serverUrl: string,
  path: string,
  opts: FetchOpts = {},
): Promise<RemoteDownload> {
  const res = await authorizedFetch(serverUrl, path, {
    ...opts,
    headers: {
      Accept: 'text/csv, application/octet-stream;q=0.9, */*;q=0.8',
      ...(opts.headers ?? {}),
    },
  });
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(disposition);
  let filename: string | null = match?.[1] ?? null;
  if (filename) {
    try { filename = decodeURIComponent(filename); } catch { /* keep raw value */ }
  }
  return { blob, filename };
}

/**
 * Public health probe used by the Test-connection button (no auth needed).
 *
 * Tries the contract path (`/api/v1/health`) first, then the bare `/health`
 * some deployments expose: the .NET backend only serves the contract path, so
 * probing `/health` alone made Test connection fail against it.
 */
export async function checkServerHealth(serverUrl: string): Promise<void> {
  const base = normalizeServerUrl(serverUrl);
  let lastError: unknown;
  for (const path of ['/api/v1/health', '/health']) {
    try {
      const res = await fetch(base + path);
      if (res.ok) return;
      lastError = new Error(`Server replied ${res.status} on ${path}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `Cannot reach ${base} — is the server running?` +
    (lastError instanceof Error && lastError.message ? ` (${lastError.message})` : ''),
  );
}
