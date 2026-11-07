/**
 * Pure planning helpers for the one persistent queue playlist.
 *
 * Ported from the Kotlin client (`ActiveQueuePlanner.kt`). The playlist itself
 * is the queue. Spotify's side queue can still contain manually queued tracks;
 * when the app starts a new playlist context it copies those tracks in, but
 * when it appends to the already-playing playlist it must leave them alone.
 */

import { isPlayable } from './queueSnapshot';

/**
 * Album tracks that are safe to append after `upcomingUris`. A selected album
 * can contain a track that is already in the active playlist tail or already
 * waiting in Spotify's manual queue; appending it again would play it twice.
 * Duplicates inside the selected album itself are preserved.
 */
export function newAlbumUris(
  albumUris: string[],
  upcomingUris: string[],
): string[] {
  const upcoming = new Set(
    upcomingUris
      .map((raw) => raw.trim())
      .filter((uri) => isPlayable(uri)),
  );
  const out: string[] = [];
  for (const raw of albumUris) {
    const uri = raw.trim();
    if (!isPlayable(uri)) continue;
    if (upcoming.has(uri)) continue;
    out.push(uri);
  }
  return out;
}

/**
 * Album tracks to insert immediately after the current track. The currently
 * playing track and the unplayed tail are both skipped.
 */
export function nextAlbumUris(
  albumUris: string[],
  currentUri: string | null | undefined,
  upcomingUris: string[],
): string[] {
  const avoid: string[] = [];
  if (currentUri != null) avoid.push(currentUri);
  avoid.push(...upcomingUris);
  return newAlbumUris(albumUris, avoid);
}

/**
 * Items in Spotify's manual queue that are not part of the active playlist's
 * unplayed tail. Count-aware, so intentional duplicates are not collapsed.
 */
export function extraUpcoming(
  queueUris: string[],
  activeTailUris: string[],
): string[] {
  const remaining = new Map<string, number>();
  for (const raw of activeTailUris) {
    const uri = raw.trim();
    if (!isPlayable(uri)) continue;
    remaining.set(uri, (remaining.get(uri) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const raw of queueUris) {
    const uri = raw.trim();
    if (!isPlayable(uri)) continue;
    const count = remaining.get(uri) ?? 0;
    if (count > 0) remaining.set(uri, count - 1);
    else out.push(uri);
  }
  return out;
}
