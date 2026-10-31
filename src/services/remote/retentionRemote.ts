import { apiFetch } from './apiClient';

// append these functions to existing file. Note: we are creating a separate shim to avoid duplicate defaults.
export interface RemoteRetention { playlist_id: string; expires_at: string | null; keep_forever: boolean; last_error: string | null; }
export async function listRemoteRetention(base: string): Promise<RemoteRetention[]> {
  const data = await apiFetch<{ items: RemoteRetention[] }>(base, '/api/v1/playlists/retention');
  return data.items ?? [];
}
export async function setRemoteRetention(base: string, playlistId: string, expiresAt: string): Promise<void> {
  await apiFetch(base, `/api/v1/playlists/${encodeURIComponent(playlistId)}/retention`, { method: 'PUT', body: { expires_at: expiresAt } });
}
export async function keepRemotePlaylist(base: string, playlistId: string): Promise<void> {
  await apiFetch(base, `/api/v1/playlists/${encodeURIComponent(playlistId)}/retention`, { method: 'DELETE' });
}
export async function deleteRemotePlaylistNow(base: string, playlistId: string): Promise<void> {
  await apiFetch(base, `/api/v1/playlists/${encodeURIComponent(playlistId)}/retention/delete-now`, { method: 'POST' });
}
