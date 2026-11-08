import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiClient', () => ({
  apiFetch: vi.fn(),
  apiFetchBlob: vi.fn(),
}));

import { apiFetch } from './apiClient';
import { listRemotePlaylists } from './playlistRemote';

const mockedFetch = vi.mocked(apiFetch);

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
});
