import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiClient', () => ({
  apiFetch: vi.fn(),
  apiFetchBlob: vi.fn(),
}));

import { apiFetch } from './apiClient';
import { listRemotePlaylists, queryRemotePlaylistAlbums } from './playlistRemote';
import type { FilterState } from '../../types';

const mockedFetch = vi.mocked(apiFetch);

const filters = (over: Partial<FilterState> = {}): FilterState => ({
  search: '', genre: '', artist: '',
  yearFrom: '', yearTo: '',
  sortField: 'artist', sortOrder: 'asc',
  albumType: '', minPop: 0, maxPop: 100,
  ...over,
});

describe('listRemotePlaylists', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('accepts the FastAPI bare-array shape', async () => {
    mockedFetch.mockResolvedValueOnce([
      { id: 'p1', name: 'Mix', image_url: 'http://img/1', track_count: 3, public: false, synced_at: '2026-11-08T00:00:00Z' },
      { id: 'p2', name: 'Chill', image_url: null, track_count: 0, public: true, synced_at: null },
    ] as never);

    const { playlists, syncedAt } = await listRemotePlaylists('http://media.local:8000');

    expect(mockedFetch).toHaveBeenCalledWith('http://media.local:8000', '/api/v1/playlists');
    expect(playlists.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(playlists[0].name).toBe('Mix');
    expect(playlists[0].tracks.total).toBe(3);
    expect(syncedAt.get('p1')).toBe('2026-11-08T00:00:00Z');
    expect(syncedAt.has('p2')).toBe(false);
  });

  it('accepts the JWT-backend { data: [...] } envelope', async () => {
    mockedFetch.mockResolvedValueOnce({
      data: [
        { id: 'p3', name: 'Focus', image_url: null, track_count: 1, public: false, synced_at: null },
      ],
    } as never);

    const { playlists } = await listRemotePlaylists('http://media.local:8000');

    expect(playlists.map((p) => p.id)).toEqual(['p3']);
  });

  it('degrades to an empty list for an unexpected shape', async () => {
    mockedFetch.mockResolvedValueOnce({} as never);

    const { playlists, syncedAt } = await listRemotePlaylists('http://media.local:8000');

    expect(playlists).toEqual([]);
    expect(syncedAt.size).toBe(0);
  });

  it('keeps the added order so the "Date Added" chip can sort', async () => {
    mockedFetch.mockResolvedValueOnce([
      { id: 'p1', name: 'Newest', image_url: null, track_count: 1, public: false, synced_at: null, added_order: 0 },
      { id: 'p2', name: 'Older', image_url: null, track_count: 1, public: false, synced_at: null, added_order: 1 },
    ] as never);

    const { playlists } = await listRemotePlaylists('http://media.local:8000');

    expect(playlists.map((p) => p.addedOrder)).toEqual([0, 1]);
  });

  it('leaves the added order undefined when the server does not send one', async () => {
    mockedFetch.mockResolvedValueOnce([
      { id: 'p1', name: 'No order', image_url: null, track_count: 1, public: false, synced_at: null },
    ] as never);

    const { playlists } = await listRemotePlaylists('http://media.local:8000');

    expect(playlists[0].addedOrder).toBeUndefined();
  });
});

describe('queryRemotePlaylistAlbums', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('does not send empty year filters', async () => {
    mockedFetch.mockResolvedValueOnce({ items: [], total: 0 } as never);

    await queryRemotePlaylistAlbums(
      'http://media.local:8000', 'p1', filters(), 48, 0,
    );

    const url = mockedFetch.mock.calls[0][1] as string;
    expect(url).not.toContain('year_from');
    expect(url).not.toContain('year_to');
  });

  it('sends the year filters the user set', async () => {
    mockedFetch.mockResolvedValueOnce({ items: [], total: 0 } as never);

    await queryRemotePlaylistAlbums(
      'http://media.local:8000', 'p1', filters({ yearFrom: 1990, yearTo: 1999 }), 48, 0,
    );

    const url = mockedFetch.mock.calls[0][1] as string;
    expect(url).toContain('year_from=1990');
    expect(url).toContain('year_to=1999');
  });

  it('asks the server for the "Date Added" order', async () => {
    mockedFetch.mockResolvedValueOnce({ items: [], total: 0 } as never);

    await queryRemotePlaylistAlbums(
      'http://media.local:8000', 'p1', filters({ sortField: 'added_at', sortOrder: 'desc' }), 48, 0,
    );

    const url = mockedFetch.mock.calls[0][1] as string;
    expect(url).toContain('sort=added_at');
    expect(url).toContain('order=desc');
  });
});
