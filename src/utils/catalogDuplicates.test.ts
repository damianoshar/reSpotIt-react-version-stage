import { describe, expect, it } from 'vitest';
import { findCatalogDuplicates } from './catalogDuplicates';
import type { CatalogAlbumLike } from './catalog';

const album = (
  id: string,
  title: string,
  artist: string,
  year: number,
  albumGroup = 'album',
): CatalogAlbumLike => ({
  id,
  title,
  artist,
  year,
  genre: '',
  image_url: '',
  image_path: '',
  album_group: albumGroup,
  album_type: albumGroup === 'appears_on' ? 'album' : albumGroup,
});

describe('findCatalogDuplicates', () => {
  it('groups deluxe editions in the same release bucket', () => {
    const groups = findCatalogDuplicates([
      album('base', 'Random Access Memories', 'Daft Punk', 2013),
      album('deluxe', 'Random Access Memories (Deluxe Edition)', 'Daft Punk', 2013),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].albums.map((x) => x.id)).toEqual(['base', 'deluxe']);
  });

  it('keeps a single and an album with the same name separate', () => {
    const groups = findCatalogDuplicates([
      album('album', 'Future Nostalgia', 'Dua Lipa', 2020, 'album'),
      album('single', 'Future Nostalgia', 'Dua Lipa', 2019, 'single'),
    ]);

    expect(groups).toHaveLength(0);
  });

  it('keeps an appearance and an album with the same name separate', () => {
    const groups = findCatalogDuplicates([
      album('own', 'Everything Is Fine', 'Artist', 2022, 'album'),
      album('guest', 'Everything Is Fine', 'Artist', 2022, 'appears_on'),
    ]);

    expect(groups).toHaveLength(0);
  });

  it('groups regional and remaster copies within the same bucket', () => {
    const groups = findCatalogDuplicates([
      album('a', 'Easter Everywhere', '13th Floor Elevators', 1967),
      album('b', 'Easter Everywhere (UK)', '13th Floor Elevators', 1967),
      album('c', 'Easter Everywhere - 2011 Remaster', '13th Floor Elevators', 2011),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].albums.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not group distinct titles or artists', () => {
    const groups = findCatalogDuplicates([
      album('a', 'Album One', 'Artist', 2000),
      album('b', 'Album Two', 'Artist', 2001),
      album('c', 'Album One', 'Other Artist', 2000),
    ]);

    expect(groups).toHaveLength(0);
  });
});
