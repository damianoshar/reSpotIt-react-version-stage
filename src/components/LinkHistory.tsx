import React, { useEffect, useState } from 'react';
import {
  readLinkHistory,
  recordRecent,
  removeSavedLink,
  subscribeLinkHistory,
  toggleSavedLink,
  type LinkHistoryKind,
  type LinkHistoryState,
  type LinkTarget,
} from '../services/linkHistory';

export interface LinkHistoryProps {
  kind: LinkHistoryKind;
  /** Current input value, used by the save toggle. */
  value: string;
  /** Which field the current value belongs to. */
  target: LinkTarget;
  onPick: (value: string, target: LinkTarget) => void;
  disabled?: boolean;
  /** Only show entries that fit these fields (e.g. a native browser has no text box). */
  accept?: LinkTarget[];
}

const DEFAULT_ACCEPT: LinkTarget[] = ['url', 'text'];

/**
 * Recent + saved chips for a page/URL input. Picking a chip fills the dialog's
 * input; the star pins the current value. Everything is device-local.
 */
export const LinkHistory: React.FC<LinkHistoryProps> = ({
  kind, value, target, onPick, disabled, accept = DEFAULT_ACCEPT,
}) => {
  const [state, setState] = useState<LinkHistoryState>(() => readLinkHistory(kind));
  const [notice, setNotice] = useState('');

  // Refresh when any dialog writes to this bucket (a scan records a recent).
  useEffect(() => {
    setState(readLinkHistory(kind));
    return subscribeLinkHistory((changed) => {
      if (changed === kind) setState(readLinkHistory(kind));
    });
  }, [kind]);

  const visibleRecent = state.recent.filter((e) => accept.includes(e.target));
  const visibleSaved = state.saved.filter((e) => accept.includes(e.target));
  const trimmed = value.trim();
  const alreadySaved = !!trimmed && state.saved.some((e) => e.value.trim() === trimmed);

  const pick = (picked: string, pickedTarget: LinkTarget) => {
    setNotice('');
    recordRecent(kind, picked, pickedTarget);
    setState(readLinkHistory(kind));
    onPick(picked, pickedTarget);
  };

  const toggleSave = () => {
    if (!trimmed) return;
    setState(toggleSavedLink(kind, value, target));
    setNotice(alreadySaved ? 'Removed from saved links.' : 'Saved for later.');
  };

  const forget = (id: string) => {
    setState(removeSavedLink(kind, id));
    setNotice('');
  };

  return (
    <div className="link-history">
      <div className="link-history-row">
        <span className="link-history-heading">Recent</span>
        {visibleRecent.length === 0 ? (
          <span className="link-history-empty">none yet</span>
        ) : (
          visibleRecent.map((entry) => (
            <button
              key={`${entry.target}:${entry.value}`}
              type="button"
              className="link-chip"
              title={entry.value.length > 120 ? entry.value.slice(0, 120) + '…' : entry.value}
              onClick={() => pick(entry.value, entry.target)}
              disabled={disabled}
            >
              {entry.target === 'text' ? '¶ ' : ''}{entry.label}
            </button>
          ))
        )}
      </div>

      <div className="link-history-row">
        <span className="link-history-heading">Saved</span>
        {visibleSaved.length === 0 ? (
          <span className="link-history-empty">none yet</span>
        ) : (
          visibleSaved.map((entry) => (
            <span key={entry.id} className="link-chip link-chip--saved">
              <button
                type="button"
                className="link-chip-main"
                title={entry.value.length > 120 ? entry.value.slice(0, 120) + '…' : entry.value}
                onClick={() => pick(entry.value, entry.target)}
                disabled={disabled}
              >
                {entry.target === 'text' ? '¶ ' : ''}{entry.label}
              </button>
              <button
                type="button"
                className="link-chip-remove"
                aria-label={`Remove saved link ${entry.label}`}
                onClick={() => forget(entry.id)}
                disabled={disabled}
              >
                ✕
              </button>
            </span>
          ))
        )}
        <button
          type="button"
          className="url-btn link-save-btn"
          onClick={toggleSave}
          disabled={disabled || !trimmed}
          title={target === 'text' ? 'Save the current text for later' : 'Save the current URL for later'}
        >
          {alreadySaved ? 'Unsave' : 'Save link'}
        </button>
      </div>

      {notice && <div className="link-history-notice">{notice}</div>}
    </div>
  );
};
