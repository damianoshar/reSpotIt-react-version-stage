import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Artwork } from './Artwork';
import {
  fetchArtistDiscography,
  searchSpotifyCatalog,
  type CatalogAlbum,
  type SpotifyArtistSummary,
  type SpotifyCatalogSearch,
} from '../services/SpotifyCatalogService';
import {
  catalogGroupLabel,
  catalogGroupOf,
  catalogReleaseLabel,
  type CatalogGroup,
} from '../utils/catalog';
import {
  findCatalogDuplicates,
  type CatalogDuplicateGroup,
} from '../utils/catalogDuplicates';
import { createPlaylistFromAlbums } from '../services/SpotifyPlaylistService';
import { saveAlbums } from '../services/SpotifyApiService';
import { createAndAddRemotePlaylist } from '../services/remote/playlistRemote';
import type { Album } from '../types';
import type { SyncResult } from '../services/SyncService';

type DialogView = 'search' | 'artist' | 'review' | 'done';
type SubmitMode = 'playlist' | 'library';

interface ReviewState {
  mode: SubmitMode;
  albums: CatalogAlbum[];
  duplicates: CatalogDuplicateGroup<CatalogAlbum>[];
  existingIds: Set<string>;
}

interface ProgressState {
  done: number;
  total: number;
  title: string;
}

export interface ArtistDiscographyDialogProps {
  open: boolean;
  onClose: () => void;
  onToast: (message: string, ok?: boolean) => void;
  isRemote: boolean;
  serverUrl: string;
  canAddToLibrary: boolean;
  getLibraryAlbumIds?: () => Promise<Set<string>>;
  importAlbumsToLibrary?: (albums: Album[]) => Promise<SyncResult>;
  onPlaylistsChanged?: () => void;
}

const GROUPS: CatalogGroup[] = ['album', 'single', 'appears_on'];

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: string } | null)?.message ?? '';
  if (message === 'Not authenticated') {
    return 'Spotify is not connected on this device. Connect Spotify in local mode first.';
  }
  return message || fallback;
}

function tracksLabel(count: number): string {
  return `${count} track${count === 1 ? '' : 's'}`;
}

function albumsLabel(count: number): string {
  return `${count} album${count === 1 ? '' : 's'}`;
}

export const ArtistDiscographyDialog: React.FC<ArtistDiscographyDialogProps> = ({
  open,
  onClose,
  onToast,
  isRemote,
  serverUrl,
  canAddToLibrary,
  getLibraryAlbumIds,
  importAlbumsToLibrary,
  onPlaylistsChanged,
}) => {
  const [view, setView] = useState<DialogView>('search');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<SpotifyCatalogSearch | null>(null);

  const [artist, setArtist] = useState<SpotifyArtistSummary | null>(null);
  const [discography, setDiscography] = useState<CatalogAlbum[]>([]);
  const [discographyLoading, setDiscographyLoading] = useState(false);
  const [discographyError, setDiscographyError] = useState('');
  const [groups, setGroups] = useState<Set<CatalogGroup>>(new Set(GROUPS));

  const [selected, setSelected] = useState<Record<string, CatalogAlbum>>({});
  const [playlistName, setPlaylistName] = useState('');
  const [review, setReview] = useState<ReviewState | null>(null);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [doneMessage, setDoneMessage] = useState('');
  const [progress, setProgress] = useState<ProgressState | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);
  const artistRequestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setView('search');
    setQuery('');
    setSearching(false);
    setSearchError('');
    setResults(null);
    setArtist(null);
    setDiscography([]);
    setDiscographyLoading(false);
    setDiscographyError('');
    setGroups(new Set(GROUPS));
    setSelected({});
    setPlaylistName('');
    setReview(null);
    setIncluded({});
    setBusy(false);
    setActionError('');
    setDoneMessage('');
    setProgress(null);
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => () => {
    searchRequestRef.current += 1;
    artistRequestRef.current += 1;
  }, []);

  const selectedAlbums = useMemo(() => Object.values(selected), [selected]);
  const selectedCount = selectedAlbums.length;

  const visibleAlbums = useMemo(() => {
    const filtered = discography.filter((album) => groups.has(catalogGroupOf(album)));
    return [...filtered].sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    });
  }, [discography, groups]);

  const groupCounts = useMemo(() => {
    const counts: Record<CatalogGroup, number> = { album: 0, single: 0, appears_on: 0 };
    for (const album of discography) counts[catalogGroupOf(album)] += 1;
    return counts;
  }, [discography]);

  const includedAlbums = useMemo(
    () => (review ? review.albums.filter((album) => included[album.id] !== false) : []),
    [review, included],
  );

  const existingInSelection = useMemo(
    () => (review ? review.albums.filter((album) => review.existingIds.has(album.id)) : []),
    [review],
  );

  const runSearch = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setSearchError('Type at least 2 characters.');
      return;
    }

    const requestId = ++searchRequestRef.current;
    setSearching(true);
    setSearchError('');
    setResults(null);
    try {
      const found = await searchSpotifyCatalog(q);
      if (requestId !== searchRequestRef.current) return;
      setResults(found);
    } catch (error) {
      if (requestId !== searchRequestRef.current) return;
      setSearchError(errorMessage(error, 'Spotify search failed.'));
    } finally {
      if (requestId === searchRequestRef.current) setSearching(false);
    }
  };

  const openArtist = async (nextArtist: SpotifyArtistSummary) => {
    const requestId = ++artistRequestRef.current;
    setArtist(nextArtist);
    setView('artist');
    setDiscography([]);
    setDiscographyError('');
    setDiscographyLoading(true);
    setGroups(new Set(GROUPS));
    setPlaylistName((current) => (current.trim() ? current : `${nextArtist.name} playlist`));

    try {
      const albums = await fetchArtistDiscography(nextArtist.id);
      if (requestId !== artistRequestRef.current) return;
      setDiscography(albums);
    } catch (error) {
      if (requestId !== artistRequestRef.current) return;
      setDiscographyError(errorMessage(error, 'Could not load the artist discography.'));
    } finally {
      if (requestId === artistRequestRef.current) setDiscographyLoading(false);
    }
  };

  const toggleAlbum = (album: CatalogAlbum) => {
    const wasSelected = !!selected[album.id];
    setSelected((previous) => {
      const next = { ...previous };
      if (next[album.id]) delete next[album.id];
      else next[album.id] = album;
      return next;
    });

    if (!wasSelected) {
      setPlaylistName((current) => {
        if (current.trim()) return current;
        if (artist?.name) return `${artist.name} playlist`;
        if (query.trim()) return `${query.trim()} playlist`;
        return 'Spotify playlist';
      });
    }
  };

  const toggleGroup = (group: CatalogGroup) => {
    const isOn = groups.has(group);
    const next = new Set(groups);
    if (isOn) next.delete(group);
    else next.add(group);
    if (next.size === 0) return;

    setGroups(next);
    if (isOn) {
      setSelected((previous) => {
        const nextSelected = { ...previous };
        for (const album of discography) {
          if (catalogGroupOf(album) === group) delete nextSelected[album.id];
        }
        return nextSelected;
      });
    }
  };

  const selectVisible = () => {
    setSelected((previous) => {
      const next = { ...previous };
      for (const album of visibleAlbums) next[album.id] = album;
      return next;
    });
    if (!playlistName.trim()) {
      const fallback = artist?.name ? `${artist.name} playlist`
        : query.trim() ? `${query.trim()} playlist`
        : 'Spotify playlist';
      setPlaylistName(fallback);
    }
  };

  const clearVisible = () => {
    setSelected((previous) => {
      const next = { ...previous };
      for (const album of visibleAlbums) delete next[album.id];
      return next;
    });
  };

  const startReview = async (mode: SubmitMode) => {
    const albums = Object.values(selected);
    if (!albums.length) {
      setActionError('Select at least one album first.');
      return;
    }
    if (mode === 'playlist' && !playlistName.trim()) {
      setActionError('Enter a playlist name.');
      return;
    }
    if (mode === 'library' && !importAlbumsToLibrary) {
      setActionError('Saving albums to Spotify is not available.');
      return;
    }

    setBusy(true);
    setActionError('');
    try {
      const existingIds = getLibraryAlbumIds ? await getLibraryAlbumIds() : new Set<string>();
      const duplicates = findCatalogDuplicates(albums);
      const initialIncluded: Record<string, boolean> = {};

      for (const album of albums) initialIncluded[album.id] = true;

      // Default to one copy per duplicate group (the oldest, because the
      // duplicate finder sorts oldest first).
      for (const group of duplicates) {
        group.albums.forEach((album, index) => {
          if (index > 0) initialIncluded[album.id] = false;
        });
      }

      // When importing, albums already in the library are skipped by default.
      // For playlist creation they stay selected; an album can legitimately
      // be both in the library and in a playlist.
      if (mode === 'library') {
        for (const album of albums) {
          if (existingIds.has(album.id)) initialIncluded[album.id] = false;
        }
      }

      setReview({ mode, albums, duplicates, existingIds });
      setIncluded(initialIncluded);
      setView('review');
    } catch (error) {
      setActionError(errorMessage(error, 'Could not check the library for duplicates.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleIncluded = (albumId: string) => {
    setIncluded((previous) => ({
      ...previous,
      [albumId]: previous[albumId] === false,
    }));
  };

  const confirmReview = async () => {
    if (!review || !includedAlbums.length) return;

    setBusy(true);
    setActionError('');
    setProgress(null);
    try {
      if (review.mode === 'playlist') {
        const name = playlistName.trim();
        let toastMessage = 'Playlist created.';
        let toastOk = true;

        if (isRemote) {
          const created = await createAndAddRemotePlaylist(
            serverUrl,
            name,
            includedAlbums.map((album) => album.id),
          );
          setDoneMessage(
            `Created “${created.name}” with ${tracksLabel(created.tracksAdded)} from ` +
            `${albumsLabel(includedAlbums.length)}.`,
          );
        } else {
          const { playlist, tracksAdded, errors } = await createPlaylistFromAlbums(
            name,
            includedAlbums,
            (done, total, album) => setProgress({ done, total, title: album.title }),
          );
          setDoneMessage(
            `Created “${playlist.name}” with ${tracksLabel(tracksAdded)} from ` +
            `${albumsLabel(includedAlbums.length)}.` +
            (errors.length ? ` ${albumsLabel(errors.length)} could not be added.` : ''),
          );
          if (errors.length) {
            toastMessage = `Playlist created; ${albumsLabel(errors.length)} could not be added.`;
            toastOk = false;
          }
        }
        onPlaylistsChanged?.();
        onToast(toastMessage, toastOk);
      } else {
        if (!importAlbumsToLibrary) throw new Error('Saving albums to Spotify is not available.');
        await saveAlbums(includedAlbums.map((album) => album.id));
        let result: SyncResult;
        try {
          result = await importAlbumsToLibrary(includedAlbums);
        } catch (error) {
          throw new Error(
            `Saved to Spotify, but importing into the local library failed. ` +
            errorMessage(error, 'Refresh the library and try again.'),
          );
        }
        setDoneMessage(
          `Saved ${albumsLabel(includedAlbums.length)} to your Spotify library. ` +
          `Imported ${result.imported} locally; ${result.existing} already existed, ${result.skipped} skipped.`,
        );
        onToast(`Saved ${albumsLabel(includedAlbums.length)} to Spotify.`, true);
      }

      setReview(null);
      setView('done');
    } catch (error) {
      setActionError(errorMessage(
        error,
        review.mode === 'playlist'
          ? 'Could not create the playlist.'
          : 'Could not add the albums to your library.',
      ));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const goBackFromReview = () => {
    setReview(null);
    setIncluded({});
    setActionError('');
    setView(artist ? 'artist' : 'search');
  };

  const backToSearch = () => {
    setArtist(null);
    setDiscography([]);
    setDiscographyError('');
    setActionError('');
    setView('search');
    window.setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const startAnother = () => {
    setView('search');
    setQuery('');
    setSearching(false);
    setSearchError('');
    setResults(null);
    setArtist(null);
    setDiscography([]);
    setDiscographyLoading(false);
    setDiscographyError('');
    setGroups(new Set(GROUPS));
    setSelected({});
    setPlaylistName('');
    setReview(null);
    setIncluded({});
    setBusy(false);
    setActionError('');
    setDoneMessage('');
    setProgress(null);
    window.setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  if (!open) return null;

  const dialogTitle =
    view === 'review' ? 'Review before submitting'
    : view === 'done' ? 'Done'
    : view === 'artist' && artist ? artist.name
    : 'Artist discography & playlist';

  const dialogSubtitle =
    view === 'search'
      ? 'Search Spotify for an artist or album. Pick releases, review duplicates, then create a private playlist or save albums to Spotify.'
      : view === 'artist'
        ? 'Choose Albums, Singles or Appears On. Duplicate versions are checked before anything is submitted.'
        : view === 'review'
          ? (review?.mode === 'playlist'
            ? 'Confirm the albums before the private playlist is created.'
            : 'Confirm the albums before they are saved to Spotify and imported into your local library.')
          : 'Your changes are complete.';

  const renderAlbumRow = (album: CatalogAlbum) => {
    const checked = !!selected[album.id];
    const group = catalogGroupOf(album);
    return (
      <button
        key={album.id}
        type="button"
        className={'discography-album-row' + (checked ? ' discography-album-row--selected' : '')}
        onClick={() => toggleAlbum(album)}
        aria-pressed={checked}
      >
        <span className={'discography-check' + (checked ? ' discography-check--on' : '')} aria-hidden="true">
          {checked ? '✓' : ''}
        </span>
        {album.image_url ? (
          <Artwork src={album.image_url} alt="" className="discography-album-art" loading="lazy" />
        ) : (
          <span className="discography-album-art discography-album-art--empty" aria-hidden="true">♪</span>
        )}
        <span className="discography-album-info">
          <span className="discography-album-title">{album.title}</span>
          <span className="discography-album-meta">
            {album.artist}
            {album.year > 0 ? ' · ' + album.year : ''}
            {album.total_tracks ? ' · ' + album.total_tracks + ' tracks' : ''}
          </span>
        </span>
        <span className={'discography-album-badge discography-album-badge--' + group}>
          {catalogReleaseLabel(album)}
        </span>
      </button>
    );
  };

  const renderReviewRow = (album: CatalogAlbum) => {
    const checked = included[album.id] !== false;
    const inLibrary = !!review?.existingIds.has(album.id);
    return (
      <label className="duplicates-row discography-review-row" key={album.id}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleIncluded(album.id)}
        />
        <span className="duplicates-row-year">{album.year > 0 ? album.year : '–'}</span>
        <span className="duplicates-row-title">{album.title}</span>
        <span className="discography-review-artist">{album.artist}</span>
        {inLibrary && <span className="discography-review-library">in library</span>}
        <span className={'discography-album-badge discography-album-badge--' + catalogGroupOf(album)}>
          {catalogReleaseLabel(album)}
        </span>
      </label>
    );
  };

  const renderSearch = () => (
    <>
      <form className="discography-search" onSubmit={runSearch}>
        <input
          ref={searchInputRef}
          className="form-input"
          type="search"
          placeholder="Search Spotify artists or albums…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (searchError) setSearchError('');
          }}
          disabled={searching}
          aria-label="Search Spotify artists or albums"
        />
        <button
          type="submit"
          className="sync-btn"
          disabled={searching || query.trim().length < 2}
        >
          {searching ? <><span className="spinner" aria-hidden="true" /> Searching…</> : 'Search'}
        </button>
      </form>

      {!results && !searching && (
        <p className="discography-hint">
          Search for an artist to browse their discography, or select album matches directly.
        </p>
      )}

      {searchError && <div className="sync-error" role="alert">⚠ {searchError}</div>}

      {searching && (
        <div className="player-loading">
          <span className="spinner" aria-hidden="true" />
          <span>Searching Spotify…</span>
        </div>
      )}

      {results && (
        <>
          {results.artists.length > 0 && (
            <section>
              <h4 className="discography-section-title">Artists</h4>
              <div className="discography-artists">
                {results.artists.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className="discography-artist"
                    onClick={() => void openArtist(result)}
                  >
                    {result.image_url ? (
                      <Artwork src={result.image_url} alt="" className="discography-artist-img" loading="lazy" />
                    ) : (
                      <span className="discography-artist-img discography-artist-img--empty" aria-hidden="true">♪</span>
                    )}
                    <span className="discography-artist-info">
                      <span className="discography-artist-name">{result.name}</span>
                      <span className="discography-artist-meta">
                        {result.genres.slice(0, 2).join(' · ') ||
                          (result.followers > 0 ? `${result.followers.toLocaleString()} followers` : 'Artist')}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {results.albums.length > 0 && (
            <section>
              <h4 className="discography-section-title">Album matches</h4>
              <div className="discography-list">
                {results.albums.map(renderAlbumRow)}
              </div>
            </section>
          )}

          {results.artists.length === 0 && results.albums.length === 0 && (
            <p className="discography-hint">No matches found.</p>
          )}
        </>
      )}
    </>
  );

  const renderArtist = () => {
    if (!artist) return null;
    return (
      <>
        <div className="discography-artist-header">
          {artist.image_url ? (
            <Artwork src={artist.image_url} alt="" className="discography-artist-img discography-artist-img--large" />
          ) : (
            <span className="discography-artist-img discography-artist-img--large discography-artist-img--empty" aria-hidden="true">♪</span>
          )}
          <div className="discography-artist-header-info">
            <h4>{artist.name}</h4>
            <p className="discography-hint">
              {artist.genres.slice(0, 3).join(' · ') ||
                (artist.followers > 0 ? `${artist.followers.toLocaleString()} followers` : 'Spotify artist')}
            </p>
          </div>
          <button type="button" className="link-btn" onClick={backToSearch}>
            back to search
          </button>
        </div>

        <div className="discography-chips" role="group" aria-label="Release type filters">
          {GROUPS.map((group) => (
            <button
              key={group}
              type="button"
              className={'discography-chip' + (groups.has(group) ? ' active' : '')}
              aria-pressed={groups.has(group)}
              onClick={() => toggleGroup(group)}
            >
              {catalogGroupLabel(group)}
              <span className="discography-chip-count">{groupCounts[group]}</span>
            </button>
          ))}
        </div>

        {discographyLoading ? (
          <div className="player-loading">
            <span className="spinner" aria-hidden="true" />
            <span>Loading {artist.name}&apos;s discography…</span>
          </div>
        ) : discographyError ? (
          <>
            <div className="sync-error" role="alert">⚠ {discographyError}</div>
            <button type="button" className="sync-btn" onClick={() => void openArtist(artist)}>
              Try again
            </button>
          </>
        ) : (
          <>
            <div className="discography-toolbar">
              <span className="discography-hint">
                {visibleAlbums.length} release{visibleAlbums.length === 1 ? '' : 's'} shown
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={selectVisible}
                disabled={visibleAlbums.length === 0}
              >
                Select all shown
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={clearVisible}
                disabled={visibleAlbums.length === 0}
              >
                Clear shown
              </button>
            </div>

            {visibleAlbums.length === 0 ? (
              <p className="discography-hint">No releases in the selected groups.</p>
            ) : (
              <div className="discography-list">
                {visibleAlbums.map(renderAlbumRow)}
              </div>
            )}
          </>
        )}
      </>
    );
  };

  const renderReview = () => {
    if (!review) return null;
    const duplicateIds = new Set(
      review.duplicates.flatMap((group) => group.albums.map((album) => album.id)),
    );
    const existingNotDuplicate = review.albums.filter(
      (album) => review.existingIds.has(album.id) && !duplicateIds.has(album.id),
    );

    return (
      <>
        {review.duplicates.length === 0 && existingNotDuplicate.length === 0 && (
          <p className="discography-review-note">No duplicate versions found.</p>
        )}

        {review.duplicates.length > 0 && (
          <section>
            <h4 className="discography-section-title">Duplicate versions</h4>
            <p className="discography-review-note">
              {review.mode === 'library'
                ? 'The oldest copy is selected by default. Albums already in your library are skipped; tick one to include it anyway.'
                : 'The oldest copy is selected by default. Untick any copy you do not want to submit.'}
            </p>
            {review.duplicates.map((group) => (
              <div className="discography-review-group" key={group.key}>
                <div className="discography-review-head">
                  <strong>{group.title}</strong>
                  <span>{group.artist}</span>
                </div>
                {group.albums.map(renderReviewRow)}
              </div>
            ))}
          </section>
        )}

        {review.mode === 'library' && existingNotDuplicate.length > 0 && (
          <section>
            <h4 className="discography-section-title">Already in your library</h4>
            <p className="discography-review-note">
              These are skipped by default. Tick one to include it anyway.
            </p>
            <div className="discography-review-group">
              {existingNotDuplicate.map(renderReviewRow)}
            </div>
          </section>
        )}

        {review.mode === 'playlist' && existingInSelection.length > 0 && (
          <p className="discography-review-note">
            {existingInSelection.length} selected album{existingInSelection.length === 1 ? ' is' : 's are'} already in your library.
            They can still be added to the playlist.
          </p>
        )}
      </>
    );
  };

  const renderDone = () => (
    <div className="discography-done">
      <div className="discography-done-icon" aria-hidden="true">✓</div>
      <p>{doneMessage}</p>
      <div className="discography-footer-actions">
        <button type="button" className="sync-btn" onClick={onClose}>
          Close
        </button>
        <button type="button" className="sync-btn sync-btn--ghost" onClick={startAnother}>
          Create another
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="duplicates-dialog discography-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discography-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="duplicates-header discography-header">
          <div>
            <h3 id="discography-title">{dialogTitle}</h3>
            <p className="queue-help">{dialogSubtitle}</p>
          </div>
          <button
            type="button"
            className="link-btn"
            onClick={onClose}
            disabled={busy}
            aria-label="Close artist discography"
          >
            close
          </button>
        </div>

        <div className="discography-body">
          {actionError && <div className="sync-error" role="alert">⚠ {actionError}</div>}
          {view === 'search' && renderSearch()}
          {view === 'artist' && renderArtist()}
          {view === 'review' && renderReview()}
          {view === 'done' && renderDone()}
        </div>

        {view !== 'review' && view !== 'done' && selectedCount > 0 && (
          <div className="discography-footer">
            <div className="discography-footer-row">
              <input
                className="form-input"
                type="text"
                placeholder="Playlist name"
                value={playlistName}
                onChange={(event) => setPlaylistName(event.target.value)}
                disabled={busy}
                aria-label="Playlist name"
              />
              <span className="discography-selected-count">{selectedCount} selected</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => setSelected({})}
                disabled={busy}
              >
                clear
              </button>
            </div>
            <div className="discography-footer-actions">
              <button
                type="button"
                className="sync-btn"
                onClick={() => void startReview('playlist')}
                disabled={busy || selectedCount === 0 || !playlistName.trim()}
              >
                {busy
                  ? <><span className="spinner" aria-hidden="true" /> Checking…</>
                  : 'Create playlist'}
              </button>
              {canAddToLibrary && (
                <button
                  type="button"
                  className="sync-btn sync-btn--ghost"
                  onClick={() => void startReview('library')}
                  disabled={busy || selectedCount === 0}
                >
                  Save to Spotify library
                </button>
              )}
            </div>
            {!canAddToLibrary && (
              <p className="discography-hint">
                Saving to Spotify is available in local mode. In remote mode the playlist is created on the server.
              </p>
            )}
          </div>
        )}

        {view === 'review' && review && (
          <div className="discography-footer">
            <div className="discography-footer-summary">
              <span>
                <strong>{includedAlbums.length}</strong> of {review.albums.length} album{review.albums.length === 1 ? '' : 's'} will be{' '}
                {review.mode === 'playlist' ? 'added to the playlist' : 'saved to Spotify and imported locally'}.
              </span>
              {progress && (
                <span className="discography-progress">
                  {progress.done}/{progress.total} · {progress.title}
                </span>
              )}
            </div>
            <div className="discography-footer-actions">
              <button
                type="button"
                className="sync-btn sync-btn--ghost"
                onClick={goBackFromReview}
                disabled={busy}
              >
                Back
              </button>
              <button
                type="button"
                className="sync-btn"
                onClick={() => void confirmReview()}
                disabled={busy || includedAlbums.length === 0}
              >
                {busy
                  ? <><span className="spinner" aria-hidden="true" /> Working…</>
                  : review.mode === 'playlist'
                    ? `Create playlist (${includedAlbums.length})`
                    : `Save ${includedAlbums.length} to Spotify`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
