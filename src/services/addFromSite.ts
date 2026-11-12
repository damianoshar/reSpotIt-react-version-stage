import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AddFromSiteBrowserResult {
  ids: string[];
  url: string;
  /** Rendered page text, only set by a concerts/page-mode snapshot. */
  text?: string;
  cancelled?: boolean;
}

interface Plugin {
  open(options: { url?: string; mode?: 'albums' | 'concerts' | 'page' | 'tracks' }): Promise<AddFromSiteBrowserResult>;
}

const plugin = registerPlugin<Plugin>('AddFromSite');

export function isNativeApp(): boolean {
  return Capacitor.getPlatform() !== 'web';
}

export async function openAddFromSiteBrowser(url: string): Promise<AddFromSiteBrowserResult | null> {
  if (!isNativeApp()) return null;
  return await plugin.open({ url });
}

/**
 * Open the in-app browser in concerts mode and capture the rendered page text.
 * A server-side fetch cannot run the page's JavaScript, so JS-built listings
 * (Songkick, Bandsintown) look empty there; this returns what the user sees.
 */
export async function openConcertPageSnapshot(
  url: string,
): Promise<{ url: string; text: string } | null> {
  if (!isNativeApp()) return null;
  const res = await plugin.open({ url, mode: 'concerts' });
  if (!res || res.cancelled) return null;
  return { url: res.url ?? '', text: res.text ?? '' };
}

/**
 * Same rendered-page capture for album listings (label reads "Scan albums").
 * Feeds the captured text to /api/v1/llm/extract-albums instead of a URL fetch,
 * so JS-built album pages work too.
 */
export async function openAlbumPageSnapshot(
  url: string,
): Promise<{ url: string; text: string } | null> {
  if (!isNativeApp()) return null;
  const res = await plugin.open({ url, mode: 'page' });
  if (!res || res.cancelled) return null;
  return { url: res.url ?? '', text: res.text ?? '' };
}

/**
 * Same rendered-page capture for tracklists (the native button reads
 * "Scan tracks"). Feeds the captured text to /api/v1/llm/extract-tracks.
 */
export async function openTrackPageSnapshot(
  url: string,
): Promise<{ url: string; text: string } | null> {
  if (!isNativeApp()) return null;
  const res = await plugin.open({ url, mode: 'tracks' });
  if (!res || res.cancelled) return null;
  return { url: res.url ?? '', text: res.text ?? '' };
}