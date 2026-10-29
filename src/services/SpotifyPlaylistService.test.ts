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

import { getPlaylistPlaybackTracks } from './SpotifyPlaylistService';

const rawTrack = (
  uri: string,
  name: string,
  albumId: string,
  position: number,
) => ({
  uri,
  name,
  duration_ms: 1000 + position,
  artists: [{ name: `Artist ${position}` }],
  album: {
    id: albumId,
    images: [
      { url: `small-${position}`, width: 64 },
      { url: `large-${position}`, width: 640 },
    ],
  },
});

describe('getPlaylistPlaybackTracks', () => {
  beforeEach(() => {
    getToken.mockReset().mockResolvedValue('test-token');
    spotifyFetchMock.mockReset();
    sleep.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps playlist order and real positions when items are unavailable', async () => {
    spotifyFetchMock.mockResolvedValueOnce({
      items: [
        { track: rawTrack('spotify:track:a', 'A', 'album-a', 0) },
        { track: null },
        { track: rawTrack('spotify:track:b', 'B', 'album-b', 2) },
      ],
      next: null,
    });

    const tracks = await getPlaylistPlaybackTracks('playlist-1');

    expect(spotifyFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/playlists/playlist-1/tracks?limit=100&fields='),
      'test-token',
    );
    expect(tracks).toEqual([
      {
        uri:              'spotify:track:a',
        title:            'A',
        artist:           'Artist 0',
        durationMs:       1000,
        artUrl:           'large-0',
        albumId:          'album-a',
        playlistPosition: 0,
      },
      {
        uri:              'spotify:track:b',
        title:            'B',
        artist:           'Artist 2',
        durationMs:       1002,
        artUrl:           'large-2',
        albumId:          'album-b',
        playlistPosition: 2,
      },
    ]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('follows pagination and keeps positions across pages', async () => {
    spotifyFetchMock
      .mockResolvedValueOnce({
        items: [{ track: rawTrack('spotify:track:a', 'A', 'album-a', 0) }],
        next: 'https://api.spotify.com/v1/playlists/playlist-1/tracks?offset=1',
      })
      .mockResolvedValueOnce({
        items: [
          { track: null },
          { track: rawTrack('spotify:track:c', 'C', 'album-c', 2) },
        ],
        next: null,
      });

    const tracks = await getPlaylistPlaybackTracks('playlist-1');

    expect(spotifyFetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(tracks.map((item) => item.playlistPosition)).toEqual([0, 2]);
    expect(tracks.map((item) => item.uri)).toEqual([
      'spotify:track:a',
      'spotify:track:c',
    ]);
  });
});
