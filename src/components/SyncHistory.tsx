import React from 'react';
import { HistoryJob, relativeTime, syncOutcome } from '../utils/syncHistory';

interface Props {
  /** null while loading, [] when the server has no finished syncs. */
  items: HistoryJob[] | null;
}

/** The server's recent sync runs, shown under the Spotify tab's buttons. */
export const SyncHistory: React.FC<Props> = ({ items }) => {
  if (items === null) return <p className="sync-desc">Loading&hellip;</p>;
  if (items.length === 0) return <p className="sync-desc">No syncs yet — run one above.</p>;

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((job, i) => {
        const age = relativeTime(job.finished_at ?? job.created_at);
        return (
          <li
            key={(job.job_id ?? '') + i}
            className="sync-desc"
            style={{ marginTop: '0.25rem', color: job.status === 'error' ? '#ff6b6b' : undefined }}
          >
            {syncOutcome(job)}{age ? ` · ${age}` : ''}
          </li>
        );
      })}
    </ul>
  );
};
