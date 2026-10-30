// Playlist list helpers ported from Kotlin utils/PlaylistListOptions.kt.
// All work is client-side: the playlist list is small and the server does not
// sort it by name.

export type PlaylistSortField = 'name' | 'tracks' | 'added';
export type PlaylistSortOrder = 'asc' | 'desc';

export function filterPlaylists<T extends { name: string }>(playlists: T[], query: string): T[] {
  const needle = query.trim();
  if (!needle) return playlists;
  const lower = needle.toLowerCase();
  return playlists.filter((p) => p.name.toLowerCase().includes(lower));
}

export function sortPlaylists<T extends { name: string; tracks: { total: number }; addedOrder?: number | null }>(
  playlists: T[],
  sortField: PlaylistSortField,
  sortOrder: PlaylistSortOrder = 'asc',
): T[] {
  const desc = sortOrder === 'desc';
  const copy = [...playlists];
  switch (sortField) {
    case 'tracks': {
      copy.sort((a, b) => {
        const cmp = a.tracks.total - b.tracks.total;
        if (cmp !== 0) return desc ? -cmp : cmp;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      break;
    }
    case 'added': {
      // addedOrder is Spotify's /me/playlists position, 0-based, where 0 is the
      // most recently added playlist. desc => newest first; asc => oldest first.
      // Nulls always move to the end so rows without a known order stay out of
      // the way in both directions.
      copy.sort((a, b) => {
        const aNull = a.addedOrder == null;
        const bNull = b.addedOrder == null;
        if (aNull !== bNull) return aNull ? 1 : -1;
        if (!aNull && !bNull) {
          const av = a.addedOrder as number;
          const bv = b.addedOrder as number;
          if (av !== bv) return desc ? av - bv : bv - av;
        }
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      break;
    }
    default: {
      copy.sort((a, b) => {
        const cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        return desc ? -cmp : cmp;
      });
      break;
    }
  }
  return copy;
}

export function applyPlaylists<T extends { name: string; tracks: { total: number }; addedOrder?: number | null }>(
  playlists: T[],
  query: string,
  sortField: PlaylistSortField,
  sortOrder: PlaylistSortOrder = 'asc',
): T[] {
  return sortPlaylists(filterPlaylists(playlists, query), sortField, sortOrder);
}
