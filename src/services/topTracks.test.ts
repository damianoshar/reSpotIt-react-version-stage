import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getToken, spotifyFetchMock, sleep } = vi.hoisted(() => ({
  getToken: vi.fn(),
  spotifyFetchMock: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock('./SpotifyAuthService', () => ({
  getValidAccessToken: getToken,
}));

vi.mock('../utils/spotifyFetch', () => ({
  spotifyFetch: spotifyFetchMock,
  sleep,
}));

vi.mock('../config/spotify', () => ({
  SPOTIFY_API_URL: 'https://api.spotify.com/v1',
}));

import { getAlbumTopTracks } from './topTracks';

const ALBUM = {
  name: 'OK Computer',
  images: [{ url: 'https://i.scdn.co/image/cover' }],
  release_date: '1997-05-21',
  artists: [{ name: 'Radiohead' }],
};

const albumTracks = (items: unknown[]) => ({ items, next: null });

describe('getAlbumTopTracks', () => {
  beforeEach(() => {
    getToken.mockReset().mockResolvedValue('test-token');
    spotifyFetchMock.mockReset();
    sleep.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('picks the most popular track of an album', async () => {
    spotifyFetchMock
      .mockResolvedValueOnce(ALBUM)
      .mockResolvedValueOnce(albumTracks([
        { id: 't1', name: 'Airbag', uri: 'spotify:track:t1', track_number: 1, duration_ms: 284000 },
        { id: 't2', name: 'Let Down', uri: 'spotify:track:t2', track_number: 5, duration_ms: 299560 },
      ]))
      .mockResolvedValueOnce({ tracks: [{ id: 't1', popularity: 70 }, { id: 't2', popularity: 89 }] });

    const tracks = await getAlbumTopTracks(['a1']);

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      spotify_id:      't2',
      uri:             'spotify:track:t2',
      name:            'Let Down',
      album_id:        'a1',
      album_name:      'OK Computer',
      album_image_url: 'https://i.scdn.co/image/cover',
      popularity:      89,
      release_year:    1997,
    });
  });

  it('asks for the popularity of the album tracks', async () => {
    spotifyFetchMock
      .mockResolvedValueOnce(ALBUM)
      .mockResolvedValueOnce(albumTracks([{ id: 't1', name: 'Airbag', uri: 'spotify:track:t1' }]))
      .mockResolvedValueOnce({ tracks: [{ id: 't1', popularity: 42 }] });

    await getAlbumTopTracks(['a1']);

    expect(spotifyFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tracks?ids=t1'),
      'test-token',
    );
  });

  it('breaks a popularity tie with the lowest track number', async () => {
    spotifyFetchMock
      .mockResolvedValueOnce(ALBUM)
      .mockResolvedValueOnce(albumTracks([
        { id: 't9', name: 'Later', uri: 'spotify:track:t9', track_number: 9 },
        { id: 't2', name: 'Earlier', uri: 'spotify:track:t2', track_number: 2 },
      ]))
      .mockResolvedValueOnce({ tracks: [{ id: 't9', popularity: 55 }, { id: 't2', popularity: 55 }] });

    const tracks = await getAlbumTopTracks(['a1']);

    expect(tracks[0].spotify_id).toBe('t2');
  });

  it('skips an album that cannot be read and keeps the other one', async () => {
    spotifyFetchMock
      .mockRejectedValueOnce(new Error('Spotify request failed (404). Please try again.'))
      .mockResolvedValueOnce(ALBUM)
      .mockResolvedValueOnce(albumTracks([{ id: 't1', name: 'Airbag', uri: 'spotify:track:t1' }]))
      .mockResolvedValueOnce({ tracks: [{ id: 't1', popularity: 42 }] });

    const tracks = await getAlbumTopTracks(['bad', 'good']);

    expect(tracks).toHaveLength(1);
    expect(tracks[0].album_id).toBe('good');
  });

  it('ignores an empty album id', async () => {
    const tracks = await getAlbumTopTracks(['', '  ']);

    expect(tracks).toEqual([]);
    expect(spotifyFetchMock).not.toHaveBeenCalled();
  });
});
