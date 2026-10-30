import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { unfollowPlaylist } from './SpotifyPlaylistService';
import { deletePlaylistCache } from './PlaylistDatabaseService';

// ... (same body from standalone) ...
const STORE_KEY = 'shortlived_playlists';
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface LocalRetention {
  playlistId: string;
  name:       string;
  expiresAt:  string;
}

type RetentionMap = Record<string, LocalRetention>;

async function readMap(): Promise<RetentionMap> {
  const { value } = await Preferences.get({ key: STORE_KEY });
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as RetentionMap : {};
  } catch { return {}; }
}
async function writeMap(map: RetentionMap): Promise<void> {
  await Preferences.set({ key: STORE_KEY, value: JSON.stringify(map) });
}
export async function getLocalRetention(): Promise<LocalRetention[]> {
  const map = await readMap();
  return Object.values(map).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}
export async function getLocalRetentionFor(playlistId: string): Promise<LocalRetention | null> {
  const map = await readMap();
  return map[playlistId] ?? null;
}
export async function setLocalRetention(entry: LocalRetention): Promise<void> {
  const map = await readMap();
  map[entry.playlistId] = entry;
  await writeMap(map);
}
export async function clearLocalRetention(playlistId: string): Promise<void> {
  const map = await readMap();
  delete map[playlistId];
  await writeMap(map);
}
export async function deleteLocalPlaylistNow(playlistId: string): Promise<void> {
  await unfollowPlaylist(playlistId);
  await deletePlaylistCache(playlistId);
  await clearLocalRetention(playlistId);
}
export interface SweepResult { deleted: number; failed: number; errors: string[]; }
export async function sweepLocalRetention(): Promise<SweepResult> {
  const map = await readMap();
  const now = Date.now();
  const due = Object.values(map).filter((r) => new Date(r.expiresAt).getTime() <= now);
  const result: SweepResult = { deleted: 0, failed: 0, errors: [] };
  for (const entry of due) {
    try {
      await unfollowPlaylist(entry.playlistId);
      await deletePlaylistCache(entry.playlistId);
      delete map[entry.playlistId];
      result.deleted++;
    } catch (e: any) {
      result.failed++;
      if (result.errors.length < 5) result.errors.push(e?.message ?? String(e));
    }
  }
  if (result.deleted > 0) await writeMap(map);
  return result;
}
export function startRetentionScheduler(onSweep?: (result: SweepResult) => void): () => void {
  let disposed = false;
  const run = () => {
    sweepLocalRetention()
      .then((r) => { if (!disposed && onSweep && (r.deleted > 0 || r.failed > 0)) onSweep(r); })
      .catch(() => {});
  };
  run();
  const timer = window.setInterval(run, 5 * 60 * 1000);
  const listener = App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
    if (isActive) run();
  });
  return () => {
    disposed = true;
    window.clearInterval(timer);
    void listener.then((h: any) => h.remove()).catch(() => {});
  };
}
