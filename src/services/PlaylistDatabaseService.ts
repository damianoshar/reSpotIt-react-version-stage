import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { ensureDb, saveToStore } from './DatabaseService';
import { PlaylistAlbum } from './SpotifyPlaylistFeedService';
import { PAGE_SIZE } from './DatabaseService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredPlaylistMeta {
  id:          string;
  name:        string;
  image_url:   string;
  track_count: number;
  album_count: number;
  synced_at:   string;
}

// ---------------------------------------------------------------------------
// WHERE builder (mirrors DatabaseService)
// ---------------------------------------------------------------------------

function buildWhere(
  playlistId: string,
  search: string, genre: string, yearFrom: string, yearTo: string, artist: string
): { where: string; params: unknown[] } {
  const conditions = ['playlist_id = ?'];
  const params: unknown[] = [playlistId];

  if (search) {
    conditions.push('(LOWER(title) LIKE ? OR LOWER(artist) LIKE ?)');
    const q = '%' + search.toLowerCase() + '%';
    params.push(q, q);
  }
  if (genre)    { conditions.push('LOWER(genre)  = LOWER(?)'); params.push(genre);  }
  if (artist)   { conditions.push('LOWER(artist) = LOWER(?)'); params.push(artist); }
  if (yearFrom) { conditions.push('year >= ?'); params.push(parseInt(yearFrom, 10)); }
  if (yearTo)   { conditions.push('year <= ?'); params.push(parseInt(yearTo,   10)); }

  return { where: 'WHERE ' + conditions.join(' AND '), params };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function savePlaylistAlbums(
  playlistId:  string,
  meta:        { name: string; image_url: string; track_count: number },
  albums:      PlaylistAlbum[],
): Promise<void> {
  const db = await ensureDb();

  // Replace all albums for this playlist in one transaction
  await db.run('DELETE FROM playlist_albums WHERE playlist_id = ?', [playlistId]);

  for (const a of albums) {
    await db.run(
      `INSERT OR REPLACE INTO playlist_albums
         (playlist_id, album_id, title, artist, year, genre, image_url, track_count, track_titles)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [playlistId, a.id, a.title, a.artist, a.year, a.genre, a.image_url,
       a.trackCount, JSON.stringify(a.trackTitles)]
    );
  }

  await db.run(
    `INSERT OR REPLACE INTO playlists (id, name, image_url, track_count, album_count, synced_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [playlistId, meta.name, meta.image_url, meta.track_count, albums.length, new Date().toISOString()]
  );

  // Persist to IndexedDB — the library sync does the same after its writes.
  await saveToStore();
}

// ---------------------------------------------------------------------------
// Read — paginated
// ---------------------------------------------------------------------------

export async function loadPlaylistAlbums(
  playlistId: string,
  search    = '',
  genre     = '',
  sortField = 'artist',
  sortOrder = 'asc',
  yearFrom  = '',
  yearTo    = '',
  artist    = '',
  limit     = PAGE_SIZE,
  offset    = 0,
): Promise<PlaylistAlbum[]> {
  const db = await ensureDb();
  const { where, params } = buildWhere(playlistId, search, genre, yearFrom, yearTo, artist);
  const allowed = new Set(['title', 'artist', 'year', 'genre', 'track_count']);
  const col     = allowed.has(sortField) ? sortField : 'artist';
  const dir     = sortOrder === 'desc' ? 'DESC' : 'ASC';

  const result = await db.query(
    `SELECT * FROM playlist_albums ${where}
     ORDER BY LOWER(${col}) ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return ((result.values ?? []) as any[]).map((row) => ({
    id:          row.album_id   as string,
    title:       row.title      as string,
    artist:      row.artist     as string,
    year:        row.year       as number,
    genre:       row.genre      as string,
    image_url:   row.image_url  as string,
    image_path:  '',
    trackCount:  row.track_count as number,
    trackTitles: JSON.parse(row.track_titles ?? '[]') as string[],
  }));
}

export async function countPlaylistAlbums(
  playlistId: string,
  search = '', genre = '', yearFrom = '', yearTo = '', artist = '',
): Promise<number> {
  const db = await ensureDb();
  const { where, params } = buildWhere(playlistId, search, genre, yearFrom, yearTo, artist);
  const result = await db.query(
    `SELECT COUNT(*) AS n FROM playlist_albums ${where}`, params
  );
  return ((result.values ?? [{}]) as { n: number }[])[0]?.n ?? 0;
}

export async function getPlaylistMeta(playlistId: string): Promise<StoredPlaylistMeta | null> {
  const db = await ensureDb();
  const result = await db.query(
    'SELECT * FROM playlists WHERE id = ?', [playlistId]
  );
  const row = ((result.values ?? []) as any[])[0];
  if (!row) return null;
  return {
    id:          row.id,
    name:        row.name,
    image_url:   row.image_url,
    track_count: row.track_count,
    album_count: row.album_count,
    synced_at:   row.synced_at,
  };
}

export async function getCachedPlaylistIds(): Promise<Set<string>> {
  const db = await ensureDb();
  const result = await db.query('SELECT id FROM playlists');
  return new Set<string>(((result.values ?? []) as { id: string }[]).map((r) => r.id));
}

export async function getPlaylistFilterOptions(playlistId: string) {
  const db = await ensureDb();

  const [gRes, aRes, yRes] = await Promise.all([
    db.query("SELECT DISTINCT genre FROM playlist_albums WHERE playlist_id = ? AND genre != '' ORDER BY genre", [playlistId]),
    db.query("SELECT DISTINCT artist FROM playlist_albums WHERE playlist_id = ? AND artist != '' ORDER BY LOWER(artist)", [playlistId]),
    db.query("SELECT DISTINCT year FROM playlist_albums WHERE playlist_id = ? AND year > 0 ORDER BY year DESC", [playlistId]),
  ]);

  return {
    genres:  ((gRes.values ?? []) as { genre:  string }[]).map((r) => r.genre),
    artists: ((aRes.values ?? []) as { artist: string }[]).map((r) => r.artist),
    years:   ((yRes.values ?? []) as { year:   number }[]).map((r) => r.year),
  };
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------

const CSV_HEADERS = ['id', 'album_title', 'artist', 'year', 'genre', 'image_url', 'track_count', 'tracks'];

function escapeCell(v: string | number | undefined): string {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function playlistAlbumsToCSV(albums: PlaylistAlbum[]): string {
  const rows = albums.map((a) =>
    [a.id, a.title, a.artist, a.year, a.genre, a.image_url,
     a.trackCount, a.trackTitles.join('; ')].map(escapeCell).join(',')
  );
  return [CSV_HEADERS.join(','), ...rows].join('\n');
}

export interface PlaylistExportResult { path: string; bytes: number; }

export async function exportPlaylistCSV(
  playlistId:   string,
  playlistName: string,
): Promise<PlaylistExportResult | null> {
  // Load ALL albums for this playlist (no filter, no limit)
  const all = await loadPlaylistAlbums(playlistId, '', '', 'artist', 'asc', '', '', '', 9999, 0);
  if (!all.length) return null;

  const csv      = playlistAlbumsToCSV(all);
  const safe     = playlistName.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase();
  const d        = new Date();
  const pad      = (n: number) => String(n).padStart(2, '0');
  const filename = `playlist-${safe}-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.csv`;

  if (Capacitor.getPlatform() === 'web') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    return { path: '(browser download)', bytes: 0 };
  }

  await Filesystem.writeFile({
    path: filename, data: csv,
    directory: Directory.Documents,
    encoding:  Encoding.UTF8,
  });

  let fullPath = filename;
  try {
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Documents });
    fullPath = uri;
  } catch { /* non-critical */ }

  return { path: fullPath, bytes: new Blob([csv]).size };
}

export async function deletePlaylistAlbums(playlistId: string, albumIds: string[]): Promise<void> {
  if (!albumIds.length) return;
  const db = await ensureDb();
  for (const albumId of albumIds) {
    await db.run('DELETE FROM playlist_albums WHERE playlist_id = ? AND album_id = ?', [playlistId, albumId]);
  }
  await saveToStore();
}

export async function deletePlaylistCache(playlistId: string): Promise<void> {
  const db = await ensureDb();
  await db.run('DELETE FROM playlist_albums WHERE playlist_id = ?', [playlistId]);
  await db.run('DELETE FROM playlists WHERE id = ?', [playlistId]);
  await saveToStore();
}
