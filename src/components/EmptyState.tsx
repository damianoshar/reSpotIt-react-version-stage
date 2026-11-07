import React from 'react';

interface Props {
  hasSearch: boolean;
  onImport: () => void;
}

export const EmptyState: React.FC<Props> = ({ hasSearch, onImport }) => (
  <div className="empty-state">
    <svg viewBox="0 0 80 80" fill="none" width="80" height="80" aria-hidden="true">
      <circle cx="40" cy="40" r="38" stroke="#282828" strokeWidth="2" />
      <circle cx="40" cy="40" r="16" stroke="#535353" strokeWidth="2" />
      <circle cx="40" cy="40" r="5"  fill="#535353" />
      <line x1="40" y1="2"  x2="40" y2="24" stroke="#282828" strokeWidth="2" />
      <line x1="40" y1="56" x2="40" y2="78" stroke="#282828" strokeWidth="2" />
      <line x1="2"  y1="40" x2="24" y2="40" stroke="#282828" strokeWidth="2" />
      <line x1="56" y1="40" x2="78" y2="40" stroke="#282828" strokeWidth="2" />
    </svg>

    {hasSearch ? (
      <>
        <h2>No results found</h2>
        <p>Try adjusting your search or genre filter.</p>
      </>
    ) : (
      <>
        <h2>Your library is empty</h2>
        <p>Import a CSV file to populate your Spotify library dashboard.</p>
        <button className="sync-btn" onClick={onImport}>▲ Import CSV</button>
      </>
    )}
  </div>
);
