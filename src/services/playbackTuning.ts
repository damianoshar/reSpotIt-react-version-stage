import { Capacitor, registerPlugin } from '@capacitor/core';

// ---------------------------------------------------------------------------
// Android playback tuning
//
// Old / low-RAM phones throttle the WebView when the app is not exempt from
// battery optimisation, and they dim+lock the screen while audio is still
// decrypting in software. Both make the Web Playback SDK's pipeline underrun,
// which shows up as a track jumping forward. This plugin only asks the user to
// switch those protections off; it never changes them silently.
// ---------------------------------------------------------------------------

export interface PlaybackTuningStatus {
  /** False while Android is still free to throttle the app in the background. */
  ignoringBatteryOptimizations: boolean;
  keepScreenOn: boolean;
  sdkInt: number;
}

interface PlaybackTuningPlugin {
  getStatus(): Promise<PlaybackTuningStatus>;
  requestIgnoreBatteryOptimizations(): Promise<{
    requested: boolean;
    ignoringBatteryOptimizations: boolean;
  }>;
  setKeepScreenOn(options: { on: boolean }): Promise<{ keepScreenOn: boolean }>;
}

const plugin = registerPlugin<PlaybackTuningPlugin>('PlaybackTuning');

export function isPlaybackTuningAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('PlaybackTuning');
}

export async function getPlaybackTuningStatus(): Promise<PlaybackTuningStatus> {
  if (!isPlaybackTuningAvailable()) {
    // Web builds have nothing to tune; report "already unrestricted".
    return { ignoringBatteryOptimizations: true, keepScreenOn: false, sdkInt: 0 };
  }
  return plugin.getStatus();
}

/** Opens the system dialog asking the user to allow unrestricted battery use. */
export async function requestBatteryOptimizationExemption(): Promise<boolean> {
  if (!isPlaybackTuningAvailable()) return true;
  const result = await plugin.requestIgnoreBatteryOptimizations();
  return Boolean(result.ignoringBatteryOptimizations);
}

export async function setKeepScreenOn(on: boolean): Promise<void> {
  if (!isPlaybackTuningAvailable()) return;
  await plugin.setKeepScreenOn({ on });
}
