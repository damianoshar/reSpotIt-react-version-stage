# reSpotIt — Android App (React + librespot)

## About

reSpotIt was built to fill gaps in Spotify's library management. It is an album-centric tool that lets you organize your library and playlists using rich filters, add entire artist discographies to your library or turn them into playlists, import album links from any website, and build queues from albums you are listening to right now. This is a work in progress — expect rough edges and things that may not work yet.

Standalone Android app for browsing your saved Spotify album library, built with **React 18 + Vite + Capacitor 6 + on-device SQLite**, plus an **experimental on-device librespot player** (Rust + JNI). No backend required — the library lives in the phone's SQLite database.

- **UI:** React 18 + TypeScript 5.4, Vite 5
- **Shell:** Capacitor 6 (Android)
- **Storage:** `@capacitor-community/sqlite` + `jeep-sqlite`, `sql.js` for the browser
- **Native audio:** Rust librespot 0.8 core → Kotlin JNI bridge → `AudioTrack` (44.1 kHz stereo S16), driven by a Capacitor plugin
- **Auth:** OAuth 2.0 PKCE against Spotify (no SDK dependency)
- **Media-server mode:** optional HTTPS client for a reSpotIt server (`/api/v1`)
- **Toolchain:** Node 18+, JDK 17, Gradle 8.2.1 (wrapper), Rust + `cargo-ndk` + NDK 26.2 for the native player, compileSdk/targetSdk 34, minSdk 24 (Android 7.0)
- **App id:** `com.spotifydashboard.app` + `applicationIdSuffix ".ts"` → installs as **`com.spotifydashboard.app.ts`**

### reSpotIt Project Structure

reSpotIt is a multi-component project with several variants:

- **Local Server (standalone)** — Python/FastAPI backend + React web frontend + PostgreSQL. Runs entirely on your machine. No AI assistant. See `reSpotIt-local-server-app`.
- **Local Server + AI assistant** — Same server plus OpenWebUI, Keycloak, and MCP services for AI-powered library queries. See `reSpotIt-local-server-app` (full stack overlay) or `reSpotIt-local-server-app-clean-backup-2`.
- **React clients** (this repo) — Capacitor/TypeScript Android apps. Offer better compatibility on older Android models and low-RAM devices than the Kotlin client. Two variants:
  - **Standard** (`main` branch, see `reSpotIt-react-version`) — Web Playback SDK for browser-based playback.
  - **Librespot** (this repo, branch `feat/librespot-player`) — Experimental on-device full-track playback via Rust/JNI. **Only this variant ships the on-device audio UI.**
- **Kotlin client** — Native Android app (Kotlin + Jetpack Compose). Full feature parity with media-server mode. See `reSpotIt-kotlin-version`.

This app is the **React client (librespot)** — it runs on older Android devices and provides experimental on-device full-track playback.

> **Standalone mode:** this app works fully offline without any server. All library data is stored on-device (SQLite). Media-server mode is optional — enable it in Settings to sync, push/pull, and use the AI assistant.

**Repository:** https://github.com/damianoshar/reSpotIt-react-version-stage (branch: `feat/librespot-player`)

---

## 📥 Installation

Download the latest APK from the [releases page](https://github.com/damianoshar/reSpotIt-react-version-stage/releases/tag/v1.0.0-librespot).

1. Download the APK.
2. Install on your Android device (enable "Install unknown sources" if needed).
3. Open the app and sign in with your Spotify account.
4. (Optional) Configure your own Spotify credentials, or the media-server URL, in Settings.

> **Note:** this client installs as `com.spotifydashboard.app.ts`. The Kotlin app is `com.spotifydashboard.app`, so both can be installed side by side. The two React variants share the same id — uninstall one before installing the other.

---

## 🛠 Build from Source

### Prerequisites
- Node.js 18+
- JDK 17 + Android SDK (platform 34, build-tools 34.0.0)
- Android Studio (optional — the CLI works)
- **Rust toolchain + `cargo-ndk` + Android NDK 26.2** (only if you rebuild the native player)
- Spotify Developer account

### 1 — Install dependencies
```bash
npm install
```

### 2 — Build the web bundle and sync Capacitor
```bash
npm run sync        # = npm run build (tsc --noEmit && vite build) && npx cap sync android
```

> **Note:** the `android/` platform is **already committed** to this repository. Do **not** run `npx cap add android` — Capacitor refuses to add a platform that already exists.
> There is **no `android-patches/` folder** here: the manifest, `MainActivity` and the network security config are already in place under `android/app/src/main/`.

### 3 — Build the native librespot player (only if the `.so` files are missing)
```powershell
$env:PATH = "C:\Users\Damianos\.cargo\bin;$env:PATH"
$env:ANDROID_NDK_HOME = "C:\Users\Damianos\AppData\Local\Android\Sdk\ndk\26.2.11394342"
Set-Location native/audio-librespot/rust
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86 -t x86_64 --platform 24 `
  -o ../src/main/jniLibs build --release
```

Output: `native/audio-librespot/src/main/jniLibs/<abi>/libspotify_librespot.so` (git-ignored). All four ABIs are needed for the phone/tablet matrix — `armeabi-v7a` (older Neffos/Lenovo), `arm64-v8a` (TCL/Xiaomi and most modern phones), `x86`/`x86_64` (emulators).

`cargo build --target aarch64-linux-android` alone is **not** enough: it neither produces the JNI-wrapped library nor populates `jniLibs`.

### 4 — Build the APK
```bash
cd android
./gradlew assembleDebug      # -> android/app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease    # -> android/app/build/outputs/apk/release/app-release.apk
```

### 5 — Run in the IDE
```bash
npm run open:android         # = npx cap open android
# Press Run, or Build -> Build APK(s)
```

---

## 🔐 Release signing

Signing is opt-in through a **gitignored** properties file at `android/keystore.properties`:

```properties
storeFile=app-release.keystore
storePassword=…
keyAlias=…
keyPassword=…
```

- If the file exists, the `release` build type uses it; otherwise Gradle falls back to **debug signing** (installs fine, but the key differs from the signed release on the device).
- `android/keystore.properties` and `*.keystore` are gitignored — never commit them.
- CI (`.github/workflows/release.yml`) decodes the keystore from the `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets, runs `npm ci` → `npm run build` → `npx cap sync android` → `./gradlew assembleRelease`, uploads the APK as an artifact and publishes it to the GitHub release for `v*` tags.

---

## ⚙️ Spotify Developer Setup (do this first)

1. Go to https://developer.spotify.com/dashboard and create an app.
2. In your app settings, add this **Redirect URI** (exact string):
   ```
   com.spotifydashboard.app://callback
   ```
3. Under "APIs used", enable **Web API**.
4. Provide the **Client ID** either:
   - in the app: login screen → **Configure Spotify credentials** (Client ID, plus Client Secret for server flows), or
   - at build time: `VITE_SPOTIFY_CLIENT_ID` in `.env` (see `src/config/spotify.ts`).

> **Note:** Since Nov 2025 Spotify requires PKCE — implicit grant is removed. This app uses the PKCE Authorization Code flow as required.
> The app ships with a built-in reSpotIt client id; you only need your own if you want a different app registration.

---

## 🎮 Features

| Area | What it does |
|---|---|
| **Library tab** | Album grid / list / compact-grid views, search, rich filters (artist, title, year, genre, date added), sorting, selection toolbar, album track sheet, stats bar, sync sheet with progress |
| **Playlists tab** | Create, edit, delete and reorder Spotify playlists, add/remove albums, public/private visibility, playlist expiry (retention), local queue playlist, duplicates inside a playlist |
| **Tools tab** | Stats, Add from site (in-app browser), **Scan page with AI (albums)**, Scan concerts (AI) / add concert manually, concerts calendar, AI assistant, Playlist from Spotify search, Artist discography playlist, Find duplicate albums, Follow library artists |
| **Settings tab** | Media-server mode (server URL, sign-in, sync, push/pull), backup (auto-backup + subfolder), album grid size, sync photos, autohide bottom nav / search bar, CSV import & export, hidden (duplicate) albums, retention, Spotify credentials, sign out |
| **Player tab** | Now playing, queue, Spotify Connect devices, Web Playback SDK player, **experimental on-device librespot player** (`LocalPlaybackCard`) |

**Media-server mode** unlocks the AI assistant, the AI page scans and concerts, because the LLM runs on the server. Everything else works offline.

### AI page capture (albums)

`Tools → Scan page with AI (albums)` → paste a URL → **Open in browser and scan** loads the page in the app's own WebView (`AddFromSiteDialog`) → **Scan this page for albums (AI)** snapshots the rendered DOM. The captured text is posted to the media server (`POST /api/v1/llm/extract-albums`), which chunks long pages, extracts `(artist, album)` pairs with the local LLM and resolves them against Spotify.

The same browser offers **Scan this page for concerts (AI)** for concert pages.

---

## 🧪 Experimental librespot Playback

This variant embeds a real audio stack instead of streaming to a Connect device:

- **Rust core** — `native/audio-librespot/rust/` (librespot 0.8 + vendored identity/tempfile patches)
- **JNI bridge** — `native/audio-librespot/src/main/java/com/spotifydashboard/librespot/`:
  `LibrespotBridge.kt` → `LibrespotEngine.kt` → `PcmPlayer.kt` (44.1 kHz stereo S16 → `AudioTrack`)
- **Session/auth** — `LibrespotPlayback.kt`, `LibrespotAuth.kt`, `LibrespotCredentialsStore.kt`
- **App layer** — `playback/LocalPlaybackController.kt`, `playback/LocalPlaybackService.kt` (foreground media service)
- **Web bridge** — `LibrespotPlayerPlugin.kt` (`@CapacitorPlugin(name = "LibrespotPlayer")`), registered in `MainActivity.java`
- **Gradle wiring** — `android/settings.gradle` maps `:audio-librespot` to `../native/audio-librespot`; `android/app/build.gradle` depends on it

### Runtime behaviour

- The on-device card only appears when the native plugin is present (`isLocalPlaybackAvailable()` checks `Capacitor.isPluginAvailable('LibrespotPlayer')`), so the same web bundle also runs without the native libs.
- **First play** opens Spotify's consent page with the librespot desktop client id. The resulting reusable credentials are stored in the app's private SharedPreferences; later starts connect silently. "Forget account" removes them.
- **Full tracks require Spotify Premium.**
- The player registers as a **Spotify Connect device**. It is independent from the dashboard's Spotify login and does not change it.
- The player can be toggled off, kept connected between sessions, and driven from the album track sheet (play / queue next / queue end / queue album).

### Known gaps

Experimental: seek accuracy, gapless playback, background audio focus handling and battery behaviour on older devices are still rough. The Web Playback SDK path remains available as a fallback.

---

## ⚙️ Player Limitations

- The **Web Playback SDK** path is browser-based: it requires Spotify Premium and the `streaming` scope, and offers no buffer/quality settings.
- The **on-device librespot** path (this variant) plays full tracks locally, but see the known gaps above.
- The dashboard's own Spotify login and the librespot login are separate credentials.

---

## 🔐 Auth Flow (PKCE)

```
User taps "Connect with Spotify"
        ↓
Chrome Custom Tab opens Spotify login
        ↓
User approves → Spotify redirects to:
  com.spotifydashboard.app://callback?code=XXX&state=YYY
        ↓
Android intent filter catches deep link → App resumes
        ↓
App exchanges code + verifier for access + refresh tokens
        ↓
Tokens stored via @capacitor/preferences (survives app restarts)
        ↓
Auto-refresh when token expires (55 min cycle)
```

The PKCE verifier/state are written to `localStorage` **before** the browser opens, so a low-RAM device that kills the app in the background can still complete the callback when it is re-opened.

---

## 📦 Project Structure

```
src/
├── config/spotify.ts            ← Client ID, scopes, redirect URIs
├── App.tsx                      ← Root component, tab router, tool wiring
├── components/                  ← 36 components (35 + LocalPlaybackCard.tsx)
│   ├── LoginScreen.tsx / SpotifyCredentialsScreen.tsx / ServerLoginScreen.tsx
│   ├── Header.tsx / StatsBar.tsx / StatsPanel.tsx / FilterBar.tsx
│   ├── AlbumGrid.tsx / AlbumCard.tsx / AlbumTrackSheet.tsx / Artwork.tsx
│   ├── SyncModal.tsx / SyncProgress.tsx / SyncHistory.tsx
│   ├── PlaylistModal.tsx / PlaylistPicker.tsx / PlaylistDashboardView.tsx
│   ├── AddFromSiteDialog.tsx    ← in-app browser (WebView) + link/page snapshot
│   ├── AiUrlScanDialog.tsx      ← "Scan page with AI (albums)"
│   ├── ConcertsDialog.tsx / ConcertsListDialog.tsx
│   ├── AIAssistantDialog.tsx
│   ├── DuplicatesDialog.tsx / RetentionDialog.tsx / LinkHistory.tsx
│   ├── BackupPanel.tsx / ServerPanel.tsx / SettingsView.tsx
│   ├── PlayerView.tsx / WebPlaybackSdkPlayer.tsx
│   └── LocalPlaybackCard.tsx    ← on-device librespot player UI (this variant only)
├── services/
│   ├── librespotPlayer.ts       ← Capacitor bridge to LibrespotPlayerPlugin
│   ├── playbackTuning.ts        ← battery-optimisation / keep-screen-on prompts
│   ├── SpotifyAuthService.ts / SpotifyApiService.ts / SpotifyCatalogService.ts
│   ├── SpotifyPlaylistService.ts / SpotifyPlaylistFeedService.ts
│   ├── SpotifyPlaybackService.ts / WebPlaybackSdkService.ts
│   ├── DatabaseService.ts / PlaylistDatabaseService.ts / webSqlite.ts
│   ├── SyncService.ts / ExportService.ts / LLMService.ts / addFromSite.ts
│   ├── linkHistory.ts / PlaylistRetentionService.ts / QueuePlaylistStore.ts
│   ├── remote/                  ← media-server client (apiClient, libraryRemote,
│   │                              playlistRemote, concertsRemote, concertScansRemote,
│   │                              duplicatesRemote, retentionRemote, serverAuth, spotifyRemote)
│   └── storage/
├── hooks/                       ← useSpotifyAuth, useLibrary, useDataSource, useServerAuth,
│                                  usePlayerQueue, usePlaylistDashboard, useSelection,
│                                  useBackupSettings, useLocalPlayback, useToast
├── contexts/SyncPhotosContext.tsx
├── types/index.ts
├── utils/                       ← duplicateFinder, catalogDuplicates, playlistListOptions,
│                                  playlistPlayback, queueSnapshot, activeQueuePlanner, …
├── styles/global.css
└── config/spotify.ts

android/                          ← committed Capacitor project (57 files)
├── app/src/main/java/com/spotifydashboard/app/
│   ├── MainActivity.java        ← registers the Capacitor plugins (incl. LibrespotPlayerPlugin)
│   ├── AddFromSitePlugin.java   ← in-app browser bridge (link scan + page snapshot)
│   └── PlaybackTuningPlugin.java← battery-optimisation / keep-screen-on prompts
└── app/src/main/res/xml/network_security_config.xml

native/audio-librespot/           ← Rust/JNI module (Gradle project :audio-librespot)
├── rust/                        ← librespot 0.8 crate + vendor patches
├── src/main/java/com/spotifydashboard/librespot/
├── src/main/jniLibs/<abi>/libspotify_librespot.so   ← git-ignored build output
└── build.gradle
```

---

## 🗺️ Data Flow

```
Spotify Auth (PKCE)
      ↓
SpotifyApiService.fetchAllSavedAlbums()
  → GET /me/albums  (paginated, 50/page)
  → GET /artists?ids=…  (batch genre enrichment)
      ↓
SyncService.downloadAlbumImage()  →  Filesystem (cached)
      ↓
DatabaseService.upsertAlbum()     →  SQLite
      ↓
useLibrary → React UI

On-device playback:
  AlbumTrackSheet → services/librespotPlayer.ts → LibrespotPlayerPlugin (Capacitor)
      → LibrespotBridge → LibrespotEngine → PcmPlayer → AudioTrack
      ↘ LocalPlaybackService (foreground media service)

Media-server mode:
  Server (FastAPI)  ⇄  services/remote/*  →  SQLite (push/pull)
                              ↓
                    POST /api/v1/llm/extract-albums (AI page scan)
```

---

## 🧪 Tests & CI

```bash
npm test          # vitest run
```

12 test files cover the link history, playlist retention, Spotify API service, Spotify playlist service, the media-server API client and playlist remote client, plus the duplicate finder, catalogue duplicates, playlist list options, playlist playback, queue snapshot and active-queue planner helpers.

CI (`.github/workflows/release.yml`): JDK 17 + Node 20 → `npm ci` → `npm run build` → `npx cap sync android` → `./gradlew assembleRelease` → APK artifact + GitHub release on `v*` tags (debug-signed when no keystore secret is configured).

---

## 🔒 Security, CA trust & LAN access

- The media-server mode talks to a self-hosted server over **HTTPS on the LAN** (e.g. `https://192.168.1.11:8000`); the server certificate is usually issued by a private CA.
- `android/app/src/main/res/xml/network_security_config.xml` trusts the **system** and **user** CA stores and permits cleartext, so a user-installed CA (mkcert or your own) works out of the box:
  - Install the CA once on the phone: **Settings → Security → Install a certificate → CA certificate**, pick `rootCA.pem`.
  - The CA is long-lived, so this survives every server-cert reissue and every app update.
- **Personal/CI builds:** `android/app/src/personal/res/` (gitignored) overlays a trust anchor for the owner's local CA (`res/raw/respotit_ca.pem`) so the app reaches the self-hosted HTTPS server with no user CA install. Public/CI builds omit the overlay.
- The server certificate must cover the PC's LAN IP — reissue the leaf with the current IP in the SAN list (`scripts/local-certs.sh <ip>` in the server repo); no app rebuild is needed.
- **Firewall/port:** allow inbound TCP on the chosen port and forward Docker's published port to the LAN if it is bound to loopback only (`netsh interface portproxy`).
- The librespot credentials live in private SharedPreferences; `.env`, `android/keystore.properties` and `*.keystore` are gitignored. Tokens, audio keys and signed CDN URLs are never logged or committed.

---

## 🩺 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npx cap add android` fails | The platform is already committed | Do not add it — run `npm run sync` |
| App shows the old UI after a code change | The web bundle was not re-synced | `npm run sync` before building; verify the asset hash in `android/app/src/main/assets/public` |
| On-device player card is missing | The native plugin or the `.so` libraries are not in the APK | Build the Rust libs into `native/audio-librespot/src/main/jniLibs/<abi>/` and re-run `npm run sync` + `./gradlew assembleRelease` |
| "On this device" shows *Not connected* | The librespot consent login was never completed | Tap connect once and complete Spotify's consent page; Premium is required |
| Audio stops when the screen locks | The foreground media service was killed | Grant the notification permission and disable battery optimisation (Settings → playback tuning) |
| Playback jumps forward / underruns | Android throttling the WebView | Use the playback tuning prompts (disable battery optimisation, keep screen on) |
| `SSLHandshakeException` / cert warning on the server URL | The server cert does not cover the LAN IP, or the CA is not trusted on the phone | Reissue the leaf with the LAN IP in the SAN list; install the CA as a user certificate (or build with the `src/personal/res` overlay) |
| "Server unreachable" | Phone and PC on different networks, or the firewall blocks the port | Same Wi-Fi; `adb shell nc -w 3 <pc-ip> 8000`; add a firewall rule |
| AI scan spins for minutes | Album extraction is synchronous and chunked server-side; a CPU-only LLM is slow | Wait it out; the client uses a long read timeout for LLM calls. Check the server log for `/api/v1/llm/extract-albums` |
| Login returns to the app but nothing happens | Another app registered the `com.spotifydashboard.app://callback` scheme | Remove the conflicting handler |
| App killed in the background while logging in | Low-RAM device reclaimed the process | The PKCE state is persisted before the browser opens, so re-opening completes the flow |
| Album page scan finds nothing | The page renders its list lazily | Scroll the page before snapshotting, or use **Scan** to extract the links already present |
| Cannot install over the other React variant | Same application id (`com.spotifydashboard.app.ts`) | Uninstall the standard variant first |

---

## 🏷️ Versioning & changelog

- Release tags in this repo: `v0.1.0`, `v0.1.0-librespot`, `v0.1.1`, `v0.1.1-librespot`, `v1.0.0`, `v1.1.0-react`.
- Tagging `v*` runs `release.yml` and publishes a GitHub release with the APK.
- `versionName` / `versionCode` live in `android/app/build.gradle`.
- Per-feature notes live in the commit history (`git log --oneline`) and in the server repo's `EXPERIMENTAL_FEATURES.md`.
