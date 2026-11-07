import { describe, expect, it } from 'vitest';
import { findDuplicates, normalizeTitle, primaryArtist, type DuplicateAlbum } from './duplicateFinder';

const album = (id: string, title: string, artist: string, year: number): DuplicateAlbum => ({
  id, title, artist, year,
});

describe('DuplicateFinder', () => {
  it('groups deluxe edition with the base album', () => {
    const groups = findDuplicates([
      album('base', 'Random Access Memories', 'Daft Punk', 2013),
      album('deluxe', 'Random Access Memories (Deluxe Edition)', 'Daft Punk', 2013),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].albums.map((x) => x.id)).toEqual(['base', 'deluxe']);
  });

  it('groups remaster suffixes', () => {
    const groups = findDuplicates([
      album('a', 'The Night Is Young', 'The Band', 1985),
      album('b', 'The Night Is Young - 2011 Remaster', 'The Band', 2011),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].albums).toHaveLength(2);
  });

  it('groups regional bracket tag copies', () => {
    const groups = findDuplicates([
      album('a', 'Easter Everywhere', '13th Floor Elevators', 1967),
      album('b', 'Easter Everywhere (UK)', '13th Floor Elevators', 1967),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('does not merge live versions with studio albums', () => {
    const groups = findDuplicates([
      album('studio', 'The End Is Begun', '3', 2007),
      album('live', 'The End Is Begun (Live)', '3', 2008),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('does not group different artists', () => {
    const groups = findDuplicates([
      album('a', 'Greatest Hits', 'Queen', 1981),
      album('b', 'Greatest Hits', 'ABBA', 1992),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('normalises accents and primary artist', () => {
    expect(normalizeTitle('Café Tacvba')).toBe('cafe tacvba');
    expect(primaryArtist('Artist feat. Guest')).toBe('artist');
  });

  it('does not group distinct titles', () => {
    const groups = findDuplicates([
      album('a', 'Album One', 'Artist', 2000),
      album('b', 'Album Two', 'Artist', 2001),
    ]);
    expect(groups).toHaveLength(0);
  });
});
