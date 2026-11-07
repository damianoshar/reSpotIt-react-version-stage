import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { Album } from '../types';

const CSV_HEADERS = ['id', 'title', 'artist', 'year', 'genre', 'image_url', 'added_at'];

function escapeCell(value: string | number | undefined): string {
  const str = String(value ?? '');
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? '"' + str.replace(/"/g, '""') + '"'
    : str;
}

export function albumsToCSV(albums: Album[]): string {
  const rows = albums.map((a) =>
    [a.id, a.title, a.artist, a.year, a.genre, a.image_url, a.added_at ?? '']
      .map(escapeCell).join(',')
  );
  return [CSV_HEADERS.join(','), ...rows].join('\n');
}

function buildFilename(): string {
  const d   = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `spotify-library-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.csv`;
}

export interface BackupResult {
  path:     string;
  filename: string;
  bytes:    number;
}

export async function writeBackupFile(albums: Album[], subdirName: string): Promise<BackupResult> {
  const csv      = albumsToCSV(albums);
  const filename = buildFilename();
  const path     = subdirName.trim() ? subdirName.trim() + '/' + filename : filename;

  await Filesystem.writeFile({
    path,
    data:      csv,
    directory: Directory.Documents,
    encoding:  Encoding.UTF8,
    recursive: true,
  });

  let fullPath = path;
  try {
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Documents });
    fullPath = uri;
  } catch { /* non-critical */ }

  return { path: fullPath, filename, bytes: new Blob([csv]).size };
}

export function downloadCSVOnWeb(albums: Album[]): void {
  const csv  = albumsToCSV(albums);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: buildFilename() });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportBackup(albums: Album[], subdirName: string): Promise<BackupResult | null> {
  if (!albums.length) return null;
  if (Capacitor.getPlatform() === 'web') {
    downloadCSVOnWeb(albums);
    return { path: '(browser download)', filename: buildFilename(), bytes: 0 };
  }
  return writeBackupFile(albums, subdirName);
}
