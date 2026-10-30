import React from 'react';
import { SpotifySyncState } from '../hooks/useLibrary';

const STAGE_LABELS: Record<SpotifySyncState['stage'], string> = {
  albums: 'Fetching albums',
  genres: 'Enriching genres',
  saving: 'Saving to library',
  tracks: 'Resolving tracks',
  queueing: 'Queueing tracks',
  images: 'Downloading images',
};

interface Props {
  sync:     SpotifySyncState;
  onCancel: () => void;
}

export const SyncProgress: React.FC<Props> = ({ sync, onCancel }) => {
  const pct = sync.total > 0 ? Math.round((sync.fetched / sync.total) * 100) : 0;
  return (
    <div className="spotify-progress">
      <div className="sync-progress-top">
        <span className="spinner" aria-hidden="true" />
        <span className="sync-stage-label">{STAGE_LABELS[sync.stage]}&hellip;</span>
        {sync.total > 0 && (
          <span className="sync-counts">
            <strong>{sync.fetched.toLocaleString()}</strong>{' / '}{sync.total.toLocaleString()}
          </span>
        )}
        <button
          className="sync-stop-btn"
          onClick={onCancel}
          title="Stop sync — saves progress made so far"
        >
          &#x25A0; Stop
        </button>
      </div>
      {sync.total > 0 && (
        <div
          className="sync-bar-wrap"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="sync-bar-fill" style={{ width: pct + '%' }} />
        </div>
      )}
    </div>
  );
};
