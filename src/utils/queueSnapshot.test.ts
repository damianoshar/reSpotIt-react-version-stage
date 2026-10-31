import { describe, expect, it } from 'vitest';
import {
  isPlayable,
  playlistUris,
  queueUris,
  newQueueContent,
  queuePlaylistHead,
  upNextWithoutOwnItems,
  upNextIncludingPrevious,
} from './queueSnapshot';

describe('queueSnapshot', () => {
  it('keeps current track first and preserves queue order', () => {
    expect(playlistUris('spotify:track:now', [
      'spotify:track:b', 'spotify:track:a', 'spotify:track:b',
    ])).toEqual([
      'spotify:track:now', 'spotify:track:b', 'spotify:track:a', 'spotify:track:b',
    ]);
  });

  it('accepts tracks and episodes but rejects local/unsupported items', () => {
    expect(isPlayable('spotify:track:t1')).toBe(true);
    expect(isPlayable(' spotify:episode:e1 ')).toBe(true);
    expect(isPlayable('spotify:local:artist:album:track:1')).toBe(false);
    expect(isPlayable('spotify:album:a1')).toBe(false);
    expect(isPlayable('')).toBe(false);
    expect(isPlayable(null)).toBe(false);
  });

  it('skips blank and unsupported items', () => {
    expect(playlistUris(null, ['', 'spotify:local:artist:album:track:1', ' spotify:episode:e1 '])).toEqual(['spotify:episode:e1']);
  });

  it('append helper never includes current track', () => {
    expect(queueUris(['spotify:track:next'])).toEqual(['spotify:track:next']);
  });

  it('queue playlist head', () => {
    const head = queuePlaylistHead('spotify:track:now', ['spotify:track:a', 'spotify:episode:b']);
    expect(head.uris).toEqual(['spotify:track:now', 'spotify:track:a', 'spotify:episode:b']);
    expect(head.offset).toBe(1);
    expect(head.skipped).toBe(0);
  });

  it('queue playlist head starts at zero when no current track', () => {
    const head = queuePlaylistHead(null, ['spotify:track:a']);
    expect(head.uris).toEqual(['spotify:track:a']);
    expect(head.offset).toBe(0);
  });

  it('counts unsupported items as skipped', () => {
    const head = queuePlaylistHead('spotify:local:artist:album:track:1', ['spotify:track:a', 'spotify:local:artist:album:track:2']);
    expect(head.uris).toEqual(['spotify:track:a']);
    expect(head.offset).toBe(0);
    expect(head.skipped).toBe(2);
  });

  it('filters own queue playlist items', () => {
    expect(upNextWithoutOwnItems(
      ['spotify:track:manual', 'spotify:track:c'],
      ['spotify:track:a', 'spotify:track:b', 'spotify:track:c'],
      'spotify:track:b',
    )).toEqual(['spotify:track:manual']);
  });

  it('drops everything when own items cannot be located', () => {
    expect(upNextWithoutOwnItems(['spotify:track:a', 'spotify:track:b'], ['spotify:track:x'], null)).toEqual([]);
    expect(upNextWithoutOwnItems(['spotify:track:a', 'spotify:track:b'], ['spotify:track:x'], 'spotify:track:other')).toEqual([]);
  });

  it('keeps a queue without own items unchanged', () => {
    expect(upNextWithoutOwnItems(['spotify:track:a', 'spotify:track:b'], [], 'spotify:track:z')).toEqual(['spotify:track:a', 'spotify:track:b']);
  });

  it('new queue content prefers up-next then current', () => {
    expect(newQueueContent('spotify:track:now', ['spotify:track:next'])).toEqual(['spotify:track:next']);
    expect(newQueueContent('spotify:track:now', [])).toEqual(['spotify:track:now']);
  });

  it('up next inclusion handles current context', () => {
    expect(upNextIncludingPrevious(['spotify:track:manual', 'spotify:track:c'], ['spotify:track:a', 'spotify:track:b', 'spotify:track:c'], 'spotify:track:b')).toEqual(['spotify:track:manual', 'spotify:track:c']);
  });
});
