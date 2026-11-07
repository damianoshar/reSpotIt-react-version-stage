import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Root crash boundary — a render crash anywhere below shows a recovery
 * screen instead of a blank/dead app. No reporting backend exists, so the
 * error is logged to the console for diagnostics.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Uncaught UI error:', error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  private reload = () => window.location.reload();

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          role="alert"
          style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#121212',
            color: '#fff',
            padding: 24,
          }}
        >
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Something went wrong</h1>
            <p style={{ color: '#b3b3b3', fontSize: 14, margin: '0 0 8px' }}>
              The app hit an unexpected error. Your library data is safe —
              try again or reload.
            </p>
            <p
              style={{
                color: '#b3b3b3',
                fontSize: 12,
                fontFamily: 'monospace',
                overflowWrap: 'anywhere',
                margin: '0 0 24px',
              }}
            >
              {error.message}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={this.retry}
                style={{
                  padding: '10px 24px',
                  borderRadius: 999,
                  border: 'none',
                  background: '#1DB954',
                  color: '#000',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
              <button
                onClick={this.reload}
                style={{
                  padding: '10px 24px',
                  borderRadius: 999,
                  border: '1px solid #535353',
                  background: 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
