import React, { useState } from 'react';
import { SpotifyPlaylist } from '../services/SpotifyPlaylistService';
import { setRemoteRetention, keepRemotePlaylist, deleteRemotePlaylistNow } from '../services/remote/retentionRemote';
import { setLocalRetention, clearLocalRetention, deleteLocalPlaylistNow } from '../services/PlaylistRetentionService';

interface Props {
  playlist: SpotifyPlaylist;
  remote?:  { serverUrl: string } | null;
  current?: string | null;
  onClose:  () => void;
  onSaved:  () => void;
  onToast:  (msg: string, ok?: boolean) => void;
}

type Preset = '1h' | '6h' | '1d' | '1w' | 'custom';

const HOURS: Record<Exclude<Preset, 'custom'>, number> = { '1h': 1, '6h': 6, '1d': 24, '1w': 168 };

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const RetentionDialog: React.FC<Props> = ({ playlist, remote, current, onClose, onSaved, onToast }) => {
  const [preset, setPreset] = useState<Preset>('1d');
  const [custom, setCustom] = useState(
    current ? toLocalInput(current) : toLocalInput(new Date(Date.now() + 24 * 3600_000).toISOString()),
  );
  const [busy, setBusy] = useState(false);

  const expiresAt = (): string => {
    if (preset === 'custom') return new Date(custom).toISOString();
    return new Date(Date.now() + HOURS[preset] * 3600_000).toISOString();
  };

  const save = async () => {
    setBusy(true);
    try {
      const until = expiresAt();
      if (remote) await setRemoteRetention(remote.serverUrl, playlist.id, until);
      else await setLocalRetention({ playlistId: playlist.id, name: playlist.name, expiresAt: until });
      onToast('Playlist will be deleted ' + new Date(until).toLocaleString());
      onSaved();
      onClose();
    } catch (e: any) {
      onToast(e?.message ?? 'Could not set expiry', false);
    } finally { setBusy(false); }
  };

  const keep = async () => {
    setBusy(true);
    try {
      if (remote) await keepRemotePlaylist(remote.serverUrl, playlist.id);
      else await clearLocalRetention(playlist.id);
      onToast('Playlist will be kept forever');
      onSaved();
      onClose();
    } catch (e: any) {
      onToast(e?.message ?? 'Could not clear expiry', false);
    } finally { setBusy(false); }
  };

  const deleteNow = async () => {
    if (!window.confirm('Delete "' + playlist.name + '" now? It is removed from your Spotify library.')) return;
    setBusy(true);
    try {
      if (remote) await deleteRemotePlaylistNow(remote.serverUrl, playlist.id);
      else await deleteLocalPlaylistNow(playlist.id);
      onToast('Playlist deleted');
      onSaved();
      onClose();
    } catch (e: any) {
      onToast(e?.message ?? 'Delete failed', false);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Playlist expiry">
      <div className="modal retention-modal">
        <div className="modal-header">
          <h2>Delete "{playlist.name}" after...</h2>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          <p className="sync-desc">
            Shortlived playlists are removed from your Spotify library automatically.
            The sweep runs {remote ? 'on the server every 5 minutes' : 'while the app is open and when you return to it'}.
          </p>
          <div className="retention-presets">
            {(['1h', '6h', '1d', '1w', 'custom'] as Preset[]).map((p) => (
              <button key={p} className={'retention-chip' + (preset === p ? ' active' : '')} onClick={() => setPreset(p)}>
                {p === 'custom' ? 'Custom' : p === '1h' ? '1 hour' : p === '6h' ? '6 hours' : p === '1d' ? '1 day' : '1 week'}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <input className="form-input" type="datetime-local" value={custom} min={toLocalInput(new Date().toISOString())} onChange={(e) => setCustom(e.target.value)} />
          )}
          <div className="retention-actions">
            <button className="sync-btn" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Set expiry'}</button>
            {current && <button className="sync-btn sync-btn--ghost" onClick={keep} disabled={busy}>Keep forever</button>}
            <button className="sync-btn sync-btn--danger" onClick={deleteNow} disabled={busy}>Delete now</button>
          </div>
        </div>
      </div>
    </div>
  );
};
