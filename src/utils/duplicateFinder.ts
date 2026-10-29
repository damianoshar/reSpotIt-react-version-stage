// Port of com.spotifydashboard.app.utils.DuplicateFinder.kt.
// Local-library duplicate review only; app-level and reversible.

import type { Album } from '../types';

export interface DuplicateAlbum {
  id: string;
  title: string;
  artist: string;
  year: number;
  /** Rich fields are preserved when the source is a full Album, so a hidden
   *  duplicate can be restored locally without another Spotify round-trip. */
  genre?: string;
  image_url?: string;
  image_path?: string;
  added_at?: string;
  album_type?: string;
  popularity?: number | null;
  spotify_url?: string;
}

export interface DuplicateGroup {
  key: string;
  title: string;
  artist: string;
  albums: DuplicateAlbum[];
}

export function albumToDuplicateAlbum(a: Album): DuplicateAlbum {
  return { id: a.id, title: a.title, artist: a.artist, year: a.year };
}

const bracketRegex = /\([^\)]*\)|\[[^\]]*\]|\{[^}]*\}/g;
const suffixSplit = /\s+[-–—]\s+/g;
const combiningMarks = /\p{M}+/gu;
const nonAlnum = /[^a-z0-9]+/g;
const featSplit = /\s+(?:feat\.?|featuring|ft\.?)\s+/i;
const variantWords = ['deluxe', 'expanded', 'edition', 'remaster', 'remastered', 'reissue', 'bonus', 'anniversary', 'special', 'collector', 'collectors', 'limited', 'version', 'explicit', 'clean', 'mono', 'stereo', 'digipak'];
const regionTags = new Set(['uk', 'us', 'usa', 'eu', 'europe', 'european', 'international', 'japan', 'japanese', 'worldwide']);
const removablePhrases = ['deluxe edition', 'deluxe version', 'deluxe', 'expanded edition', 'expanded', 'special edition', "collector's edition", 'collectors edition', 'limited edition', 'anniversary edition', 'remastered edition', 'remastered', 'remaster', 'reissue', 'bonus track version', 'bonus tracks', 'bonus disc', 'explicit version', 'clean version', 'international version', 'japanese edition', 'uk version', 'us version', 'digipak'];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isVariantTag = (text: string): boolean => {
  const t = text.toLowerCase().replace(nonAlnum, ' ').trim();
  if (t === '') return true;
  if (regionTags.has(t)) return true;
  return variantWords.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(t));
};
export function normalizeTitle(raw: string): string {
  let s = raw.toLowerCase().normalize('NFD').replace(combiningMarks, '');
  s = s.replace(/&/g, ' and ');
  s = s.replace(bracketRegex, (match) => {
    const inner = match.slice(1, -1).trim();
    return isVariantTag(inner) ? ' ' : ` ${inner} `;
  });
  const parts = s.split(suffixSplit);
  if (parts.length > 1 && isVariantTag(parts[parts.length - 1])) {
    s = parts.slice(0, -1).join(' ');
  }
  for (const phrase of removablePhrases) {
    s = s.replace(new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi'), ' ');
  }
  s = s.replace(nonAlnum, ' ').replace(/\s+/g, ' ').trim();
  if (s.startsWith('the ')) s = s.slice(4).trim();
  return s;
}
export function primaryArtist(raw: string): string {
  let s = raw.toLowerCase().normalize('NFD').replace(combiningMarks, '');
  s = s.split(featSplit)[0] ?? s;
  s = s.split(',')[0] ?? s;
  s = s.replace(nonAlnum, ' ').replace(/\s+/g, ' ').trim();
  if (s.startsWith('the ')) s = s.slice(4).trim();
  return s;
}
export function findDuplicates(albums: Array<DuplicateAlbum | Album>): DuplicateGroup[] {
  const normalized = albums.map((a: any) => ({
    ...a,
    id: a.id,
    title: a.title,
    artist: a.artist,
    year: a.year,
  }));
  const buckets = new Map<string, DuplicateAlbum[]>();
  for (const album of normalized) {
    const title = normalizeTitle(album.title);
    const artist = primaryArtist(album.artist);
    if (!title || !artist) continue;
    const key = `${title}|${artist}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(album);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => {
      const ay = a.year > 0 ? a.year : Number.MAX_SAFE_INTEGER;
      const byY = b.year > 0 ? b.year : Number.MAX_SAFE_INTEGER;
      if (ay !== byY) return ay - byY;
      if (a.title.toLowerCase() !== b.title.toLowerCase())
        return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
      return a.id.localeCompare(b.id);
    });
    groups.push({
      key,
      title: sorted[0].title,
      artist: sorted[0].artist,
      albums: sorted,
    });
  }
  groups.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  return groups;
}
