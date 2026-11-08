import {
  getConcerts, upsertConcerts, deleteConcert, clearConcerts,
  type Concert,
} from '../DatabaseService';
import {
  getHiddenDuplicateAlbums, hideDuplicateAlbums, unhideDuplicateIds,
  restoreHiddenDuplicates, replaceHiddenDuplicateAlbums,
} from '../../utils/duplicateBlocklist';
import type { DuplicateAlbum } from '../../utils/duplicateFinder';
import {
  listRemoteConcerts, upsertRemoteConcerts, deleteRemoteConcert,
  clearRemoteConcerts, importRemoteConcerts,
} from '../remote/concertsRemote';
import {
  listRemoteHiddenDuplicates, hideRemoteDuplicates, unhideRemoteDuplicateIds,
  restoreRemoteHiddenDuplicates, importRemoteHiddenDuplicates,
} from '../remote/duplicatesRemote';

// ---------------------------------------------------------------------------
// Storage facade — one API for server-canonical data.
//
// Callers pass the current context; the facade routes to the local SQLite /
// Preferences store in local mode and to the server in remote mode. This is
// what makes "no tool is mode-limited": concerts and the duplicate blocklist
// behave the same in both modes (docs/STORAGE-POLICY.md).
// ---------------------------------------------------------------------------

export interface StorageContext {
  remote: boolean;
  serverUrl: string;
}

// ── Concerts ─────────────────────────────────────────────────────────────────

export async function listConcerts(ctx: StorageContext): Promise<Concert[]> {
  return ctx.remote ? listRemoteConcerts(ctx.serverUrl) : getConcerts();
}

export async function saveConcerts(ctx: StorageContext, concerts: Concert[]): Promise<void> {
  if (ctx.remote) return upsertRemoteConcerts(ctx.serverUrl, concerts);
  return upsertConcerts(concerts);
}

export async function removeConcert(ctx: StorageContext, id: string): Promise<void> {
  if (ctx.remote) return deleteRemoteConcert(ctx.serverUrl, id);
  return deleteConcert(id);
}

export async function clearAllConcerts(ctx: StorageContext): Promise<void> {
  if (ctx.remote) return clearRemoteConcerts(ctx.serverUrl);
  return clearConcerts();
}

/** Push helper: mirror the device's concerts onto the server. */
export async function mirrorConcertsToServer(
  ctx: StorageContext,
  concerts: Concert[],
): Promise<void> {
  await importRemoteConcerts(ctx.serverUrl, concerts, true);
}

// ── Hidden duplicates ────────────────────────────────────────────────────────

export async function listHiddenDuplicates(ctx: StorageContext): Promise<DuplicateAlbum[]> {
  return ctx.remote ? listRemoteHiddenDuplicates(ctx.serverUrl) : getHiddenDuplicateAlbums();
}

export async function hideDuplicates(
  ctx: StorageContext,
  albums: DuplicateAlbum[],
): Promise<void> {
  if (ctx.remote) return hideRemoteDuplicates(ctx.serverUrl, albums);
  return hideDuplicateAlbums(albums);
}

export async function unhideDuplicates(ctx: StorageContext, ids: string[]): Promise<void> {
  if (ctx.remote) return unhideRemoteDuplicateIds(ctx.serverUrl, ids);
  return unhideDuplicateIds(ids);
}

export async function restoreHidden(ctx: StorageContext): Promise<DuplicateAlbum[]> {
  return ctx.remote ? restoreRemoteHiddenDuplicates(ctx.serverUrl) : restoreHiddenDuplicates();
}

/** Pull helper: replace the device's hidden store with the server's. */
export async function replaceLocalHidden(albums: DuplicateAlbum[]): Promise<void> {
  return replaceHiddenDuplicateAlbums(albums);
}

/** Push helper: mirror the device's hidden blocklist onto the server. */
export async function mirrorHiddenToServer(
  ctx: StorageContext,
  albums: DuplicateAlbum[],
): Promise<void> {
  await importRemoteHiddenDuplicates(ctx.serverUrl, albums, true);
}