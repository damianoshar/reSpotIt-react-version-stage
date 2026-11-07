import { normalizeTitle, primaryArtist } from './duplicateFinder';
import { catalogGroupOf, type CatalogAlbumLike } from './catalog';

export interface CatalogDuplicateGroup<T extends CatalogAlbumLike = CatalogAlbumLike> {
  key: string;
  title: string;
  artist: string;
  albums: T[];
}

/**
 * Catalog-specific duplicate detection.
 *
 * The library duplicate finder groups by normalized title + primary artist.
 * For a discography that is too aggressive: an artist can legitimately have a
 * single and an album with the same name, or appear on someone else's album
 * with the same title. Include the release bucket in the key so those stay
 * separate, while deluxe/remaster/regional copies still collapse together.
 */
export function findCatalogDuplicates<T extends CatalogAlbumLike>(
  albums: T[],
): CatalogDuplicateGroup<T>[] {
  const buckets = new Map<string, T[]>();

  for (const album of albums) {
    const title = normalizeTitle(album.title);
    const artist = primaryArtist(album.artist);
    if (!title || !artist) continue;
    const key = `${title}|${artist}|${catalogGroupOf(album)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(album);
  }

  const groups: CatalogDuplicateGroup<T>[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;

    // Keep the oldest copy first. The review UI includes the first item by
    // default and lets the user opt into a newer deluxe/remaster edition.
    const sorted = [...list].sort((a, b) => {
      const ay = a.year > 0 ? a.year : Number.MAX_SAFE_INTEGER;
      const by = b.year > 0 ? b.year : Number.MAX_SAFE_INTEGER;
      if (ay !== by) return ay - by;
      if (a.title.toLowerCase() !== b.title.toLowerCase()) {
        return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
      }
      return a.id.localeCompare(b.id);
    });

    groups.push({
      key,
      title: sorted[0].title,
      artist: sorted[0].artist,
      albums: sorted,
    });
  }

  groups.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  return groups;
}
