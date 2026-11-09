import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecent,
  describeLink,
  readLinkHistory,
  recordRecent,
  removeSavedLink,
  saveLink,
  subscribeLinkHistory,
  toggleSavedLink,
} from './linkHistory';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  get length(): number { return this.map.size; }
}

beforeEach(() => {
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
});

describe('describeLink', () => {
  it('shortens URLs to host + path', () => {
    expect(describeLink('https://www.songkick.com/metro-areas/12345', 'url'))
      .toBe('songkick.com/metro-areas/12345');
  });

  it('uses the first non-empty line for pasted text', () => {
    expect(describeLink('\n\n  Fri, Nov 13 — Artist  \nmore', 'text')).toBe('Fri, Nov 13 — Artist');
  });

  it('truncates long values', () => {
    const label = describeLink('https://example.com/' + 'a'.repeat(120), 'url');
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('recent history', () => {
  it('records newest first and de-duplicates by value', () => {
    recordRecent('concerts', 'https://a.example/1', 'url');
    recordRecent('concerts', 'https://a.example/2', 'url');
    recordRecent('concerts', 'https://a.example/1', 'url');
    const { recent } = readLinkHistory('concerts');
    expect(recent.map((e) => e.value)).toEqual(['https://a.example/1', 'https://a.example/2']);
  });

  it('caps recent entries at 8', () => {
    for (let i = 0; i < 12; i++) recordRecent('albums-ai', `https://a.example/${i}`, 'url');
    expect(readLinkHistory('albums-ai').recent).toHaveLength(8);
    expect(readLinkHistory('albums-ai').recent[0].value).toBe('https://a.example/11');
  });

  it('keeps buckets separate', () => {
    recordRecent('concerts', 'https://a.example/x', 'url');
    expect(readLinkHistory('site').recent).toHaveLength(0);
  });

  it('ignores empty values', () => {
    recordRecent('concerts', '   ', 'url');
    expect(readLinkHistory('concerts').recent).toHaveLength(0);
  });

  it('clears recent without touching saved', () => {
    recordRecent('concerts', 'https://a.example/1', 'url');
    saveLink('concerts', 'https://a.example/1', 'url');
    clearRecent('concerts');
    const state = readLinkHistory('concerts');
    expect(state.recent).toHaveLength(0);
    expect(state.saved).toHaveLength(1);
  });
});

describe('saved links', () => {
  it('saves once per value and toggles off', () => {
    const first = saveLink('site', 'https://a.example/1', 'url');
    expect(first.saved).toHaveLength(1);
    expect(saveLink('site', 'https://a.example/1', 'url').saved).toHaveLength(1);

    const off = toggleSavedLink('site', 'https://a.example/1', 'url');
    expect(off.saved).toHaveLength(0);
  });

  it('removes by id', () => {
    const state = saveLink('albums-paste', 'open.spotify.com/album/abc', 'text');
    const id = state.saved[0].id;
    expect(removeSavedLink('albums-paste', id).saved).toHaveLength(0);
  });

  it('notifies subscribers on write', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeLinkHistory((kind) => seen.push(kind));
    recordRecent('albums-ai', 'https://a.example/1', 'url');
    unsubscribe();
    recordRecent('albums-ai', 'https://a.example/2', 'url');
    expect(seen).toEqual(['albums-ai']);
  });
});

describe('corrupt storage', () => {
  it('returns an empty state instead of throwing', () => {
    (window as any).localStorage.setItem('respotit.linkHistory.v1.concerts', '{not json');
    expect(readLinkHistory('concerts')).toEqual({ recent: [], saved: [] });
  });
});
