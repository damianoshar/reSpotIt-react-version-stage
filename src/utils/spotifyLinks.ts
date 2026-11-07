import { Album } from '../types';

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

/** Best link for an album: server-provided spotify_url, else built from the id. */
export function spotifyAlbumUrl(album: Album): string {
  if (album.spotify_url) return album.spotify_url;
  return SPOTIFY_ID.test(album.id) ? 'https://open.spotify.com/album/' + album.id : '';
}

/** Playlist cards link out to open.spotify.com; ids that are not Spotify ids get no link. */
export function spotifyPlaylistUrl(id: string): string {
  return SPOTIFY_ID.test(id) ? 'https://open.spotify.com/playlist/' + id : '';
}
