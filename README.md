# reSpotIt — Android App (React)

## About

reSpotIt was built to fill gaps in Spotify's library management. It is an album-centric tool that lets you organize your library and playlists using rich filters, add entire artist discographies to your library or turn them into playlists, import album links from any website, and build queues from albums you are listening to right now. This is a work in progress — expect rough edges and things that may not work yet.

### reSpotIt Project Structure

reSpotIt is a multi-component project with several variants:

- **Local Server (standalone)** — Python/FastAPI backend + React web frontend + PostgreSQL. Runs entirely on your machine. No AI assistant. See `reSpotIt-local-server-app`.
- **Local Server + AI assistant** — Same server plus OpenWebUI, Keycloak, and MCP services for AI-powered library queries. See `reSpotIt-local-server-app` (full stack overlay) or `reSpotIt-local-server-app-clean-backup-2`.
- **Kotlin client** — Native Android app (Kotlin + Jetpack Compose). Full feature parity with media-server mode. See `reSpotIt-kotlin-version`.
- **React clients** — Capacitor/TypeScript Android apps. Offer better compatibility on older Android models and low-RAM devices than the Kotlin client. Two variants:
  - **Standard** (this repo, `main` branch) — Web Playback SDK for browser-based playback.
  - **Librespot** (`feat/librespot-player` branch) — Experimental on-device full-track playback via Rust/JNI. Only this variant supports on-device audio.

This app is the **React client (standard)** — runs on older Android devices where the Kotlin app may not.

> **Standalone mode:** This app works fully offline without any server. All library data is stored on-device (SQLite). Media-server mode is optional — enable it in Settings to sync, push/pull, and use the AI assistant.

**Repository:** https://github.com/damianoshar/reSpotIt-react-version-stage (branch: `main` / `feat/https-media-server`)

**Librespot variant (experimental on-device playback):** same repo, branch `feat/librespot-player`

---

## 📥 Installation

Download the latest APK from the [releases page](https://github.com/damianoshar/reSpotIt-react-version-stage/releases/tag/v0.1.0).

1. Download the APK.
2. Install on your Android device (enable 'Install unknown apps' if needed).
3. Open the app and sign in with your Spotify account.
4. (Optional) Configure your own Spotify credentials in Settings.

---

## 🛠 Build from Source

### Prerequisites
- Node.js 18+
- Android Studio (for Android SDK/emulator)
- Spotify Developer account

### 1 — Install dependencies
```bash
npm install
```

### 2 — Add Android platform
The `capacitor.config.json` is already included — skip `cap init`.
```bash
npx cap add android
```

### 3 — Apply Android patches
```bash
# Complete AndroidManifest (includes Spotify callback intent filter)
cp android-patches/AndroidManifest.xml \
   android/app/src/main/AndroidManifest.xml

# MainActivity (registers plugins)
cp android-patches/app/src/main/kotlin/com/spotifydashboard/app/MainActivity.kt \
   android/app/src/main/java/com/spotifydashboard/app/MainActivity.kt

# Network security config
mkdir -p android/app/src/main/res/xml
cp android-patches/app/src/main/res/xml/network_security_config.xml \
   android/app/src/main/res/xml/network_security_config.xml
```

### 4 — Build & sync
```bash
npm run build
npx cap sync android
```

### 5 — Run
```bash
npx cap open android
# Press Run or Build -> Build APK(s)
```

---

## 🔐 Spotify Developer Setup (do this first)

1. Go to https://developer.spotify.com/dashboard and create an app
2. In your app settings, add this **Redirect URI** (exact string):
   ```
   com.spotifydashboard.app://callback
   ```
3. Enter your **Client ID** in the app settings.
4. Under "APIs used", enable **Web API**

> **Note:** Since Nov 2025 Spotify requires PKCE — implicit grant is removed.
> This app uses the PKCE Authorization Code flow as required.

---

## 🎮 Features

- **Album-centric library** — Rich filters (genre, artist, year, decade, popularity)
- **Playlist management** — Create, edit, reorder, duplicate detection
- **Queue builder** — Build playback queues from albums
- **CSV import/export** — Add albums from any website, backup your library
- **Media-server mode** — Connect to reSpotIt backend over HTTPS for sync, push/pull, AI assistant
- **AI assistant** — Ask questions about your library via local LLM (requires media server)

---

## ⚙️ Player Limitations

- Uses Spotify's official Web Playback SDK (browser-based). Requires Spotify Premium and the `streaming` scope.
- No buffer/quality settings available in the Web Playback SDK.
- On-device playback is not supported; playback runs on a Spotify Connect device or the browser.
- The optional librespot variant (branch `feat/librespot-player`) provides experimental on-device playback.

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

---

## 📦 Project Structure

```
src/
├── config/
│   └── spotify.ts              ← Client ID + scopes + redirect URI
├── services/
│   ├── SpotifyAuthService.ts   ← PKCE flow, token exchange, refresh, storage
│   ├── SpotifyApiService.ts    ← Fetch saved albums + artist genres (paginated)
│   ├── DatabaseService.ts      ← SQLite CRUD
│   └── SyncService.ts          ← CSV import + image download
├── hooks/
│   ├── useSpotifyAuth.ts       ← Auth state (loading/unauthed/authed)
│   └── useLibrary.ts           ← Albums, filters, sync orchestration
├── components/
│   ├── LoginScreen.tsx         ← Spotify connect screen
│   ├── Header.tsx              ← App bar + sync + logout
│   ├── StatsBar.tsx
│   ├── FilterBar.tsx
│   ├── AlbumGrid.tsx
│   ├── AlbumCard.tsx
│   ├── SyncModal.tsx           ← Two tabs: Spotify sync + CSV import
│   └── EmptyState.tsx
└── styles/global.css

android-patches/
├── AndroidManifest.xml         ← Drop-in replacement (has callback intent filter)
├── app/src/main/kotlin/…/MainActivity.kt
└── app/src/main/res/xml/network_security_config.xml
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
```

---

## 🎯 Web Playback SDK Diagnostic

The app includes a separate, opt-in Web Playback SDK diagnostic in Settings. It uses Spotify's official browser SDK and requires Premium plus the `streaming` scope. It does not replace the existing on-device player, and `PlayerView.tsx` remains unchanged.

---

## 🔑 Spotify Credentials

The app ships with a built-in reSpotIt Spotify Client ID. To use your own, open 'Configure Spotify credentials' on the login screen and enter your Client ID (and Client Secret for server flows). Alternatively set `VITE_SPOTIFY_CLIENT_ID` in `.env` before building.