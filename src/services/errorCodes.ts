// ---------------------------------------------------------------------------
// Contract error codes -> user-facing wording.
//
// Every backend answers the same condition with the same machine-readable code
// (API-PARITY-PLAN.md §2), so apps pick their wording from the CODE rather than
// the server's message text. That is what makes a screen read the same whether
// it is talking to Elixir, FastAPI or .NET -- previously each backend produced
// its own wording, and one frontend even string-matched on the message.
//
// Deliberately structural: it never imports ApiError, so the same file works in
// trees whose client throws a richer or a plainer error object.
// ---------------------------------------------------------------------------

export const REMOTE_ERROR_HINTS: Record<string, string> = {
  not_connected:    'Connect your Spotify account first.',
  no_albums:        'Select at least one album.',
  unauthorized:     'Your session expired — sign in again.',
  already_running:  'A job is already running. Wait for it to finish.',
  token_error:      'Your Spotify session expired — reconnect the account.',
  bad_gateway:      'Spotify could not be reached. Try again in a moment.',
  validation_error: 'The server rejected that request.',
  not_found:        'Not found on the server.',
  internal_error:   'The server hit an unexpected error.',
};

interface RemoteLikeError {
  code?: unknown;
  status?: unknown;
  message?: unknown;
}

function asErrorLike(err: unknown): RemoteLikeError | null {
  return typeof err === 'object' && err !== null ? (err as RemoteLikeError) : null;
}

/** The contract error code carried by a rejected remote call, if any. */
export function remoteErrorCode(err: unknown): string | undefined {
  const code = asErrorLike(err)?.code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

/** True when the failure means "no Spotify account is linked". */
export function isSpotifyNotConnected(err: unknown): boolean {
  return remoteErrorCode(err) === 'not_connected';
}

/**
 * Message to show for a failed remote call: the canonical wording for the code
 * when we know it, otherwise the server's own message, otherwise `fallback`.
 */
export function describeRemoteError(err: unknown, fallback: string): string {
  const code = remoteErrorCode(err);
  if (code && REMOTE_ERROR_HINTS[code]) return REMOTE_ERROR_HINTS[code];

  const message = asErrorLike(err)?.message;
  if (typeof message === 'string' && message.trim().length > 0) return message;

  return fallback;
}
