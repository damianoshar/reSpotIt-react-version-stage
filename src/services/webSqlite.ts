/**
 * Web-platform bootstrap for @capacitor-community/sqlite.
 *
 * On the web platform the plugin routes everything through the `jeep-sqlite`
 * custom element (SQLite compiled to WASM, persisted to IndexedDB).
 * CapacitorSQLite.initWebStore() awaits `customElements.whenDefined('jeep-sqlite')`
 * and then looks the element up in the DOM — without this bootstrap that
 * promise never settles and every local query dies with
 * "Cannot read properties of undefined (reading 'query')".
 *
 * Native Capacitor (Android) uses the plugin's native implementation and never
 * reaches this code. The WASM binary is served from `public/assets/sql-wasm.wasm`
 * (sql.js 1.11.0 — the version jeep-sqlite 2.8.0 was built against; a newer
 * wasm fails to instantiate against its bundled glue with a LinkError).
 */
import { Capacitor } from '@capacitor/core';

let bootstrap: Promise<void> | null = null;

export function setupWebSqlite(): Promise<void> {
  if (Capacitor.getPlatform() !== 'web') return Promise.resolve();

  if (!bootstrap) {
    bootstrap = (async () => {
      // Append first, define second: the element upgrades on define(), and
      // initWebStore() may then find it with document.querySelector().
      if (!document.querySelector('jeep-sqlite')) {
        const el = document.createElement('jeep-sqlite');
        el.setAttribute('wasmPath', './assets'); // where sql-wasm.wasm is served from
        el.style.display = 'none';
        document.body.appendChild(el);
      }
      const { defineCustomElements } = await import('jeep-sqlite/loader');
      defineCustomElements(window);
    })().catch((err) => {
      bootstrap = null; // allow a retry on the next call
      throw err;
    });
  }
  return bootstrap;
}
