import React, { useState, useEffect } from 'react';
import { ServerAuth } from '../hooks/useServerAuth';

interface Props {
  auth: ServerAuth;
  onBack?: () => void;
}

// ---------------------------------------------------------------------------
// Spotify-link step for media-server mode. Opens the server-issued Spotify
// authorize URL in a system browser/Custom Tab; the server callback links
// the account, and this screen polls until the link lands (no deep-link
// setup required — the user just returns here after approving).
// ---------------------------------------------------------------------------
export const SpotifyLinkScreen: React.FC<Props> = ({ auth, onBack }) => {
  const [opening,  setOpening]  = useState(false);
  const [checking, setChecking]  = useState(false);
  const [linkErr,  setLinkErr]  = useState('');

  // Poll while waiting for approval — stops automatically once linked.
  useEffect(() => {
    if (auth.spotify.connected) return;
    const t = setInterval(() => {
      auth.refreshSpotifyStatus().catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [auth]);

  const openLink = async () => {
    setOpening(true); setLinkErr('');
    try { await auth.openSpotifyLink(); }
    catch (e: any) { setLinkErr(e?.message ?? 'Could not open Spotify login'); }
    finally { setOpening(false); }
  };

  const checkNow = async () => {
    setChecking(true); setLinkErr('');
    try { await auth.refreshSpotifyStatus(); }
    catch (e: any) { setLinkErr(e?.message ?? 'Check failed'); }
    finally { setChecking(false); }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        {onBack && (
          <button className="link-btn" onClick={onBack}
                  style={{ alignSelf: 'flex-start', marginBottom: '0.5rem' }}>
            ← Use this device instead
          </button>
        )}

        <svg className="login-logo" viewBox="0 0 64 64" fill="none" aria-label="reSpotIt">
          <rect width="64" height="64" rx="16" fill="#1DB954" />
          <text x="32" y="43" text-anchor="middle" font-size="34" font-weight="700" fill="#000" font-family="Arial, sans-serif">RS</text>
        </svg>

        <h1 className="login-title">Connect Spotify</h1>
        <p className="login-subtitle">
          Link your Spotify account so the server can sync your saved albums.
          After approving in the browser, return here — the link is detected automatically.
        </p>

        {linkErr && (
          <div className="sync-error" role="alert" style={{ marginBottom: '1rem' }}>
            ⚠ {linkErr}
          </div>
        )}

        <button className="login-btn" onClick={openLink} disabled={opening}>
          {opening ? 'Opening…' : 'Open Spotify login'}
        </button>

        <button className="sync-btn sync-btn--ghost full-width" style={{ marginTop: '0.6rem' }}
                onClick={checkNow} disabled={checking}>
          {checking ? 'Checking…' : 'I’ve approved — check now'}
        </button>

        {onBack && (
          <button className="sync-btn sync-btn--ghost full-width" style={{ marginTop: '0.4rem' }}
                  onClick={onBack}>
            Use this device instead
          </button>
        )}

        <p className="login-note">
          Signed in{auth.user ? ' as ' + auth.user.email : ''}.{' '}
          <button className="link-btn" onClick={() => auth.logout()}>
            Use a different account
          </button>
        </p>
      </div>
    </div>
  );
};
