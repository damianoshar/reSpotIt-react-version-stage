import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      store.delete(key);
    }),
  },
}));

import { apiFetch, apiFetchBlob, setSession } from './apiClient';

type FetchCall = { url: string; init?: RequestInit };

function authHeader(init?: RequestInit): string | null {
  return new Headers(init?.headers).get('Authorization');
}

describe('remote api client', () => {
  beforeEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it('refreshes once and retries an authenticated JSON request', async () => {
    await setSession('expired', 'refresh-token');
    const calls: FetchCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/api/v1/albums/stats')) {
        return authHeader(init) === 'Bearer fresh'
          ? new Response(JSON.stringify({ data: { total: 3 } }), { status: 200 })
          : new Response('unauthorized', { status: 401 });
      }
      if (url.endsWith('/api/v1/auth/refresh')) {
        return new Response(JSON.stringify({ access_token: 'fresh' }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }));

    await expect(apiFetch('http://media.local:8000/', '/api/v1/albums/stats'))
      .resolves.toEqual({ data: { total: 3 } });

    expect(calls).toHaveLength(3);
    expect(authHeader(calls[2].init)).toBe('Bearer fresh');
    expect(store.get('server_access_jwt')).toBe('fresh');
  });

  it('downloads a CSV through the same refresh path', async () => {
    await setSession('expired', 'refresh-token');
    const calls: FetchCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/api/v1/albums/export')) {
        return authHeader(init) === 'Bearer fresh'
          ? new Response('id,title\n1,Alpha', {
              status: 200,
              headers: {
                'content-type': 'text/csv',
                'content-disposition': 'attachment; filename="spotify-library.csv"',
              },
            })
          : new Response('unauthorized', { status: 401 });
      }
      if (url.endsWith('/api/v1/auth/refresh')) {
        return new Response(JSON.stringify({ access_token: 'fresh' }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }));

    const download = await apiFetchBlob('http://media.local:8000', '/api/v1/albums/export');

    expect(await download.blob.text()).toBe('id,title\n1,Alpha');
    expect(download.filename).toBe('spotify-library.csv');
    expect(calls).toHaveLength(3);
    expect(authHeader(calls[2].init)).toBe('Bearer fresh');
  });

  it('does not refresh or clear the session for an unauthenticated login 401', async () => {
    await setSession('expired', 'refresh-token');
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'invalid_credentials', message: 'Bad email or password' } }),
      { status: 401 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('http://media.local:8000', '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'a@b.test', password: 'nope' },
      auth: false,
    })).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials',
      message: 'Bad email or password',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.get('server_access_jwt')).toBe('expired');
  });
});
