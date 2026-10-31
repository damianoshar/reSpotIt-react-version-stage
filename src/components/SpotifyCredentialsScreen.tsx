import React, { useEffect, useState } from 'react';
import {
  loadSpotifyCredentials,
  getSpotifyClientId,
  getSpotifyClientSecret,
  hasSpotifyCredentials,
  saveSpotifyCredentials,
} from '../services/SpotifyCredentialsService';

interface Props {
  onBack?: () => void;
  onSaved?: () => void;
}

export const SpotifyCredentialsScreen: React.FC<Props> = ({ onBack, onSaved }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      await loadSpotifyCredentials();
      setClientId(getSpotifyClientId());
      setClientSecret(getSpotifyClientSecret());
    })();
  }, []);

  const canSave = clientId.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      await saveSpotifyCredentials(clientId, clientSecret);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        {onBack && (
          <button className="link-btn" onClick={onBack}
                  style={{ alignSelf: 'flex-start', marginBottom: '0.5rem' }}>
            ← Back
          </button>
        )}
        <h1 className="login-title">Spotify credentials</h1>
        <p className="login-subtitle">
          Enter your own Spotify app credentials. Create an app at developer.spotify.com/dashboard.
        </p>

        <input className="form-input" style={{ marginBottom: '0.6rem', width: '100%' }}
               type="text" placeholder="Spotify Client ID (required)"
               value={clientId} onChange={(e) => setClientId(e.target.value)} />
        <input className="form-input" style={{ marginBottom: '1rem', width: '100%' }}
               type="password" placeholder="Spotify Client Secret (optional)"
               value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />

        <button className="login-btn" onClick={save} disabled={busy || !canSave}>
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>

        <p className="login-note" style={{ marginTop: '1rem' }}>
          Your credentials are stored locally on this device only and never committed to source control.
          A single shared client_id is not permitted (Spotify ToS).
        </p>
      </div>
    </div>
  );
};
