export interface Album {
  id:         string;
  title:      string;
  artist:     string;
  year:       number;
  genre:      string;
  image_url:  string;
  image_path: string;
  added_at?:  string;
  /** Rich extras — optional: older rows and CSV imports may not carry them. */
  album_type?:  string;
  popularity?:  number | null;
  spotify_url?: string;
}

/** Anything selectable/queueable by Spotify album id. */
export interface Queueable {
  id: string;
}

export interface StatsEntry {
  name:  string;
  count: number;
}

export interface YearEntry {
  year:  number;
  count: number;
}

export interface LibraryStats {
  totalAlbums:  number;
  totalArtists: number;
  totalGenres:  number;
  newestYear:   number;
  oldestYear:   number;
  /** Optional breakdown — served by some backends; computed locally in SQLite. */
  topGenres?:    StatsEntry[];
  topArtists?:   StatsEntry[];
  albumsByYear?: YearEntry[];
}

export type SortField = 'title' | 'artist' | 'year' | 'genre' | 'added_at' | 'popularity';
export type SortOrder = 'asc' | 'desc';
export type ViewMode  = 'grid' | 'list' | 'compact';

export interface FilterState {
  search:    string;
  genre:     string;
  artist:    string;
  yearFrom:  number | '';
  yearTo:    number | '';
  sortField: SortField;
  sortOrder: SortOrder;
  /** Extras — '' = any album type; 0/100 are the open popularity window. */
  albumType: string;
  minPop:    number;
  maxPop:    number;
}

export interface CSVRow {
  id:          string;
  album_title: string;
  artist:      string;
  year:        string;
  genre:       string;
  image_url:   string;
}
