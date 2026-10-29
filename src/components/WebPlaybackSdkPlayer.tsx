import React, { useEffect, useRef, useState } from 'react';
import { getValidAccessToken } from '../services/SpotifyAuthService';
import {
  getSpotifyPlaybackDevices,
  getWebPlaybackSdkState,
  initWebPlaybackSdk,
  nextWebPlayback,
  playWithWebPlaybackSdk,
  previousWebPlayback,
  seekWebPlayback,
  setWebPlaybackVolume,
  subscribeWebPlaybackSdk,
  toggleWebPlayback,
  transferPlaybackToDevice,
  type SpotifyPlaybackDevice,
} from '../services/WebPlaybackSdkService';

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const WebPlaybackSdkPlayer: React.FC = () => {
  const [state, setState] = useState(getWebPlaybackSdkState());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [devices, setDevices] = useState<SpotifyPlaybackDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [deviceBusy, setDeviceBusy] = useState(false);
  const autoConnectStarted = useRef(false);

  useEffect(() => subscribeWebPlaybackSdk(setState), []);

  const loadDevices = async (silent = false) => {
    if (deviceBusy && !silent) return;
    if (!silent) setDeviceBusy(true);
    try {
      const token = await getValidAccessToken();
      const list = await getSpotifyPlaybackDevices(async () => token);
      setDevices((current) => {
        if (silent && JSON.stringify(current) === JSON.stringify(list)) return current;
        return list;
      });
      const preferred = list.find((device) => device.id === state.deviceId)
        ?? list.find((device) => device.is_active)
        ?? list[0];
      if (preferred && !selectedDeviceId) setSelectedDeviceId(preferred.id);
      if (!silent) setMessage(`Loaded ${list.length} Spotify device${list.length === 1 ? '' : 's'}.`);
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : 'Could not load Spotify devices.');
    } finally {
      if (!silent) setDeviceBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setMessage('');
    try {
      const deviceId = await initWebPlaybackSdk(async () => getValidAccessToken());
      await loadDevices(false);
      setMessage('Connected to the Web Playback SDK.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Web Playback SDK connection failed.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoConnectStarted.current) return;
    autoConnectStarted.current = true;
    void connect();
  }, []);

  useEffect(() => {
    if (!state.ready) return;
    const timer = window.setInterval(() => {
      void loadDevices(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [state.ready]);

  const toggle = async () => {
    setBusy(true);
    try { await toggleWebPlayback(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Toggle failed.'); }
    finally { setBusy(false); }
  };

  const next = async () => {
    setBusy(true);
    try { await nextWebPlayback(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Next failed.'); }
    finally { setBusy(false); }
  };

  const previous = async () => {
    setBusy(true);
    try { await previousWebPlayback(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Previous failed.'); }
    finally { setBusy(false); }
  };

  const seek = async (value: string) => {
    try { await seekWebPlayback(Number(value)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Seek failed.'); }
  };

  const changeVolume = async (value: string) => {
    try { await setWebPlaybackVolume(Number(value)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Volume change failed.'); }
  };

  const connectToDevice = async (targetDeviceId: string) => {
    if (!targetDeviceId) {
      setMessage('Select a device first.');
      return;
    }
    setDeviceBusy(true);
    setMessage('');
    try {
      await transferPlaybackToDevice(targetDeviceId, async () => getValidAccessToken(), true);
      await loadDevices(true);
      const device = devices.find((item) => item.id === targetDeviceId);
      setMessage(`Connected to ${device?.name ?? 'selected device'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not connect to the selected device.');
    } finally {
      setDeviceBusy(false);
    }
  };

  const percent = state.duration > 0 ? Math.min(100, (state.position / state.duration) * 100) : 0;

  return (
    <section className="local-player" aria-label="Web Playback SDK">
      <div className="local-player-head">
        <div>
          <h3>Web Playback SDK</h3>
          <p className="local-player-sub">Full tracks through Spotify's official browser player.</p>
        </div>
        <button type="button" className="local-toggle" onClick={() => void connect()} disabled={busy}>
          <span className={`local-status-dot ${state.ready ? 'is-on' : ''}`} aria-hidden="true" />
          <span>{state.ready ? 'Reconnect' : 'Connect'}</span>
        </button>
      </div>

      <div className="local-player-status">
        <span className={`local-status-dot ${state.ready ? 'is-on' : ''}`} aria-hidden="true" />
        <span>{state.ready ? 'Connected' : 'Not connected'}</span>
        <span>Web SDK device: {state.ready ? 'connected' : 'not connected'}</span>
      </div>

      {state.error && <div className="player-error local-player-error" role="alert">{state.error}</div>}

      {state.track ? (
        <div className="player-now">
          <div className="player-art-wrap">
            {state.track.image
              ? <img className="player-art" src={state.track.image} alt="" loading="lazy" />
              : <div className="player-art player-art--empty" aria-hidden="true">♪</div>}
          </div>
          <div className="player-track-info">
            <p className="player-track-name">{state.track.name}</p>
            <p className="player-track-artist">{state.track.artist}</p>
            <p className="player-track-album">{state.track.album}</p>
            <div className="player-progress" role="progressbar"
                 aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}
                 style={{ position: 'relative' }}>
              <div className="player-progress-fill" style={{ width: `${percent}%` }} />
              <input
                type="range"
                min="0"
                max={Math.max(1, state.duration)}
                step="1"
                value={Math.min(state.position, Math.max(1, state.duration))}
                onChange={(event) => void seek(event.target.value)}
                disabled={!state.ready || state.duration <= 0}
                aria-label="Seek playback"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', margin: 0 }}
              />
            </div>
            <div className="player-progress-times">
              <span>{formatMs(state.position)}</span>
              <span>{formatMs(state.duration)}</span>
            </div>
            <p className="player-device">
              {state.playing ? 'Playing' : 'Paused'}
            </p>
          </div>
        </div>
      ) : (
        <p className="local-player-hint">
          {state.ready
            ? 'Ready. Use Spotify Connect or play from another device.'
            : 'Connecting to the Web SDK…'}
        </p>
      )}

      <div style={{ marginTop: '0.75rem' }}>
        <div className="local-controls">
          <button type="button" className="local-control-btn" onClick={() => void previous()} disabled={busy || !state.ready} aria-label="Previous track">
            ⏮
          </button>
          <button
            type="button"
            className="local-control-btn local-control-btn--main"
            onClick={() => void toggle()}
            disabled={busy || !state.ready || !state.track}
          >
            {state.playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="local-control-btn" onClick={() => void next()} disabled={busy || !state.ready} aria-label="Next track">
            ⏭
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.85rem' }}>
        <span className="local-player-sub">Volume</span>
        <input
          className="local-progress"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={state.volume}
          onChange={(e) => void changeVolume(e.target.value)}
          disabled={!state.ready}
          aria-label="Volume"
        />
      </div>

      {state.nextTracks.length > 0 && (
        <div className="local-upnext" style={{ marginTop: '0.85rem' }}>
          <div className="local-queue-head">
            <h3>Up next</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {state.nextTracks.slice(0, 5).map((track, index) => (
              <div key={`${track.uri}-${index}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {track.image && <img src={track.image} alt="" style={{ width: 32, height: 32, borderRadius: 3, objectFit: 'cover' }} />}
                <div style={{ minWidth: 0 }}>
                  <div className="text-sm text-ink truncate">{track.name}</div>
                  <div className="font-mono text-[0.6rem] text-muted truncate">{track.artist}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: '0.85rem' }}>
        <div className="local-player-foot">
          <span>Spotify devices</span>
          <button type="button" className="local-link" onClick={() => void loadDevices(false)} disabled={deviceBusy}>
            {deviceBusy ? 'Loading devices…' : 'Refresh devices'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
          <select
            className="filter-input"
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            disabled={deviceBusy || devices.length === 0}
            style={{ flex: 1, minWidth: 220, backgroundColor: '#181818', color: '#ffffff', borderColor: '#333333' }}
          >
            {devices.length === 0 ? <option value="">No devices loaded</option> : null}
            {devices.map((device) => (
              <option key={device.id} value={device.id} style={{ backgroundColor: '#181818', color: '#ffffff' }}>
                {device.name} ({device.type}){device.is_active ? ' - active' : ''}{device.is_restricted ? ' - restricted' : ''}
              </option>
            ))}
          </select>
          <button type="button" className="local-control-btn" onClick={() => void connectToDevice(selectedDeviceId)} disabled={deviceBusy || !selectedDeviceId}>
            Connect to device
          </button>
        </div>
      </div>

      {state.error && <div className="player-error local-player-error" role="alert">{state.error}</div>}
      {message && <div className="local-player-hint">{message}</div>}
    </section>
  );
};