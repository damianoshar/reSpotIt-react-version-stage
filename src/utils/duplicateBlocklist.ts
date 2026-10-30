import { Preferences } from '@capacitor/preferences';
import type { DuplicateAlbum } from './duplicateFinder';

const IDS_KEY = 'duplicate_hidden_ids';
const ALBUMS_KEY = 'duplicate_hidden_albums';

export async function getHiddenDuplicateIds(): Promise<Set<string>> {
  const res = await Preferences.get({ key: IDS_KEY });
  if (!res.value) return new Set();
  try { return new Set<string>(JSON.parse(res.value)); } catch { return new Set(); }
}

export async function getHiddenDuplicateAlbums(): Promise<DuplicateAlbum[]> {
  const res = await Preferences.get({ key: ALBUMS_KEY });
  if (!res.value) return [];
  try { return JSON.parse(res.value) as DuplicateAlbum[]; } catch { return []; }
}

export async function hideDuplicateAlbums(albums: DuplicateAlbum[]): Promise<void> {
  const ids = await getHiddenDuplicateIds();
  const cached = await getHiddenDuplicateAlbums();
  const byId = new Map(cached.map((a) => [a.id, a]));
  for (const album of albums) {
    ids.add(album.id);
    byId.set(album.id, album);
  }
  await Preferences.set({ key: IDS_KEY, value: JSON.stringify([...ids]) });
  await Preferences.set({ key: ALBUMS_KEY, value: JSON.stringify([...byId.values()]) });
}

export async function unhideDuplicateIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const idSet = new Set(ids);
  const previousIds = await getHiddenDuplicateIds();
  const nextIds = new Set(previousIds);
  idSet.forEach((id) => nextIds.delete(id));
  await Preferences.set({ key: IDS_KEY, value: JSON.stringify([...nextIds]) });
  const cached = await getHiddenDuplicateAlbums();
  await Preferences.set({
    key: ALBUMS_KEY,
    value: JSON.stringify(cached.filter((a) => !idSet.has(a.id))),
  });
}

export async function restoreHiddenDuplicates(): Promise<DuplicateAlbum[]> {
  const albums = await getHiddenDuplicateAlbums();
  await Preferences.remove({ key: IDS_KEY });
  await Preferences.remove({ key: ALBUMS_KEY });
  return albums;
}

// Backwards-compatible alias used by the earlier import path.
export async function hideDuplicateIds(ids: string[]): Promise<void> {
  await hideDuplicateAlbums(ids.map((id) => ({ id, title: '', artist: '', year: 0 })));
}

export async function restoreHiddenDuplicatesIds(): Promise<Set<string>> {
  await Preferences.remove({ key: IDS_KEY });
  return new Set();
}