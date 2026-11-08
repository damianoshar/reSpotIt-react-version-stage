import { apiFetch } from './apiClient';

// ---------------------------------------------------------------------------
// Remote concert scans — click-and-forget AI extraction.
//
// POST starts a background scan and returns immediately. The server streams
// progress into an Open WebUI chat and stores the extracted rows on the scan.
// Returning to the Concerts dialog reads GET /latest and shows the pending
// results for review (nothing is saved until the user confirms).
// ---------------------------------------------------------------------------

export interface RemoteConcertScanItem {
  artist: string;
  date:   string;
  venue:  string;
  url:    string;
}

export type RemoteConcertScanStatus = 'running' | 'ready' | 'error';

export interface RemoteConcertScan {
  id:          string;
  source:      string;
  source_url:  string;
  source_kind: string;
  status:      RemoteConcertScanStatus | string;
  stage:       string;
  message:     string;
  items:       RemoteConcertScanItem[];
  error:       string;
  chat_id:     string;
  created_at:  string | null;
  updated_at:  string | null;
}

export async function startRemoteConcertScan(
  base: string,
  input: { url?: string; text?: string },
): Promise<RemoteConcertScan> {
  const body: { url?: string; text?: string } = {};
  if (input.url?.trim()) body.url = input.url.trim();
  if (input.text?.trim()) body.text = input.text.trim();
  return apiFetch<RemoteConcertScan>(base, '/api/v1/concert-scans', {
    method: 'POST',
    body,
  });
}

export async function getLatestRemoteConcertScan(base: string): Promise<RemoteConcertScan | null> {
  const data = await apiFetch<{ scan: RemoteConcertScan | null }>(
    base, '/api/v1/concert-scans/latest',
  );
  return data?.scan ?? null;
}

export async function getRemoteConcertScan(base: string, id: string): Promise<RemoteConcertScan | null> {
  return apiFetch<RemoteConcertScan>(base, `/api/v1/concert-scans/${encodeURIComponent(id)}`);
}

export async function deleteRemoteConcertScan(base: string, id: string): Promise<void> {
  await apiFetch(base, `/api/v1/concert-scans/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
