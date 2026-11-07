import React from 'react';

interface Props {
  onLogin: () => void;
  error:   string | null;
  onConfigure?: () => void;
}

export const LoginScreen: React.FC<Props> = ({ onLogin, error, onConfigure }) => (
  <div className="login-screen">
    <div className="login-card">
      <img className="login-logo" src="/icon-192x192.png" alt="reSpotIt" width="64" height="64" style={{ borderRadius: 16 }} />

      <h1 className="login-title">reSpotIt</h1>
      <p  className="login-subtitle">
        Sign in with your Spotify account to load and browse your saved album library.
      </p>

      {error && (
        <div className="sync-error" role="alert" style={{ marginBottom: '1rem' }}>
          ⚠ {error}
        </div>
      )}

      <button className="login-btn" onClick={onLogin}>
        Connect with Spotify
      </button>

      <button className="link-btn" onClick={onConfigure} style={{ marginTop: '0.5rem' }}>
        Configure Spotify credentials
      </button>

      <p className="login-note">
        Requires a free or premium Spotify account.<br />
        Only <strong>read</strong> access to your saved library is requested.
      </p>
    </div>
  </div>
);
