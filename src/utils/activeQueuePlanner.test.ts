import { describe, expect, it } from 'vitest';
import {
  newAlbumUris,
  nextAlbumUris,
  extraUpcoming,
} from './activeQueuePlanner';

describe('activeQueuePlanner', () => {
  it('album tracks already upcoming are not appended again', () => {
    expect(newAlbumUris(
      ['spotify:track:a', 'spotify:track:b', 'spotify:track:c'],
      ['spotify:track:b'],
    )).toEqual(['spotify:track:a', 'spotify:track:c']);
  });

  it('preserves duplicates inside the selected album', () => {
    expect(newAlbumUris(
      ['spotify:track:a', 'spotify:track:a', 'spotify:track:b'],
      [],
    )).toEqual(['spotify:track:a', 'spotify:track:a', 'spotify:track:b']);
  });

  it('drops unsupported and blank album items', () => {
    expect(newAlbumUris(
      ['', 'spotify:local:artist:album:track:1', 'spotify:episode:e1'],
      [],
    )).toEqual(['spotify:episode:e1']);
  });

  it('queue next skips current and unplayed tail', () => {
    expect(nextAlbumUris(
      ['spotify:track:current', 'spotify:track:next', 'spotify:track:after', 'spotify:track:new'],
      'spotify:track:current',
      ['spotify:track:next', 'spotify:track:after'],
    )).toEqual(['spotify:track:new']);
  });

  it('queue next keeps duplicates inside the selected album', () => {
    expect(nextAlbumUris(
      ['spotify:track:a', 'spotify:track:a', 'spotify:track:b'],
      'spotify:track:current',
      [],
    )).toEqual(['spotify:track:a', 'spotify:track:a', 'spotify:track:b']);
  });

  it('counts manual queue items separately from active tail', () => {
    expect(extraUpcoming(
      ['spotify:track:manual', 'spotify:track:c', 'spotify:track:c', 'spotify:track:d'],
      ['spotify:track:c', 'spotify:track:d'],
    )).toEqual(['spotify:track:manual', 'spotify:track:c']);
  });

  it('a queue exactly matching active tail has no extras', () => {
    expect(extraUpcoming(
      ['spotify:track:c', 'spotify:track:d'],
      ['spotify:track:c', 'spotify:track:d'],
    )).toEqual([]);
  });
});
