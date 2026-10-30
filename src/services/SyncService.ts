import Papa from 'papaparse';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { upsertAlbum } from './DatabaseService';
import { Album } from '../types';

interface CSVRow {
  id?:         string;
  spotify_id?: string;
  title?:      string;
  artist?:     string;
  year?:       string;
  genre?:      string;
  image_url?:  string;
  added_at?:   string;
}

export interface SyncResult {
  imported: number;
  skipped:  number;
  existing: number; // already in DB, no action needed
  errors:   string[];
}

export async function importFromCSV(csvText: string): Promise<SyncResult> {
  const result: SyncResult = { imported: 0, skipped: 0, existing: 0, errors: [] };

  const parsed = Papa.parse<CSVRow>(csvText, {
    header:         true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  for (const row of parsed.data) {
    const id = row.id ?? row.spotify_id ?? '';
    if (!id || !row.title || !row.artist) {
      result.skipped++;
      result.errors.push(`Skipped row — missing id/title/artist: ${JSON.stringify(row)}`);
      continue;
    }

    try {
      await upsertAlbum({
        id,
        title:      row.title.trim(),
        artist:     row.artist.trim(),
        year:       parseInt(row.year ?? '0', 10) || 0,
        genre:      row.genre?.trim() ?? '',
        image_url:  row.image_url?.trim() ?? '',
        image_path: '',
        added_at:   row.added_at?.trim() ?? '',
      });
      result.imported++;
    } catch (e: any) {
      result.skipped++;
      result.errors.push(`"${row.title}": ${e?.message ?? e}`);
    }
  }

  return result;
}

export async function downloadAlbumImage(imageUrl: string, albumId: string): Promise<string> {
  if (!imageUrl || Capacitor.getPlatform() === 'web') return '';

  try {
    const res  = await fetch(imageUrl);
    const blob = await res.blob();
    const b64  = await blobToBase64(blob);
    const path = `album_images/${albumId}.jpg`;

    await Filesystem.writeFile({
      path,
      data:      b64,
      directory: Directory.Data,
      recursive: true,
    });
    return path;
  } catch {
    return '';
  }
}

export async function resolveImageSrc(imagePath: string): Promise<string> {
  if (!imagePath || Capacitor.getPlatform() === 'web') return '';
  try {
    const { uri } = await Filesystem.getUri({ path: imagePath, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  } catch {
    return '';
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
