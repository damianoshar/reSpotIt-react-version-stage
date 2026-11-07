import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, unfollow, deleteCache } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  unfollow: vi.fn(),
  deleteCache: vi.fn(),
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => { store.set(key, value); }),
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
  },
}));

vi.mock('./SpotifyPlaylistService', () => ({
  unfollowPlaylist: unfollow,
}));

vi.mock('./PlaylistDatabaseService', () => ({
  deletePlaylistCache: deleteCache,
}));

import {
  getLocalRetention,
  setLocalRetention,
  sweepLocalRetention,
} from './PlaylistRetentionService';

const past = () => new Date(Date.now() - 60_000).toISOString();

describe('PlaylistRetentionService', () => {
  beforeEach(() => {
    store.clear();
    unfollow.mockReset();
    deleteCache.mockReset();
  });

  it('round-trips stored entries', async () => {
    await setLocalRetention({ playlistId: 'p1', name: 'one', expiresAt: '2030-01-01T00:00:00.000Z' });
    const rows = await getLocalRetention();
    expect(rows.map((r) => r.playlistId)).toEqual(['p1']);
  });

  it('sweeps expired entries', async () => {
    await setLocalRetention({ playlistId: 'old', name: 'old', expiresAt: past() });
    const result = await sweepLocalRetention();
    expect(result.deleted).toBe(1);
    expect(unfollow).toHaveBeenCalledWith('old');
    expect(deleteCache).toHaveBeenCalledWith('old');
    expect((await getLocalRetention()).length).toBe(0);
  });

  it('keeps entries that are not due', async () => {
    await setLocalRetention({ playlistId: 'future', name: 'future', expiresAt: '2030-01-01T00:00:00.000Z' });
    const result = await sweepLocalRetention();
    expect(result.deleted).toBe(0);
    expect((await getLocalRetention()).length).toBe(1);
  });
});
