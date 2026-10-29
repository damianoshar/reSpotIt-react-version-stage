import React from 'react';

// Accepts any object with an id — works for both Album and PlaylistAlbum
interface Props {
  selectedAlbums: { id: string }[];
  onQueue:        () => void;
  onPlaylist:     () => void;
  onClear:        () => void;
  busy:           boolean;
  onRemove?:      () => void;
  removing?:     boolean;
  /** Local-playlist queue controls (album pages). */
  hasLocalQueue?:      boolean;
  localQueueBusy?:     boolean;
  activeQueueBusy?:    boolean;
  queuePlaylistBusy?:  boolean;
  queueAvailable?:     boolean;
  onLocalQueueCreate?: () => void;
  onLocalQueueAdd?:    () => void;
  onLocalQueueNext?:   () => void;
  onLocalQueueReset?:  () => void;
}

export const SelectionToolbar: React.FC<Props> = ({
  selectedAlbums, onQueue, onPlaylist, onClear, busy, onRemove, removing = false,
  hasLocalQueue = false,
  localQueueBusy = false,
  activeQueueBusy = false,
  queuePlaylistBusy = false,
  queueAvailable = true,
  onLocalQueueCreate,
  onLocalQueueAdd,
  onLocalQueueNext,
  onLocalQueueReset,
}) => {
  const count = selectedAlbums.length;
  if (count === 0) return null;

  const queueBusy = busy || localQueueBusy || activeQueueBusy || queuePlaylistBusy;
  const showQueueRow = queueAvailable && (onLocalQueueCreate || onLocalQueueAdd);

  return (
    <div className={'selection-toolbar' + (showQueueRow ? ' selection-toolbar--with-queue' : '')}
         role="toolbar" aria-label="Selection actions">
      <div className="selection-main-row">
        <span className="selection-count">
          <strong>{count}</strong> album{count !== 1 ? 's' : ''} selected
        </span>

        <div className="selection-actions">
          <button
            className="sel-btn sel-btn--queue"
            onClick={onQueue}
            disabled={busy}
            aria-label="Add to queue"
            title="Add to Spotify queue (requires active device)"
          >
            {busy ? <span className="spinner" aria-hidden="true" /> : (
              <svg viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
                <path d="M3 5h14M3 10h10M3 15h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="16" cy="14" r="3" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M16 12v2l1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            )}
            Queue
          </button>

          <button
            className="sel-btn sel-btn--playlist"
            onClick={onPlaylist}
            disabled={busy}
            aria-label="Add to playlist"
          >
            {busy ? <span className="spinner" aria-hidden="true" /> : (
              <svg viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
                <path d="M3 5h14M3 10h14M3 15h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M14 13v4m-2-2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            )}
            Playlist
          </button>

          {onRemove && (
            <button className="sel-btn sel-btn--danger" onClick={onRemove}
                    disabled={busy || removing} title="Remove selected albums from this library">
              {removing ? 'Removing…' : 'Remove'}
            </button>
          )}
          <button className="sel-btn sel-btn--clear" onClick={onClear} aria-label="Clear selection">
            ✕
          </button>
        </div>
      </div>

      {showQueueRow && (
        <div className="selection-queue-row">
          <span className="selection-queue-label">Local queue</span>
          {onLocalQueueCreate && (
            <button className="sel-btn sel-btn--queue" onClick={onLocalQueueCreate} disabled={queueBusy}
                    title="Create a queue playlist from what is playing now, or replace the current one">
              {localQueueBusy ? <span className="spinner" aria-hidden="true" /> : null}
              {hasLocalQueue ? 'New queue' : 'Create queue'}
            </button>
          )}
          {onLocalQueueAdd && (
            <button className="sel-btn sel-btn--queue" onClick={onLocalQueueAdd}
                    disabled={!hasLocalQueue || queueBusy}
                    title="Append the selected albums to the end of the local queue playlist">
              Add to end
            </button>
          )}
          {onLocalQueueNext && (
            <button className="sel-btn sel-btn--queue" onClick={onLocalQueueNext}
                    disabled={!hasLocalQueue || queueBusy}
                    title="Insert the selected albums immediately after the current local queue track">
              Queue next
            </button>
          )}
          {onLocalQueueReset && (
            <button className="sel-btn sel-btn--queue" onClick={onLocalQueueReset}
                    disabled={!hasLocalQueue || queueBusy}
                    title="Rebuild the local queue from the unplayed remainder of the current one">
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
};
