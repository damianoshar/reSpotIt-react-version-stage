import { describe, expect, it } from 'vitest';
import type { PlaylistPlaybackTrack } from '../services/SpotifyPlaylistService';
import {
  findPlaylistIndexForAlbum,
  findPlaylistIndexForTrack,
  playlistPositionForTrack,
  toLocalPlaylistTracks,
} from './playlistPlayback';

const track = (
  uri: string,
  albumId: string,
  playlistPosition: number,
): PlaylistPlaybackTrack => ({
  uri,
  title: `Title ${playlistPosition}`,
  artist: 'Artist',
  durationMs: 1000 + playlistPosition,
  artUrl: null,
  albumId,
  playlistPosition,
});

const playlist: PlaylistPlaybackTrack[] = [
  track('spotify:track:a1', 'album-a', 0),
  track('spotify:track:b1', 'album-b', 1),
  track('spotify:track:b2', 'album-b', 2),
  track('spotify:track:c1', 'album-c', 3),
  track('spotify:track:a2', 'album-a', 4),
];

describe('playlistPlayback', () => {
  it('finds the first playlist occurrence of an album', () => {
    expect(findPlaylistIndexForAlbum(playlist, 'album-b')).toBe(1);
    expect(findPlaylistIndexForAlbum(playlist, 'album-a')).toBe(0);
    expect(findPlaylistIndexForAlbum(playlist, 'missing')).toBe(-1);
  });

  it('finds a track in playlist order', () => {
    expect(findPlaylistIndexForTrack(playlist, 'spotify:track:c1')).toBe(3);
    expect(findPlaylistIndexForTrack(playlist, 'spotify:track:missing')).toBe(-1);
    expect(findPlaylistIndexForTrack(playlist, '')).toBe(-1);
  });

  it('reports the real playlist position, including gaps from unavailable tracks', () => {
    expect(playlistPositionForTrack(playlist, 'spotify:track:b2')).toBe(2);
    expect(playlistPositionForTrack(playlist, 'spotify:track:missing')).toBeNull();
  });

  it('converts to the native queue without changing order', () => {
    const local = toLocalPlaylistTracks(playlist);
    expect(local.map((item) => item.uri)).toEqual(playlist.map((item) => item.uri));
    expect(local[2]).toEqual({
      uri:        'spotify:track:b2',
      title:      'Title 2',
      artist:     'Artist',
      durationMs: 1002,
      artUrl:     null,
    });
  });
});
