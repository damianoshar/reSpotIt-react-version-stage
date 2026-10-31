import type { LocalPlaybackTrack } from '../services/librespotPlayer';
import type { PlaylistPlaybackTrack } from '../services/SpotifyPlaylistService';

/**
 * Find the first playlist occurrence of an album. The playlist is the local
 * queue when playback is started from the playlist album grid.
 */
export function findPlaylistIndexForAlbum(
  tracks: PlaylistPlaybackTrack[],
  albumId: string,
): number {
  return tracks.findIndex((track) => track.albumId === albumId);
}

/** Find the first playlist occurrence of a track URI. */
export function findPlaylistIndexForTrack(
  tracks: PlaylistPlaybackTrack[],
  uri: string,
): number {
  if (!uri) return -1;
  return tracks.findIndex((track) => track.uri === uri);
}

/** Real playlist position for a track, or null when it is not in the playlist. */
export function playlistPositionForTrack(
  tracks: PlaylistPlaybackTrack[],
  uri: string,
): number | null {
  const index = findPlaylistIndexForTrack(tracks, uri);
  return index >= 0 ? tracks[index].playlistPosition : null;
}

/** Convert playlist-ordered tracks into the native player's queue shape. */
export function toLocalPlaylistTracks(
  tracks: PlaylistPlaybackTrack[],
): LocalPlaybackTrack[] {
  return tracks.map((track) => ({
    uri:        track.uri,
    title:      track.title,
    artist:     track.artist,
    durationMs: track.durationMs,
    artUrl:     track.artUrl,
  }));
}
