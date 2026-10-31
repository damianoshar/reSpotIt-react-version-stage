import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getToken, sleep } = vi.hoisted(() => ({
  getToken: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock('./SpotifyAuthService', () => ({
  getValidAccessToken: getToken,
}));

vi.mock('../utils/spotifyFetch', () => ({
  spotifyFetch: vi.fn(),
  sleep,
}));

vi.mock('../config/spotify', () => ({
  SPOTIFY_API_URL: 'https://api.spotify.com/v1',
}));

import { removeSavedAlbums, saveAlbums } from './SpotifyApiService';

describe('Spotify library album writes', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    getToken.mockReset().mockResolvedValue('test-token');
    sleep.mockReset().mockResolvedValue(undefined);
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves albums with PUT in chunks of 50', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `album-${index}`);

    await saveAlbums(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.spotify.com/v1/me/albums?ids=' + encodeURIComponent(ids.slice(0, 50).join(',')),
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.spotify.com/v1/me/albums?ids=' + encodeURIComponent(ids[50]),
    );
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not call Spotify for an empty selection', async () => {
    await saveAlbums([]);

    expect(getToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains how to grant library permission on HTTP 403', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    await expect(saveAlbums(['album-1'])).rejects.toThrow(
      'Log out and reconnect Spotify',
    );
  });

  it('keeps removeSavedAlbums on DELETE', async () => {
    await removeSavedAlbums(['album-1']);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.spotify.com/v1/me/albums?ids=album-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
