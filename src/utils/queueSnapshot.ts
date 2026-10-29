/**
 * Pure helpers for the player's queue actions.
 *
 * Ported from the Kotlin client (`QueueSnapshot.kt`) so both frontends make
 * exactly the same decisions about snapshots, appends and queue playlists.
 * Spotify playlists accept tracks and episodes, but not local files. Order
 * and duplicates are preserved deliberately: a queue is a sequence.
 */

const PLAYABLE_PREFIXES = ['spotify:track:', 'spotify:episode:'];

export interface QueuePlaylistHead {
  /** The playlist content. */
  uris: string[];
  /** Index into `uris` where playback should continue. */
  offset: number;
  /** Items dropped because Spotify playlists cannot hold them. */
  skipped: number;
}

export function isPlayable(uri: string | null | undefined): boolean {
  const trimmed = (uri ?? '').trim();
  return trimmed.length > 0 && PLAYABLE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function playable(uris: string[]): string[] {
  return uris
    .map((uri) => uri.trim())
    .filter((uri) => isPlayable(uri));
}

/** Current track followed by the up-next queue, both filtered to playable items. */
export function playlistUris(
  currentUri: string | null | undefined,
  queueUris: string[],
): string[] {
  const out: string[] = [];
  if (isPlayable(currentUri)) out.push((currentUri as string).trim());
  for (const uri of queueUris) {
    if (isPlayable(uri)) out.push(uri.trim());
  }
  return out;
}

/** Only the up-next queue, for appending to the playlist that is already playing. */
export function queueUris(queue: string[]): string[] {
  return playlistUris(null, queue);
}

/**
 * Content for a new queue playlist. Prefer what Spotify will play next; fall
 * back to the current track when the side queue is empty.
 */
export function newQueueContent(
  currentUri: string | null | undefined,
  queue: string[],
): string[] {
  const upNext = queueUris(queue);
  if (upNext.length > 0) return upNext;
  return isPlayable(currentUri) ? [(currentUri as string).trim()] : [];
}

/**
 * Head of a "queue playlist": the current track followed by the up-next queue.
 * The current track is item 0, so a context switch continues at item 1.
 */
export function queuePlaylistHead(
  currentUri: string | null | undefined,
  queue: string[],
): QueuePlaylistHead {
  const uris = playlistUris(currentUri, queue);
  const raw = [currentUri ?? '', ...queue];
  const skipped = raw.filter((uri) => uri.trim().length > 0).length - uris.length;
  const hasCurrent = isPlayable(currentUri);
  return { uris, offset: hasCurrent ? 1 : 0, skipped };
}

/**
 * The up-next items that are not part of a queue playlist this app generated
 * earlier. When the generated playlist is the playing context, its own
 * remaining tracks sit at the tail of the up-next list; copying them would
 * repeat them.
 */
export function upNextWithoutOwnItems(
  queue: string[],
  ownUris: string[],
  currentUri: string | null | undefined,
): string[] {
  if (ownUris.length === 0) return queue;
  const current = (currentUri ?? '').trim();
  const index = current.length === 0 ? -1 : ownUris.indexOf(current);
  if (index < 0) return [];
  const ownRemaining = Math.max(0, ownUris.length - index - 1);
  return queue.slice(0, Math.max(0, queue.length - ownRemaining));
}

/**
 * Up-next items when the playing context is the app's own queue playlist.
 * Consumes the old playlist's remainder from Spotify's queue count-aware, so
 * duplicate URIs are not collapsed. Any remainder Spotify did not report is
 * appended afterwards.
 */
export function upNextIncludingPrevious(
  queue: string[],
  previousUris: string[],
  currentUri: string | null | undefined,
  dropRepeats = false,
  currentIndex: number | null = null,
): string[] {
  const current = (currentUri ?? '').trim();
  const previous = previousUris.map((uri) => uri.trim()).filter((uri) => uri.length > 0);
  if (previous.length === 0) return playable(queue);

  const located = currentIndex != null && currentIndex >= 0 && currentIndex < previous.length
    ? currentIndex
    : current.length === 0 ? -1 : previous.indexOf(current);
  if (located < 0) return playable(queue);

  const remaining = previous.slice(located + 1);
  const remainingCounts = new Map<string, number>();
  for (const uri of remaining) remainingCounts.set(uri, (remainingCounts.get(uri) ?? 0) + 1);
  const previousSet = new Set(previous);
  const out: string[] = [];
  let tailComplete = remainingCounts.size === 0;

  for (const raw of queue) {
    const uri = raw.trim();
    if (!isPlayable(uri)) continue;
    if (uri === current) continue;
    const count = remainingCounts.get(uri) ?? 0;
    if (count > 0) {
      remainingCounts.set(uri, count - 1);
      out.push(uri);
      if ([...remainingCounts.values()].every((value) => value === 0)) tailComplete = true;
      continue;
    }
    if (dropRepeats && tailComplete && previousSet.has(uri)) {
      // A new cycle of the old playlist (repeat=context), or a repeated track
      // after its tail. Not new music.
      continue;
    }
    out.push(uri);
  }

  // Spotify may not report the context's remaining tracks. Keep them.
  for (const uri of remaining) {
    const count = remainingCounts.get(uri) ?? 0;
    if (count > 0) {
      remainingCounts.set(uri, count - 1);
      out.push(uri);
    }
  }
  return out;
}
