import { Artwork } from './Artwork';
import { WebPlaybackSdkPlayer } from './WebPlaybackSdkPlayer';
import React, { useEffect, useMemo, useState } from 'react';
import { formatMs, queueTrackToSpotifyActive, playTracks } from '../services/SpotifyPlaybackService';
import type { PlayerQueueController } from '../hooks/usePlayerQueue';

// ---------------------------------------------------------------------------
// Player tab έΑΦ now playing + the two queue-playlist models
// ---------------------------------------------------------------------------

type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

interface Props {
  player:              PlayerQueueController;
  authState?:          AuthState;
  isRemote?:           boolean;
  selectedCount?:      number;
  onConnectSpotify?:   () => void;
  onRequestLocalCreate?: () => void;
  onRequestLocalReset?:  () => void;
  onRequestLocalClear?:  () => void;
  onRequestMergeCreate?: () => void;
  onRequestMergeNew?:    () => void;
  onRequestMergeReset?:  () => void;
  onAddSelectedToMerge?: () => void;
}

function snapshotName(): string {
  const stamp = new Intl.DateTimeFormat(undefined, {
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  }).format(new Date());
  return `Queue snapshot ┬╖ ${stamp}`;
}

export const PlayerView: React.FC<Props> = ({
  player,
  authState,
  isRemote,
  selectedCount,
  onConnectSpotify,
  onRequestLocalCreate,
  onRequestLocalReset,
  onRequestLocalClear,
  onRequestMergeCreate,
  onRequestMergeNew,
  onRequestMergeReset,
  onAddSelectedToMerge,
}) => {
  const {
    playback, playbackLoading, playbackError,
    queueMode, setQueueMode,
    localQueue, localStatus, localBusy,
    mergeQueue, mergeStatus, mergeBusy,
    queuePlaylistBusy, refreshPlayback,
    saveQueue, appendQueue,
  } = player;

  const [displayedProgress, setDisplayedProgress] = useState(0);
  const [queuePlayBusy, setQueuePlayBusy] = useState<string | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState(snapshotName);
  const track = playback?.track ?? null;
  const duration = track?.duration_ms ?? 0;
  const queueCount = playback?.queue.length ?? 0;
  const busy = mergeBusy || queuePlaylistBusy;
  const canSave = !busy && (track != null || queueCount > 0);
  const canAppend = !busy
    && playback?.contextPlaylistId != null
    && playback.contextEditable
    && queueCount > 0;

  useEffect(() => {
    if (!playback) {
      setDisplayedProgress(0);
      return;
    }
    setDisplayedProgress(playback.progressMs);
    if (!playback.isPlaying) return;

    const startedAt = Date.now();
    const base = playback.progressMs;
    const timer = window.setInterval(() => {
      const next = base + (Date.now() - startedAt);
      setDisplayedProgress(duration > 0 ? Math.min(duration, next) : next);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playback?.progressMs, playback?.progressAt, playback?.isPlaying, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const artUrl = useMemo(
    () => track?.album?.images?.find((image: { url?: string }) => !!image.url)?.url ?? '',
    [track],
  );

  const openSave = () => {
    setSaveName(snapshotName());
    setShowSave(true);
  };

  const playQueueTrack = async (uri: string, index: number) => {
    if (!uri || !playback?.queue?.length) return;
    const uris = playback.queue.slice(index).map((track: any) => track.uri).filter(Boolean);
    setQueuePlayBusy(uri);
    try {
      await playTracks(uris.length ? uris : [uri]);
      await refreshPlayback();
    } catch (error) {
      console.error(error);
    } finally {
      setQueuePlayBusy(null);
    }
  };

  const submitSave = () => {
    if (!saveName.trim() || queuePlaylistBusy) return;
    setShowSave(false);
    void saveQueue(saveName);
  };

  return (
    <div className="player-tab">
      <div className="player-head">
        <h2>Now playing</h2>
        <button className="player-refresh" onClick={() => void refreshPlayback()} disabled={playbackLoading}>
          {playbackLoading ? 'RefreshingέΑο' : 'Refresh'}
        </button>
      </div>

            <WebPlaybackSdkPlayer />

{authState !== 'authenticated' && (
        <div className="player-notice" role="status">
          <strong>Spotify login needed on this device.</strong>
          <p>
            Playback and queue playlists use SpotifyέΑβs Web API directly. The media server keeps
            the library, but it cannot control this deviceέΑβs playback.
          </p>
          <button className="queue-btn queue-btn--primary" onClick={onConnectSpotify}>
            Connect Spotify on this device
          </button>
        </div>
      )}

      {authState === 'authenticated' && (
        <>
          {playbackError && <div className="player-error" role="alert">{playbackError}</div>}

          {playbackLoading && !playback ? (
            <div className="player-loading">
              <span className="spinner" aria-hidden="true" />
              <span>Reading Spotify playbackέΑο</span>
            </div>
          ) : !track ? (
            <div className="player-empty">
              <p>No active Spotify playback.</p>
              <p className="player-hint">Open Spotify on a device, or switch to έΑεOn this deviceέΑζ in Settings.</p>
            </div>
          ) : (
            <div className="player-now">
              <div className="player-art-wrap">
                {artUrl
                  ? <Artwork className="player-art" src={artUrl} alt="" loading="lazy" />
                  : <div className="player-art player-art--empty" aria-hidden="true">έβς</div>}
              </div>
              <div className="player-track-info">
                <p className="player-track-name">{track.name}</p>
                <p className="player-track-artist">{track.artists.map((artist: { name?: string }) => artist.name).join(', ')}</p>
                <p className="player-track-album">{track.album?.name ?? ''}</p>
                <div className="player-progress" role="progressbar"
                     aria-valuenow={duration > 0 ? Math.round((displayedProgress / duration) * 100) : 0}
                     aria-valuemin={0} aria-valuemax={100}>
                  <div className="player-progress-fill"
                       style={{ width: duration > 0 ? `${Math.min(100, (displayedProgress / duration) * 100)}%` : '0%' }} />
                </div>
                <div className="player-progress-times">
                  <span>{formatMs(displayedProgress)}</span>
                  <span>{formatMs(duration)}</span>
                </div>
                <p className="player-device">
                  {playback?.isPlaying ? 'Playing' : 'Paused'}
                  {playback?.deviceName ? ` - ${playback.deviceName}` : ''}
                </p>
              </div>
            </div>
          )}

          <section className="queue-section">
            <h3>Queue playlist</h3>
            <div className="queue-mode-row" role="group" aria-label="Queue mode">
              <button
                className={'queue-chip ' + (queueMode === 'local' ? 'active' : '')}
                onClick={() => setQueueMode('local')}
                aria-pressed={queueMode === 'local'}
              >
                Local queue
              </button>
              <button
                className={'queue-chip ' + (queueMode === 'merge' ? 'active' : '')}
                onClick={() => setQueueMode('merge')}
                aria-pressed={queueMode === 'merge'}
              >
                Spotify merge
              </button>
            </div>

            {queueMode === 'local' ? (
              <>
                <p className="queue-status">{localStatus}</p>
                <p className="queue-ref">
                  {localQueue
                    ? `έΑε${localQueue.name}έΑζ ┬╖ ${localQueue.uris.length} tracks`
                    : 'The playlist itself is the queue. SpotifyέΑβs manual queue is ignored.'}
                </p>
                <button
                  className="queue-btn queue-btn--primary queue-btn--full"
                  onClick={onRequestLocalCreate}
                  disabled={busy}
                >
                  {localBusy ? 'WorkingέΑο' : localQueue ? 'New queue playlist' : 'Queue playlist'}
                </button>
                <div className="queue-btn-row">
                  <button className="queue-btn" onClick={onRequestLocalReset}
                          disabled={localQueue == null || busy}>
                    Reset Queue Playlist
                  </button>
                  <button className="queue-btn" onClick={onRequestLocalClear} disabled={busy}>
                    {localBusy ? 'WorkingέΑο' : 'Clear local queue'}
                  </button>
                </div>
                <p className="queue-help">
                  Add selected to end and Queue next are on the album pages. The playlist ID is the
                  queue, and SpotifyέΑβs manual queue is ignored. Clear starts an empty queue and keeps
                  the old playlist on Spotify.
                </p>
              </>
            ) : (
              <>
                <p className="queue-status">{mergeStatus}</p>
                {mergeQueue ? (
                  <>
                    <p className="queue-ref">έΑε{mergeQueue.name}έΑζ ┬╖ {mergeQueue.uris.length} tracks</p>
                    <button className="queue-btn queue-btn--primary queue-btn--full"
                            onClick={onRequestMergeNew} disabled={busy}>
                      New queue playlist
                    </button>
                    <div className="queue-btn-row">
                      <button className="queue-btn" onClick={onRequestMergeReset} disabled={busy}>
                         Reset + merge Spotify (max 20)
                      </button>
                    </div>
                    <p className="queue-help">
                      Albums are appended after the existing tail. Manual Spotify queue items stay
                      in place, so they do not play twice.
                    </p>
                  </>
                ) : (
                  <>
                    <button className="queue-btn queue-btn--primary queue-btn--full"
                            onClick={onRequestMergeCreate} disabled={busy}>
                      {mergeBusy ? 'WorkingέΑο' : 'Create queue playlist'}
                    </button>
                    <p className="queue-help">
                      This creates one private playlist and starts it immediately; the current track
                      is cut off.
                    </p>
                  </>
                )}
              </>
            )}
          </section>

          <div className="player-queue-actions">
            <button className="queue-btn" onClick={openSave} disabled={!canSave}>Save queue</button>
            <button className="queue-btn" onClick={() => void appendQueue()} disabled={!canAppend}>
              Append queue
            </button>
          </div>

          {playback?.contextType === 'playlist' && (
            <p className="player-context">
              {playback.contextName ? `Playing from ${playback.contextName}` : 'Playing from a playlist'}
              {!playback.contextEditable && ' ┬╖ append is disabled for this playlist'}
            </p>
          )}
          {playback?.contextType !== 'playlist' && track && (
            <p className="player-context">Start playback from one of your playlists to append the queue.</p>
          )}

          <section className="player-upnext">
            <h3>Up next ({queueCount})</h3>
            {queueCount === 0 ? (
              <p className="player-hint">Nothing queued.</p>
            ) : (
              <div className="upnext-list">
                {playback?.queue.map((item: any, index: number) => (
                  <div className="upnext-row" key={`${item.uri}-${index}`}>
                    <div className="upnext-info">
                      <p className="upnext-name">{item.name}</p>
                      <p className="upnext-artist">{item.artists.map((artist: { name?: string }) => artist.name).join(', ')}</p>
                    </div>
                    <button
                      type="button"
                      className="queue-btn"
                      onClick={() => void playQueueTrack(item.uri, index)}
                      disabled={queuePlayBusy === item.uri}
                    >
                      {queuePlayBusy === item.uri ? 'Playing…' : 'Play'}
                    </button>
                    <span className="upnext-time">{formatMs(item.duration_ms)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="player-footnote">
            Queue snapshot copies the current track + up-next once. Append only works on playlists
            you own or collaborate on. Play as queue playlist hands the queue over to a new playlist.
            Spotify Premium and an active device are required.
            {isRemote && ' Queue playlists use this deviceέΑβs Spotify login; the media server keeps the library.'}
          </p>
        </>
      )}

      {showSave && (
        <div className="modal-overlay queue-save-overlay" role="presentation" onClick={() => setShowSave(false)}>
          <div className="queue-save-modal" role="dialog" aria-modal="true"
               aria-labelledby="queue-save-title" onClick={(event) => event.stopPropagation()}>
            <h3 id="queue-save-title">Save queue as playlist</h3>
            <p className="queue-help">
              Creates a private playlist with the current track and {queueCount} queued item(s).
              This is a one-time copy; later queue changes are not synced.
            </p>
            <label className="queue-save-label" htmlFor="queue-save-name">Playlist name</label>
            <input
              id="queue-save-name"
              className="queue-save-input"
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              disabled={queuePlaylistBusy}
              autoFocus
            />
            <div className="queue-save-actions">
              <button className="queue-btn" onClick={() => setShowSave(false)} disabled={queuePlaylistBusy}>
                Cancel
              </button>
              <button className="queue-btn queue-btn--primary" onClick={submitSave}
                      disabled={!saveName.trim() || queuePlaylistBusy}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

          </div>
  );
};
