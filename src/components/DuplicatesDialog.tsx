import React, { useEffect, useMemo, useState } from 'react';
import type { DuplicateGroup, DuplicateAlbum } from '../utils/duplicateFinder';

export type DuplicateDecision = {
  groupId: string;
  keepId: string;
  removeIds: string[];
};

export interface DuplicatesDialogProps {
  open: boolean;
  groups: DuplicateGroup[];
  hiddenCount: number;
  loading: boolean;
  isRemote: boolean;
  onDismiss: () => void;
  onRemove: (albumIds: string[]) => void;
  onRemovePermanent?: (albumIds: string[]) => void;
  onRestore: () => void;
}

export const DuplicatesDialog: React.FC<DuplicatesDialogProps> = ({
  open,
  groups,
  hiddenCount,
  loading,
  isRemote,
  onDismiss,
  onRemove,
  onRemovePermanent,
  onRestore,
}) => {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const group of groups) {
      // Kotlin's default: keep the oldest copy, mark newer copies for removal.
      group.albums.forEach((album, index) => {
        next[album.id] = index !== 0;
      });
    }
    setSelected(next);
  }, [open, groups]);

  const groupKeep = useMemo(
    () =>
      Object.fromEntries(
        groups.map((group) => {
          const keep = group.albums.find((album) => !selected[album.id]) ?? group.albums[0];
          return [group.key, keep.id];
        }),
      ),
    [groups, selected],
  );

  const removeIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id]),
    [selected],
  );

  const canRemove = !loading
    && !saving
    && groups.every((group) => group.albums.some((album) => !selected[album.id]))
    && removeIds.length > 0;

  const handleRemove = async () => {
    if (!canRemove) return;
    setSaving(true);
    try {
      onRemove(removeIds);
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePermanent = async () => {
    if (!canRemove) return;
    setSaving(true);
    try {
      onRemovePermanent?.(removeIds);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onDismiss}>
      <div
        className="duplicates-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicates-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="duplicates-header">
          <div>
            <h3 id="duplicates-title">Duplicate albums</h3>
            <p className="queue-help">
              Local review only. Removing hides matching albums locally and blocks future
              re-import of those Spotify IDs. Spotify is not modified.
            </p>
          </div>
          <button type="button" className="link-btn" onClick={onDismiss} aria-label="Close duplicates review">
            close
          </button>
        </div>

        {isRemote && (
          <div className="sync-error" role="alert">
            Remote mode: this is a local-review action. Server-side duplicate hiding is not implemented yet.
          </div>
        )}

        {loading ? (
          <div className="player-loading">
            <span className="spinner" aria-hidden="true" />
            <span>Scanning for duplicate releases…</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="player-empty">
            <p>No probable duplicates found.</p>
          </div>
        ) : (
          <div className="duplicates-groups">
            {groups.map((group) => (
              <section className="duplicates-group" key={group.key}>
                <div className="duplicates-group-head">
                  <h4>{group.title}</h4>
                  <span>{group.artist}</span>
                </div>
                <div className="duplicates-albums">
                  {group.albums.map((album) => {
                    const checked = selected[album.id] === true;
                    const keeping = !checked;
                    return (
                      <label key={album.id} className={'duplicates-row' + (keeping ? ' duplicates-row--keep' : '')}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelected((prev) => {
                              const hasOtherKeeper = group.albums.some(
                                (other) => other.id !== album.id && prev[other.id] === false,
                              );
                              if (hasOtherKeeper === false && prev[album.id] === false) {
                                return prev; // never remove the last copy
                              }
                              return { ...prev, [album.id]: !prev[album.id] };
                            });
                          }}
                        />
                        <span className="duplicates-row-year">{album.year > 0 ? album.year : '–'}</span>
                        <span className="duplicates-row-title">{album.title}</span>
                        {album.id === groupKeep[group.key] ? <em>keep</em> : null}
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="duplicates-actions">
          <button type="button" className="queue-btn" onClick={onRestore} disabled={hiddenCount === 0 || loading}>
            Restore{hiddenCount ? ` ${hiddenCount}` : ''}
          </button>
          <button
            type="button"
            className="queue-btn queue-btn--primary"
            onClick={() => void handleRemove()}
            disabled={!canRemove}
          >
            {saving ? 'Saving…' : `Remove ${removeIds.length || ''}`.trim()}
          </button>

          {onRemovePermanent && (
            <button
              type="button"
              className="queue-btn queue-btn--danger"
              onClick={() => void handleRemovePermanent()}
              disabled={!canRemove}
              title="Delete the selected duplicates permanently without keeping them restorable"
            >
              {saving ? 'Saving…' : 'Remove from Spotify permanently'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
