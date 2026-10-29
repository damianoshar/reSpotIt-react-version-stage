import type { Album } from '../types';

/** The three release buckets the discography picker exposes. */
export type CatalogGroup = 'album' | 'single' | 'appears_on';

export interface CatalogAlbumLike extends Album {
  /** Spotify's artist-albums response uses this to distinguish a release
   *  from an appearance on someone else's album. */
  album_group?: string;
  total_tracks?: number;
}

export function catalogGroupOf(
  album: Pick<CatalogAlbumLike, 'album_group' | 'album_type'>,
): CatalogGroup {
  const group = (album.album_group ?? '').toLowerCase();
  if (group === 'appears_on') return 'appears_on';
  if (group === 'single') return 'single';

  const type = (album.album_type ?? '').toLowerCase();
  return type === 'single' ? 'single' : 'album';
}

export function catalogGroupLabel(group: CatalogGroup): string {
  if (group === 'single') return 'Singles';
  if (group === 'appears_on') return 'Appears On';
  return 'Albums';
}

/** Badge text for a single release row. */
export function catalogReleaseLabel(album: Pick<CatalogAlbumLike, 'album_group' | 'album_type'>): string {
  const group = catalogGroupOf(album);
  if (group === 'single') return 'Single';
  if (group === 'appears_on') return 'Appears On';
  const type = (album.album_type ?? '').toLowerCase();
  if (type === 'compilation') return 'Compilation';
  return 'Album';
}
