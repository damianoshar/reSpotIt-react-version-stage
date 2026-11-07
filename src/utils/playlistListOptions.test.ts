import { describe, expect, it } from 'vitest';
import {
  filterPlaylists,
  sortPlaylists,
  applyPlaylists,
  type PlaylistSortField,
  type PlaylistSortOrder,
} from './playlistListOptions';

type TestPlaylist = { name: string; tracks: { total: number }; addedOrder?: number | null };

const playlist = (name: string, tracks: number, addedOrder?: number | null): TestPlaylist => ({
  name,
  tracks: { total: tracks },
  addedOrder,
});

const playlists: TestPlaylist[] = [
  playlist('Roadside', 67),
  playlist('all library up to 1974', 8123),
  playlist('pavement', 12),
];

describe('playlistListOptions', () => {
  it('empty query keeps everything', () => {
    expect(filterPlaylists(playlists, '')).toEqual(playlists);
    expect(filterPlaylists(playlists, '    ')).toEqual(playlists);
  });

  it('case-insensitive search', () => {
    expect(filterPlaylists(playlists, 'PAVEMENT').map((x) => x.name)).toEqual(['pavement']);
  });

  it('name sort is case-insensitive', () => {
    expect(sortPlaylists([...playlists] as any, 'name', 'asc').map((x: TestPlaylist) => x.name)).toEqual([
      'all library up to 1974', 'pavement', 'Roadside',
    ]);
  });

  it('tracks descending', () => {
    expect(sortPlaylists([...playlists] as any, 'tracks', 'desc').map((x: TestPlaylist) => x.name)).toEqual([
      'all library up to 1974', 'Roadside', 'pavement',
    ]);
  });

  it('tracks ascending', () => {
    expect(sortPlaylists([...playlists] as any, 'tracks', 'asc').map((x: TestPlaylist) => x.name)).toEqual([
      'pavement', 'Roadside', 'all library up to 1974',
    ]);
  });

  it('name descending reverses', () => {
    expect(sortPlaylists([...playlists] as any, 'name', 'desc').map((x: TestPlaylist) => x.name)).toEqual([
      'Roadside', 'pavement', 'all library up to 1974',
    ]);
  });

  const dated = [
    playlist('old', 1, 2),
    playlist('new', 1, 0),
    playlist('middle', 1, 1),
  ];

  it('date added descending = newest first', () => {
    expect(sortPlaylists([...dated] as any, 'added', 'desc').map((x: TestPlaylist) => x.name)).toEqual(['new', 'middle', 'old']);
  });

  it('date added ascending = oldest first', () => {
    expect(sortPlaylists([...dated] as any, 'added', 'asc').map((x: TestPlaylist) => x.name)).toEqual(['old', 'middle', 'new']);
  });

  it('null addedOrder goes last both directions', () => {
    const mixed = [playlist('no-order-a', 1, null), playlist('dated', 1, 0), playlist('no-order-b', 1, null)];
    expect(sortPlaylists([...mixed] as any, 'added', 'asc').map((x: TestPlaylist) => x.name)).toEqual(['dated', 'no-order-a', 'no-order-b']);
    expect(sortPlaylists([...mixed] as any, 'added', 'desc').map((x: TestPlaylist) => x.name)).toEqual(['dated', 'no-order-a', 'no-order-b']);
  });

  it('apply filters and sorts in one go', () => {
    expect(applyPlaylists([...playlists] as any, 'a', 'name').map((x: TestPlaylist) => x.name)).toEqual([
      'all library up to 1974', 'pavement', 'Roadside',
    ]);
  });
});
