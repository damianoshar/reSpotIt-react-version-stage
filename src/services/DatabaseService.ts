import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import { Album, LibraryStats } from '../types';
import { setupWebSqlite } from './webSqlite';

const sqlite = new SQLiteConnection(CapacitorSQLite);
let db: Awaited<ReturnType<typeof sqlite.createConnection>>;

export function getDb() { return db; }

// Single-flight init — concurrent callers share one promise, so the library
// and the playlist dashboard can both ask for the DB without racing.
let initPromise: Promise<void> | null = null;

export function initDB(): Promise<void> {
  if (!initPromise) {
    initPromise = doInitDB().catch((err) => {
      initPromise = null; // a failed init can be retried on the next call
      throw err;
    });
  }
  return initPromise;
}

/** Awaits init and returns the open connection — use in every DB accessor. */
export async function ensureDb() {
  await initDB();
  return db;
}

async function doInitDB(): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    // Register the jeep-sqlite web component before initWebStore() waits on it.
    await setupWebSqlite();
    await CapacitorSQLite.initWebStore();
  }
  db = await sqlite.createConnection('albums_db', false, 'no-encryption', 1, false);
  await db.open();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS albums (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      artist      TEXT NOT NULL,
      year        INTEGER DEFAULT 0,
      genre       TEXT DEFAULT '',
      image_url   TEXT DEFAULT '',
      image_path  TEXT DEFAULT '',
      added_at    TEXT DEFAULT '',
      album_type  TEXT DEFAULT '',
      popularity  INTEGER,
      spotify_url TEXT DEFAULT ''
    )
  `);
  // Additive columns for DBs created before the rich extras existed.
  {
    const info = await db.query('PRAGMA table_info(albums)');
    const cols = new Set<string>(
      ((info.values ?? []) as { name: string }[]).map((c) => c.name)
    );
    const extras: [string, string][] = [
      ['album_type',  "TEXT DEFAULT ''"],
      ['popularity',  'INTEGER'],
      ['spotify_url', "TEXT DEFAULT ''"],
    ];
    for (const [name, ddl] of extras) {
      if (!cols.has(name)) await db.execute(`ALTER TABLE albums ADD COLUMN ${name} ${ddl}`);
    }
  }
  await db.execute(`
    CREATE TABLE IF NOT EXISTS playlists (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      image_url   TEXT DEFAULT '',
      track_count INTEGER DEFAULT 0,
      album_count INTEGER DEFAULT 0,
      synced_at   TEXT DEFAULT ''
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS playlist_albums (
      playlist_id  TEXT NOT NULL,
      album_id     TEXT NOT NULL,
      title        TEXT NOT NULL,
      artist       TEXT NOT NULL,
      year         INTEGER DEFAULT 0,
      genre        TEXT DEFAULT '',
      image_url    TEXT DEFAULT '',
      track_count  INTEGER DEFAULT 1,
      track_titles TEXT DEFAULT '[]',
      PRIMARY KEY (playlist_id, album_id)
    )
  `);
}

export async function upsertAlbum(album: Album): Promise<void> {
  await db.run(
    `INSERT OR REPLACE INTO albums
       (id, title, artist, year, genre, image_url, image_path, added_at,
        album_type, popularity, spotify_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [album.id, album.title, album.artist, album.year,
     album.genre, album.image_url, album.image_path, album.added_at,
     album.album_type ?? '',
     typeof album.popularity === 'number' ? album.popularity : null,
     album.spotify_url ?? '']
  );
}

// Batch insert/replace — keeps the sync from doing one SQLite round-trip per
// album. Mirrors the Kotlin `upsertAlbums` path.
export async function upsertAlbums(albums: Album[]): Promise<void> {
  if (!albums.length) return;
  await ensureDb();
  const chunkSize = 100;
  for (let offset = 0; offset < albums.length; offset += chunkSize) {
    const chunk = albums.slice(offset, offset + chunkSize);
    const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const album of chunk) {
      params.push(
        album.id,
        album.title,
        album.artist,
        album.year,
        album.genre,
        album.image_url,
        album.image_path,
        album.added_at,
        album.album_type ?? '',
        typeof album.popularity === 'number' ? album.popularity : null,
        album.spotify_url ?? '',
      );
    }
    await db.run(
      `INSERT OR REPLACE INTO albums (id, title, artist, year, genre, image_url, image_path, added_at, album_type, popularity, spotify_url) VALUES ${values}`,
      params,
    );
  }
}

// ---------------------------------------------------------------------------
// Shared WHERE builder
// ---------------------------------------------------------------------------

function buildWhere(
  search: string, genre: string, yearFrom: string, yearTo: string, artist: string,
  albumType = '', minPop = 0, maxPop = 100,
): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params:     unknown[] = [];

  if (search) {
    conditions.push('(LOWER(title) LIKE ? OR LOWER(artist) LIKE ?)');
    const q = '%' + search.toLowerCase() + '%';
    params.push(q, q);
  }
  if (genre)     { conditions.push('LOWER(genre)  = LOWER(?)'); params.push(genre);  }
  if (artist)    { conditions.push('LOWER(artist) = LOWER(?)'); params.push(artist); }
  if (yearFrom)  { conditions.push('year >= ?'); params.push(parseInt(yearFrom, 10)); }
  if (yearTo)    { conditions.push('year <= ?'); params.push(parseInt(yearTo,   10)); }
  // Rich-extras filters (V6) — same semantics as the server: rows without a
  // popularity value only match the untouched 0–100 window.
  if (albumType) { conditions.push('LOWER(album_type) = LOWER(?)'); params.push(albumType); }
  if (minPop > 0)   { conditions.push('popularity IS NOT NULL AND popularity >= ?'); params.push(minPop); }
  if (maxPop < 100) { conditions.push('popularity IS NOT NULL AND popularity <= ?'); params.push(maxPop); }

  return {
    where:  conditions.length ? 'WHERE ' + conditions.join(' AND ') : '',
    params,
  };
}

// ---------------------------------------------------------------------------
// Paginated query
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 48;

export async function getAllAlbums(
  search     = '',
  genre      = '',
  sortField  = 'artist',
  sortOrder  = 'asc',
  yearFrom   = '',
  yearTo     = '',
  artist     = '',
  limit      = PAGE_SIZE,
  offset     = 0,
  albumType  = '',
  minPop     = 0,
  maxPop     = 100,
): Promise<Album[]> {
  const { where, params } = buildWhere(search, genre, yearFrom, yearTo, artist, albumType, minPop, maxPop);
  const allowed = new Set(['title', 'artist', 'year', 'genre', 'added_at', 'popularity']);
  const col     = allowed.has(sortField) ? sortField : 'artist';
  const dir     = sortOrder === 'desc' ? 'DESC' : 'ASC';
  // Numeric columns must compare numerically, and missing popularity sorts last.
  const orderBy =
    col === 'popularity' ? `popularity IS NULL, popularity ${dir}`
    : col === 'year'     ? `year ${dir}`
    : `LOWER(${col}) ${dir}`;

  const result = await db.query(
    `SELECT * FROM albums ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return (result.values ?? []) as Album[];
}

// Everything in the local DB, for the Settings → Backup "Export now" action.
export async function getExportAlbums(): Promise<Album[]> {
  const result = await db.query("SELECT * FROM albums ORDER BY LOWER(artist), LOWER(title)");
  return (result.values ?? []) as Album[];
}

// Total count for the same filter — used for hasMore / result display
export async function countAlbums(
  search    = '',
  genre     = '',
  yearFrom  = '',
  yearTo    = '',
  artist    = '',
  albumType = '',
  minPop    = 0,
  maxPop    = 100,
): Promise<number> {
  const { where, params } = buildWhere(search, genre, yearFrom, yearTo, artist, albumType, minPop, maxPop);
  const result = await db.query(
    `SELECT COUNT(*) AS n FROM albums ${where}`, params
  );
  return ((result.values ?? [{}]) as { n: number }[])[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

export async function getDistinctGenres(): Promise<string[]> {
  const result = await db.query(
    "SELECT DISTINCT genre FROM albums WHERE genre != '' ORDER BY genre"
  );
  return ((result.values ?? []) as { genre: string }[]).map((r) => r.genre);
}

export async function getDistinctArtists(): Promise<string[]> {
  const result = await db.query(
    "SELECT DISTINCT artist FROM albums WHERE artist != '' ORDER BY LOWER(artist)"
  );
  return ((result.values ?? []) as { artist: string }[]).map((r) => r.artist);
}

export async function getDistinctYears(): Promise<number[]> {
  const result = await db.query(
    'SELECT DISTINCT year FROM albums WHERE year > 0 ORDER BY year DESC'
  );
  return ((result.values ?? []) as { year: number }[]).map((r) => r.year);
}

// ---------------------------------------------------------------------------
// Stats & utils
// ---------------------------------------------------------------------------

type StatsRow = {
  totalAlbums: number; totalArtists: number;
  totalGenres: number; newestYear:   number; oldestYear: number;
};

export async function getStats(): Promise<LibraryStats> {
  const result = await db.query(`
    SELECT COUNT(*)               AS totalAlbums,
           COUNT(DISTINCT artist) AS totalArtists,
           COUNT(DISTINCT genre)  AS totalGenres,
           MAX(year)              AS newestYear,
           MIN(CASE WHEN year > 0 THEN year END) AS oldestYear
    FROM albums
  `);
  const row = ((result.values ?? [{}]) as StatsRow[])[0] ?? ({} as StatsRow);

  // Breakdown extras (same shapes the python/elixir backends serve).
  const [g, a, y] = await Promise.all([
    db.query(`SELECT genre AS name, COUNT(*) AS count FROM albums
              WHERE genre != '' GROUP BY genre ORDER BY count DESC, name LIMIT 8`),
    db.query(`SELECT artist AS name, COUNT(*) AS count FROM albums
              WHERE artist != '' GROUP BY artist ORDER BY count DESC, name LIMIT 8`),
    db.query(`SELECT year, COUNT(*) AS count FROM albums
              WHERE year > 0 GROUP BY year ORDER BY year`),
  ]);

  return {
    totalAlbums:  row.totalAlbums  ?? 0,
    totalArtists: row.totalArtists ?? 0,
    totalGenres:  row.totalGenres  ?? 0,
    newestYear:   row.newestYear   ?? 0,
    oldestYear:   row.oldestYear   ?? 0,
    topGenres:    (g.values ?? []) as LibraryStats['topGenres'],
    topArtists:   (a.values ?? []) as LibraryStats['topArtists'],
    albumsByYear: (y.values ?? []) as LibraryStats['albumsByYear'],
  };
}

export async function getExistingAlbumIds(): Promise<Set<string>> {
  const result = await db.query('SELECT id FROM albums');
  return new Set<string>(((result.values ?? []) as { id: string }[]).map((r) => r.id));
}

export async function clearLibrary(): Promise<void> {
  await db.execute('DELETE FROM albums');
}

export async function deleteAlbums(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await ensureDb();
  for (const id of ids) {
    await db.run('DELETE FROM albums WHERE id = ?', [id]);
  }
  await saveToStore();
}

export async function saveToStore(): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    await CapacitorSQLite.saveToStore({ database: 'albums_db' });
  }
}
