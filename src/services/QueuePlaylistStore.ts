import { Preferences } from '@capacitor/preferences';

// ---------------------------------------------------------------------------
// Queue playlist persistence
//
// Mirrors the Kotlin QueuePlaylistStore: one merge-mode playlist and one
// local-playlist-mode queue, plus the last local cursor. Both queue models are
// kept side by side so they can be A/B tested without losing state.
// ---------------------------------------------------------------------------

export type QueueMode = 'local' | 'merge';

export interface QueuePlaylistRef {
  playlistId: string;
  name:       string;
  uris:       string[];
}

export interface LocalQueueCursor {
  playlistId: string;
  index:      number;
  uri:        string | null;
}

const KEY_MODE          = 'queue_mode';
const KEY_MERGE         = 'queue_merge_playlist';
const KEY_LOCAL         = 'queue_local_playlist';
const KEY_LOCAL_CURSOR  = 'queue_local_cursor';

export interface StoredQueueState {
  mode:   QueueMode;
  merge:  QueuePlaylistRef | null;
  local:  QueuePlaylistRef | null;
  cursor: LocalQueueCursor | null;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeRef(value: unknown): QueuePlaylistRef | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as Partial<QueuePlaylistRef>;
  if (typeof ref.playlistId !== 'string' || ref.playlistId.trim().length === 0) return null;
  return {
    playlistId: ref.playlistId,
    name:       typeof ref.name === 'string' ? ref.name : '',
    uris:       Array.isArray(ref.uris)
      ? ref.uris.filter((uri): uri is string => typeof uri === 'string' && uri.trim().length > 0)
      : [],
  };
}

function normalizeCursor(value: unknown): LocalQueueCursor | null {
  if (!value || typeof value !== 'object') return null;
  const cursor = value as Partial<LocalQueueCursor>;
  if (typeof cursor.playlistId !== 'string' || cursor.playlistId.trim().length === 0) return null;
  return {
    playlistId: cursor.playlistId,
    index:      typeof cursor.index === 'number' && Number.isFinite(cursor.index)
      ? cursor.index
      : -1,
    uri:        typeof cursor.uri === 'string' && cursor.uri.trim().length > 0
      ? cursor.uri
      : null,
  };
}

export async function loadQueueState(): Promise<StoredQueueState> {
  const [modeResult, mergeResult, localResult, cursorResult] = await Promise.all([
    Preferences.get({ key: KEY_MODE }),
    Preferences.get({ key: KEY_MERGE }),
    Preferences.get({ key: KEY_LOCAL }),
    Preferences.get({ key: KEY_LOCAL_CURSOR }),
  ]);

  return {
    mode:   modeResult.value === 'merge' ? 'merge' : 'local',
    merge:  normalizeRef(parseJson<unknown>(mergeResult.value)),
    local:  normalizeRef(parseJson<unknown>(localResult.value)),
    cursor: normalizeCursor(parseJson<unknown>(cursorResult.value)),
  };
}

export async function saveQueueMode(mode: QueueMode): Promise<void> {
  await Preferences.set({ key: KEY_MODE, value: mode });
}

export async function saveMergeQueue(ref: QueuePlaylistRef | null): Promise<void> {
  if (ref == null) {
    await Preferences.remove({ key: KEY_MERGE });
    return;
  }
  await Preferences.set({ key: KEY_MERGE, value: JSON.stringify(ref) });
}

export async function saveLocalQueue(ref: QueuePlaylistRef | null): Promise<void> {
  if (ref == null) {
    await Preferences.remove({ key: KEY_LOCAL });
    return;
  }
  await Preferences.set({ key: KEY_LOCAL, value: JSON.stringify(ref) });
}

export async function saveLocalCursor(cursor: LocalQueueCursor | null): Promise<void> {
  if (cursor == null) {
    await Preferences.remove({ key: KEY_LOCAL_CURSOR });
    return;
  }
  await Preferences.set({ key: KEY_LOCAL_CURSOR, value: JSON.stringify(cursor) });
}

export async function clearQueueState(): Promise<void> {
  await Promise.all([
    Preferences.remove({ key: KEY_MODE }),
    Preferences.remove({ key: KEY_MERGE }),
    Preferences.remove({ key: KEY_LOCAL }),
    Preferences.remove({ key: KEY_LOCAL_CURSOR }),
  ]);
}

/** Same naming convention as the Kotlin client. */
export function queuePlaylistName(): string {
  const stamp = new Intl.DateTimeFormat(undefined, {
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  }).format(new Date());
  return `Queue playlist · ${stamp}`;
}
