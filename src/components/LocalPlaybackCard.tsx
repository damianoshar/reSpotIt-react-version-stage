import React, { useState } from 'react';
import { Artwork } from './Artwork';
import { formatMs, queueTrackToSpotifyActive } from '../services/SpotifyPlaybackService';
import type { LocalPlayerController } from '../hooks/useLocalPlayback';
import type { LocalPlaybackSettings } from '../services/librespotPlayer';
export const LocalPlaybackCard: React.FC<{ local: LocalPlayerController }> = ({ local }) => {
  const state = local.state;
  const enabled = state?.enabled ?? false;
  const connected = state?.connected ?? false;
  const connecting = state?.connecting ?? false;
  const isPlaying = state?.isPlaying ?? false;
  const duration = state?.durationMs ?? 0;
  const hasTrack = !!state?.title;
  const localQueue = state?.queue ?? [];
  const localQueueIndex = state?.queueIndex ?? -1;
  const upcoming = localQueueIndex >= 0 ? localQueue.slice(localQueueIndex + 1) : localQueue;
  const queueTotal = state?.queueTotal ?? localQueue.length;
  const queuePosition = state?.queuePosition ?? localQueueIndex;
  const remainingCount = queuePosition >= 0
    ? Math.max(0, queueTotal - queuePosition - 1)
    : localQueue.length;

  const [seekMs, setSeekMs] = useState<number | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const [sendingToSpotify, setSendingToSpotify] = useState(false);
  const [sendStatus, setSendStatus] = useState('');
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const [audioSettingsLoading, setAudioSettingsLoading] = useState(false);
  const [audioSettings, setAudioSettings] = useState<LocalPlaybackSettings>({
    bitrateKbps: 160,
    bufferSeconds: 2,
    cacheMb: 0,
    deviceName: 'reSpotIt',
    audioFocusPauseTransient: false,
  });
  const [audioSettingsSaving, setAudioSettingsSaving] = useState(false);

  const position = seekMs ?? state?.positionMs ?? 0;
  const maxSeek = Math.max(1, duration);
  const displayPosition = Math.min(position, maxSeek);

  const commitSeek = () => {
    if (seekMs == null) return;
    void local.seek(seekMs);
    setSeekMs(null);
  };

  const sendQueueToSpotify = async () => {
    const uris = (state?.queue ?? []).map((track) => track.uri).filter(Boolean);
    if (!uris.length) {
      setSendStatus('No local queue to send.');
      return;
    }
    setSendingToSpotify(true);
    setSendStatus('');
    let queued = 0;
    let error: string | null = null;
    for (const uri of uris) {
      try {
        if (await queueTrackToSpotifyActive(uri)) queued++;
      } catch (e: any) {
        error = e?.message ?? 'Open Spotify on a device first, then try again.';
        break;
      }
    }
    setSendStatus(
      error ?? (queued > 0
        ? `Sent ${queued}/${uris.length} track(s) to the active Spotify queue.`
        : 'Open Spotify on a device first, then try again.'),
    );
    setSendingToSpotify(false);
  };

  const openAudioSettings = async () => {
    setAudioSettingsLoading(true);
    try {
      const next = await local.getSettings();
      setAudioSettings(next);
    } catch {
      // keep defaults on failure
    } finally {
      setAudioSettingsLoading(false);
      setAudioSettingsOpen(true);
    }
  };

  const saveAudioSettings = async () => {
    setAudioSettingsSaving(true);
    try {
      await local.applySettings(audioSettings);
      setAudioSettingsOpen(false);
    } catch {
      // error surface via local.error
    } finally {
      setAudioSettingsSaving(false);
    }
  };

  const status = connecting
    ? 'Connecting to Spotify…'
    : connected
      ? (state?.remote ? 'Controlled from Spotify Connect' : 'Connected')
      : state?.needsAuth
        ? 'Spotify login needed'
        : 'Not connected';

  return (
    <>
      <section className="local-player" aria-label="On-device playback">
      <div className="local-player-head">
        <div>
          <h3>On this device</h3>
          <p className="local-player-sub">Full tracks through the built-in librespot player.</p>
        </div>
        <label className="local-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => { void local.setEnabled(event.target.checked); }}
            disabled={local.busy}
          />
          <span>{enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      {!enabled ? (
        <p className="local-player-hint">
          Turn on to play albums without Spotify Connect. The first play opens Spotify's consent
          page; Premium is required. This login is independent from the dashboard login.
        </p>
      ) : (
        <>
          <div className="local-player-status">
            <span
              className={'local-status-dot' + (connecting ? ' is-connecting' : connected ? ' is-on' : '')}
              aria-hidden="true"
            />
            <span>{status}</span>
            <label className="local-keep">
              <input
                type="checkbox"
                checked={state?.keepConnected ?? false}
                onChange={(event) => { void local.setKeepConnected(event.target.checked); }}
                disabled={local.busy}
              />
              Keep connected
            </label>
          </div>

          {local.error && <div className="player-error local-player-error" role="alert">{local.error}</div>}

          {hasTrack ? (
            <div className="local-now">
              <div className="local-now-art">
                {state?.artUrl
                  ? <Artwork className="local-art" src={state.artUrl} alt="" loading="lazy" />
                  : <div className="local-art local-art--empty" aria-hidden="true">♪</div>}
              </div>
              <div className="local-now-info">
                <p className="player-track-name">{state?.title}</p>
                <p className="player-track-artist">{state?.artist}</p>
                <input
                  className="local-progress"
                  type="range"
                  min={0}
                  max={maxSeek}
                  step={250}
                  value={displayPosition}
                  onChange={(event) => setSeekMs(Number(event.target.value))}
                  onPointerUp={commitSeek}
                  onKeyUp={commitSeek}
                  onBlur={commitSeek}
                  disabled={!connected || duration <= 0 || local.busy}
                  aria-label="Seek local playback"
                />
                <div className="player-progress-times">
                  <span>{formatMs(displayPosition)}</span>
                  <span>{formatMs(duration)}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="local-player-hint">
              {connecting
                ? 'Connecting to Spotify…'
                : connected
                  ? 'Ready. Open an album and choose "Play album on this device".'
                  : 'Open an album and choose "Play album on this device" to start.'}
            </p>
          )}

          <div className="local-controls">
            <button
              type="button"
              className="local-control-btn"
              onClick={() => { void local.previous(); }}
              disabled={local.busy || !hasTrack}
              aria-label="Previous local track"
            >
              ⏮
            </button>
            <button
              type="button"
              className="local-control-btn local-control-btn--main"
              onClick={() => { void (isPlaying ? local.pause() : local.resume()); }}
              disabled={local.busy || !connected || !hasTrack}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              className="local-control-btn"
              onClick={() => { void local.next(); }}
              disabled={local.busy || !hasTrack}
              aria-label="Next local track"
            >
              ⏭
            </button>
            <button
              type="button"
              className="local-control-btn"
              onClick={() => { void local.stop(); }}
              disabled={local.busy || (!hasTrack && !connected)}
            >
              Stop
            </button>
          </div>

          {!state?.remote && localQueue.length > 0 && (
            <section className="player-upnext local-upnext" aria-label="On-device queue">
              <div className="local-queue-head">
                <h3>Up next on this device ({remainingCount})</h3>
                <div className="local-queue-actions">
                  <button type="button" className="track-action-btn" onClick={() => { void local.clearQueue(); }} disabled={local.busy}>
                    Clear
                  </button>
                  <button type="button" className="track-action-btn" onClick={() => void sendQueueToSpotify()} disabled={local.busy || sendingToSpotify}>
                    {sendingToSpotify ? 'To Spotify…' : 'To Spotify'}
                  </button>
                </div>
              </div>
              {sendStatus && <p className="player-hint">{sendStatus}</p>}
              {upcoming.length === 0 ? (
                <p className="player-hint">Nothing queued.</p>
              ) : (
                <>
                  <div className="upnext-list">
                    {upcoming.map((item, i) => {
                      const queueIndex = localQueueIndex + 1 + i;
                      return (
                        <div className="upnext-row" key={`${item.uri}-${i}`}>
                          <div className="upnext-info">
                            <button type="button" className="upnext-jump" onClick={() => { void local.jumpToQueueIndex(queueIndex); }}>
                              <p className="upnext-name">{item.title}</p>
                            </button>
                            <p className="upnext-artist">{item.artist}</p>
                          </div>
                          <span className="upnext-time">{formatMs(item.durationMs)}</span>
                          <button type="button" className="track-row-btn" title="Move up" disabled={queueIndex === 0} onClick={() => { void local.moveQueueItem(queueIndex, queueIndex - 1); }}>↑</button>
                          <button type="button" className="track-row-btn" title="Move down" disabled={queueIndex >= localQueue.length - 1} onClick={() => { void local.moveQueueItem(queueIndex, queueIndex + 1); }}>↓</button>
                          <button type="button" className="track-row-btn track-row-remove" title="Remove" onClick={() => { void local.removeQueueItem(queueIndex); }}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                  {upcoming.length < remainingCount && (
                    <p className="player-hint">
                      Showing the next {upcoming.length} of {remainingCount} queued tracks.
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          <div className="local-player-foot">
            <button
              type="button"
              className="local-link"
              onClick={() => setConfirmForget(true)}
              disabled={local.busy}
            >
              Forget playback account
            </button>
            <button
              type="button"
              className="local-link"
              onClick={() => void openAudioSettings()}
              disabled={local.busy || audioSettingsLoading}
            >
              {audioSettingsLoading ? 'Loading audio settings…' : 'Audio settings'}
            </button>
            <span>librespot · Premium</span>
          </div>

          {confirmForget && (
            <div className="local-confirm" role="alertdialog" aria-label="Forget playback account">
              <p>Remove the stored librespot credentials from this device?</p>
              <div className="local-confirm-actions">
                <button type="button" className="local-control-btn" onClick={() => setConfirmForget(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="local-control-btn local-control-btn--danger"
                  onClick={() => { setConfirmForget(false); void local.forgetAccount(); }}
                >
                  Forget
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
      {audioSettingsOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => setAudioSettingsOpen(false)}>
          <div className="queue-save-modal" role="dialog" aria-modal="true"
               aria-labelledby="audio-settings-title" onClick={(event) => event.stopPropagation()}>
            <h3 id="audio-settings-title">Audio settings</h3>
            <p className="queue-help">
              Applies to the on-device librespot player. Changes take effect on the next connect.
            </p>
            <label className="queue-save-label" htmlFor="audio-bitrate">Streaming quality</label>
            <select
              id="audio-bitrate"
              className="queue-save-input"
              value={audioSettings.bitrateKbps}
              onChange={(event) => setAudioSettings({ ...audioSettings, bitrateKbps: Number(event.target.value) })}
            >
              <option value={96}>96 kbps</option>
              <option value={160}>160 kbps (default)</option>
              <option value={320}>320 kbps</option>
            </select>
            <label className="queue-save-label" htmlFor="audio-buffer">Buffer / prebuffer</label>
            <select
              id="audio-buffer"
              className="queue-save-input"
              value={audioSettings.bufferSeconds}
              onChange={(event) => setAudioSettings({ ...audioSettings, bufferSeconds: Number(event.target.value) })}
            >
              <option value={1}>1 second</option>
              <option value={2}>2 seconds (default)</option>
              <option value={4}>4 seconds</option>
              <option value={8}>8 seconds</option>
            </select>
            <label className="queue-save-label" htmlFor="audio-cache">Cache size (MB, 0 = disabled)</label>
            <input
              id="audio-cache"
              className="queue-save-input"
              type="number"
              min={0}
              value={audioSettings.cacheMb}
              onChange={(event) => setAudioSettings({ ...audioSettings, cacheMb: Number(event.target.value) })}
            />
            <label className="queue-save-label" htmlFor="audio-device-name">Connect device name</label>
            <input
              id="audio-device-name"
              className="queue-save-input"
              value={audioSettings.deviceName}
              onChange={(event) => setAudioSettings({ ...audioSettings, deviceName: event.target.value })}
            />
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={audioSettings.audioFocusPauseTransient}
                onChange={(event) => setAudioSettings({ ...audioSettings, audioFocusPauseTransient: event.target.checked })}
              />
              <span>Pause (instead of duck) on transient audio-focus loss</span>
            </label>
            <div className="queue-save-actions">
              <button className="queue-btn" onClick={() => setAudioSettingsOpen(false)} disabled={audioSettingsSaving}>
                Cancel
              </button>
              <button className="queue-btn queue-btn--primary" onClick={saveAudioSettings} disabled={audioSettingsSaving}>
                {audioSettingsSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

  </>);
};

