/**
 * Thin wrapper around fetch for the Spotify Web API.
 * Handles 429 rate-limiting with Retry-After backoff (max 3 retries).
 * Single Responsibility: HTTP transport only — no auth, no business logic.
 */

const MAX_RETRIES = 3;

export async function spotifyFetch<T>(
  url: string,
  token: string,
  _attempt = 0,
): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) {
    if (_attempt >= MAX_RETRIES) {
      throw new Error('Spotify rate limit exceeded — please wait a moment and try again.');
    }
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '2', 10);
    await sleep(retryAfter * 1000);
    return spotifyFetch<T>(url, token, _attempt + 1);
  }

  if (!res.ok) {
    // Do not forward raw API response body to the user — it may contain
    // internal Spotify error details. Log in dev only; show a clean message.
    if (import.meta.env.DEV) {
      console.warn(`[spotifyFetch] ${res.status} ${url}`, await res.clone().text()); // eslint-disable-line no-console
    }
    throw new Error(`Spotify request failed (${res.status}). Please try again.`);
  }

  return res.json() as Promise<T>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
