// Data-source mode (local on-device DB vs network Docker server).
// Remote API contract: API-PARITY-PLAN.md §1 (identical calls on every backend).

export type DataSourceMode = 'local' | 'remote';

export interface DataSourceSettings {
  mode: DataSourceMode;
  serverUrl: string;
}

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8000';

export const DATA_SOURCE_PREFS_KEY = 'data_source';

export const DEFAULT_DATA_SOURCE: DataSourceSettings = {
  mode: 'local',
  serverUrl: DEFAULT_SERVER_URL,
};

export function normalizeServerUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

