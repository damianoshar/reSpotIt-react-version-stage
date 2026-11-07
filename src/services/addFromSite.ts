import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AddFromSiteBrowserResult {
  ids: string[];
  url: string;
  cancelled?: boolean;
}

interface Plugin {
  open(options: { url?: string }): Promise<AddFromSiteBrowserResult>;
}

const plugin = registerPlugin<Plugin>('AddFromSite');

export function isNativeApp(): boolean {
  return Capacitor.getPlatform() !== 'web';
}

export async function openAddFromSiteBrowser(url: string): Promise<AddFromSiteBrowserResult | null> {
  if (!isNativeApp()) return null;
  return await plugin.open({ url });
}