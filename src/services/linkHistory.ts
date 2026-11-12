// ---------------------------------------------------------------------------
// Recent searches + saved links for the "add from a page" entry points.
//
// Four dialogs share this store but keep separate buckets, so the concerts
// list does not mix with album scans:
//   concerts      — ConcertsDialog (scan concerts)
//   albums-ai     — AiUrlScanDialog with a server (scan page with AI)
//   albums-paste  — AiUrlScanDialog without a server (pasted Spotify links)
//   tracks-ai     — AiTrackScanDialog (scan page with AI, tracks)
//   site          — AddFromSiteDialog (in-app browser / detect links)
//
// Storage is localStorage: small, per-device, and it survives app restarts in
// the Capacitor WebView. Nothing here is user-scoped server data.
// ---------------------------------------------------------------------------

export type LinkHistoryKind = 'concerts' | 'albums-ai' | 'albums-paste' | 'tracks-ai' | 'site';

/** Where a stored value belongs when picked: the URL field or the text box. */
export type LinkTarget = 'url' | 'text';

export interface LinkHistoryEntry {
  value: string;
  label: string;
  target: LinkTarget;
  usedAt: number;
}

export interface SavedLink extends LinkHistoryEntry {
  id: string;
  createdAt: number;
}

export interface LinkHistoryState {
  recent: LinkHistoryEntry[];
  saved: SavedLink[];
}

const RECENT_LIMIT = 8;
const SAVED_LIMIT = 40;
const MAX_URL_CHARS = 2_000;
const MAX_TEXT_CHARS = 50_000;

const STORAGE_PREFIX = 'respotit.linkHistory.v1.';

function storageKey(kind: LinkHistoryKind): string {
  return STORAGE_PREFIX + kind;
}

function canStore(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

/** Short, human label for a chip: host+path for URLs, first line for text. */
export function describeLink(value: string, target: LinkTarget): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (target === 'text') {
    const line = trimmed.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? 'Pasted text';
    return line.length > 60 ? line.slice(0, 57) + '…' : line;
  }
  try {
    const u = new URL(trimmed);
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
    const label = (u.hostname.replace(/^www\./i, '') + path).replace(/\s+/g, ' ');
    return label.length > 60 ? label.slice(0, 57) + '…' : label || u.hostname;
  } catch {
    return trimmed.length > 60 ? trimmed.slice(0, 57) + '…' : trimmed;
  }
}

function isStorable(value: string, target: LinkTarget): boolean {
  const limit = target === 'text' ? MAX_TEXT_CHARS : MAX_URL_CHARS;
  return value.trim().length > 0 && value.length <= limit;
}

function emptyState(): LinkHistoryState {
  return { recent: [], saved: [] };
}

export function readLinkHistory(kind: LinkHistoryKind): LinkHistoryState {
  if (!canStore()) return emptyState();
  try {
    const raw = window.localStorage.getItem(storageKey(kind));
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<LinkHistoryState>;
    const recent = Array.isArray(parsed.recent) ? parsed.recent.filter(isEntry) : [];
    const saved = Array.isArray(parsed.saved) ? parsed.saved.filter(isSavedLink) : [];
    return { recent: recent.slice(0, RECENT_LIMIT), saved: saved.slice(0, SAVED_LIMIT) };
  } catch {
    return emptyState();
  }
}

function isEntry(value: unknown): value is LinkHistoryEntry {
  const e = value as LinkHistoryEntry;
  return !!e && typeof e.value === 'string' && typeof e.label === 'string'
    && (e.target === 'url' || e.target === 'text') && typeof e.usedAt === 'number';
}

function isSavedLink(value: unknown): value is SavedLink {
  const e = value as SavedLink;
  return isEntry(e) && typeof e.id === 'string' && typeof e.createdAt === 'number';
}

function writeLinkHistory(kind: LinkHistoryKind, state: LinkHistoryState): void {
  if (!canStore()) return;
  try {
    window.localStorage.setItem(storageKey(kind), JSON.stringify(state));
  } catch {
    // Quota or private mode: history is a convenience, never a blocker.
  }
  notify(kind);
}

type HistoryListener = (kind: LinkHistoryKind) => void;
const listeners = new Set<HistoryListener>();

/** Observe writes so an open dialog refreshes without prop plumbing. */
export function subscribeLinkHistory(listener: HistoryListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(kind: LinkHistoryKind): void {
  for (const listener of [...listeners]) {
    try { listener(kind); } catch { /* a listener must not break a write */ }
  }
}

function sameValue(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/**
 * Record a value as recently used. Newest first, de-duplicated by value, and
 * capped. Returns the updated state so callers can render without re-reading.
 */
export function recordRecent(
  kind: LinkHistoryKind,
  value: string,
  target: LinkTarget,
): LinkHistoryState {
  const state = readLinkHistory(kind);
  if (!isStorable(value, target)) return state;
  const entry: LinkHistoryEntry = {
    value,
    label: describeLink(value, target),
    target,
    usedAt: Date.now(),
  };
  const recent = [entry, ...state.recent.filter((e) => !sameValue(e.value, value))]
    .slice(0, RECENT_LIMIT);
  const next = { ...state, recent };
  writeLinkHistory(kind, next);
  return next;
}

/** Pin a value to the saved list (idempotent per value). */
export function saveLink(
  kind: LinkHistoryKind,
  value: string,
  target: LinkTarget,
  label?: string,
): LinkHistoryState {
  const state = readLinkHistory(kind);
  if (!isStorable(value, target)) return state;
  if (state.saved.some((e) => sameValue(e.value, value))) return state;
  const entry: SavedLink = {
    id: `saved-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    value,
    label: (label ?? '').trim() || describeLink(value, target),
    target,
    usedAt: Date.now(),
    createdAt: Date.now(),
  };
  const next = { ...state, saved: [entry, ...state.saved].slice(0, SAVED_LIMIT) };
  writeLinkHistory(kind, next);
  return next;
}

export function removeSavedLink(kind: LinkHistoryKind, id: string): LinkHistoryState {
  const state = readLinkHistory(kind);
  const next = { ...state, saved: state.saved.filter((e) => e.id !== id) };
  writeLinkHistory(kind, next);
  return next;
}

/** Toggle the saved state of [value]; returns the updated state. */
export function toggleSavedLink(
  kind: LinkHistoryKind,
  value: string,
  target: LinkTarget,
): LinkHistoryState {
  const state = readLinkHistory(kind);
  const existing = state.saved.find((e) => sameValue(e.value, value));
  return existing ? removeSavedLink(kind, existing.id) : saveLink(kind, value, target);
}

export function clearRecent(kind: LinkHistoryKind): LinkHistoryState {
  const state = readLinkHistory(kind);
  const next = { ...state, recent: [] };
  writeLinkHistory(kind, next);
  return next;
}
