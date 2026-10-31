import React, { useEffect, useState } from 'react';
import { ServerAuth } from '../hooks/useServerAuth';
import { normalizeServerUrl } from '../config/server';

interface Props {
  auth: ServerAuth;
  serverUrl: string;
  onSetServerUrl: (url: string) => void;
  onBack?: () => void;
}

// ---------------------------------------------------------------------------
// Server login / connection screen for media-server (remote) mode.
// In single-owner mode (Python) this only appears when the server is
// unreachable or returns an account-style error; the account form is kept as
// an advanced fallback for Elixir/C# backends.
// ---------------------------------------------------------------------------
export const ServerLoginScreen: React.FC<Props> = ({ auth, serverUrl, onSetServerUrl, onBack }) => {
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [mode,     setMode]     = useState<'login' | 'register'>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [urlDraft, setUrlDraft] = useState(serverUrl);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Keep the editable address in sync when the parent saves a new URL.
  useEffect(() => setUrlDraft(serverUrl), [serverUrl]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'login') await auth.login(email, password);
      else await auth.register(email, password);
    } catch { /* error already in auth.error */ }
  };

  const saveServerUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const next = normalizeServerUrl(urlDraft);
    if (!/^https?:\/\//i.test(next)) {
      setUrlError('Include http:// or https:// in the server address.');
      return;
    }
    setUrlError(null);
    // Changing the URL re-runs the auth probe automatically. If it is already
    // the active URL, retry explicitly so the button still works.
    if (next === serverUrl) void auth.retry();
    else onSetServerUrl(next);
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

        <h1 className="login-title">Media server</h1>

        {auth.error && (
          <div className="sync-error" role="alert" style={{ marginBottom: '1rem', width: '100%' }}>
            ⚠ {auth.error}
          </div>
        )}

        {auth.error ? (
          <>
            <p className="login-subtitle">
              Can’t reach the media server. Check the address below, or use this device.
            </p>
          </>
        ) : (
          <>
            <p className="login-subtitle">
              {mode === 'login'
                ? 'Sign in to your library server to sync and browse remotely.'
                : 'Create a library-server account to get started.'}
            </p>

            {!showAccountForm ? (
              <button className="link-btn" onClick={() => setShowAccountForm(true)}
                      style={{ marginTop: '0.5rem' }}>
                Use a server account (advanced)
              </button>
            ) : (
              <>
                <form onSubmit={submit} style={{ width: '100%' }}>
                  <input className="form-input" style={{ marginBottom: '0.6rem' }}
                         type="email" autoComplete="email" required
                         placeholder="Email address"
                         aria-label="Email address"
                         value={email} onChange={(e) => setEmail(e.target.value)} />
                  <input className="form-input" style={{ marginBottom: '1rem' }}
                         type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                         required minLength={8}
                         placeholder={mode === 'login' ? 'Password' : 'Password (min. 8 characters)'}
                         aria-label="Password"
                         value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button className="login-btn" type="submit" disabled={auth.busy}>
                    {auth.busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
                  </button>
                </form>
                <p className="login-note">
                  {mode === 'login' ? (
                    <>No account yet?{' '}
                      <button className="link-btn" onClick={() => setMode('register')}>Create one</button>
                    </>
                  ) : (
                    <>Already have an account?{' '}
                      <button className="link-btn" onClick={() => setMode('login')}>Sign in</button>
                    </>
                  )}
                </p>
              </>
            )}
          </>
        )}

        <form onSubmit={saveServerUrl} style={{ width: '100%', marginTop: '1rem' }}>
          <label className="login-note" htmlFor="server-url"
                 style={{ display: 'block', textAlign: 'left', marginBottom: '0.35rem' }}>
            Server URL
          </label>
          <input
            id="server-url"
            className="form-input"
            style={{ marginBottom: '0.25rem' }}
            type="url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="http://192.168.1.28:8000"
            aria-label="Server URL"
            value={urlDraft}
            onChange={(e) => { setUrlDraft(e.target.value); setUrlError(null); }}
          />
          <p className="login-note" style={{ textAlign: 'left', margin: '0 0 0.6rem' }}>
            USB: http://127.0.0.1:8000 with adb reverse. Wi-Fi: use an HTTPS
            address — Android blocks cleartext HTTP to LAN addresses.
          </p>
          {urlError && (
            <div className="sync-error" role="alert" style={{ marginBottom: '0.6rem', width: '100%' }}>
              ⚠ {urlError}
            </div>
          )}
          <button className="login-btn" type="submit">
            Save and retry
          </button>
        </form>

        {onBack && (
          <button className="sync-btn sync-btn--ghost full-width" style={{ marginTop: '1rem' }}
                  onClick={onBack}>
            Use this device instead
          </button>
        )}
      </div>
    </div>
  );
};