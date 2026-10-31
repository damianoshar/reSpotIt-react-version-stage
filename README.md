# reSpotIt — Android App

## About

reSpotIt was built to fill gaps in Spotify's library management. It is an album-centric tool that lets you organize your library and playlists using rich filters, add entire artist discographies to your library or turn them into playlists, import album links from any website, and build queues from albums you are listening to right now. This is a work in progress — expect rough edges and things that may not work yet.

Standalone Android app for browsing your saved Spotify album library.
React 18 + Vite + Capacitor 6 + on-device SQLite. No backend required.

---

## ⚙️ Spotify Developer Setup (do this first)
#
1. Go to https://developer.spotify.com/dashboard and create an app
2. In your app settings, add this **Redirect URI** (exact string):
   ```
   com.spotifydashboard.app://callback
   ```
3. Copy your **Client ID** and paste it into:
   ```
   src/config/spotify.ts  →  SPOTIFY_CLIENT_ID = 'your_client_id_here'
   ```
4. Under "APIs used", enable **Web API**

> **Note:** Since Nov 2025 Spotify requires PKCE — implicit grant is removed.
> This app uses the PKCE Authorization Code flow as required.

---

## 🚀 Setup

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

### 4 - Build & sync
```bash
npm run build
npx cap sync android
```

### 5 - Run
```bash
npx cap open android
# Press Run or Build -> Build APK(s)
```

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

## Web Playback SDK diagnostic (separate path)

The app now includes a separate, opt-in Web Playback SDK diagnostic in Settings. It uses Spotify's official browser SDK and requires Premium plus the `streaming` scope. It does not replace the existing on-device player, and `PlayerView.tsx` remains unchanged.


## Browser playback

The TypeScript app's browser playback uses Spotify's official Web Playback SDK through the separate diagnostic path in Settings. It does not use the WASM librespot experiment, which remains blocked and uncommitted.


## Spotify credentials

The app ships with a built-in reSpotIt Spotify Client ID. To use your own, open 'Configure Spotify credentials' on the login screen and enter your Client ID (and Client Secret for server flows). Alternatively set VITE_SPOTIFY_CLIENT_ID in .env before building.


## Installation

Download the latest APK from the [releases page](https://github.com/damianoshar/reSpotIt-react-version-stage/releases/tag/v0.1.0).

1. Download the APK.
2. Install on your Android device (enable 'Install unknown apps' if needed).
3. Open the app and sign in with your Spotify account.
4. (Optional) Configure your own Spotify credentials in Settings.


## Player limitations

- The React app uses Spotify's official Web Playback SDK (browser-based). Requires Spotify Premium and the streaming scope.
- No buffer/quality settings are available in the Web Playback SDK.
- On-device playback is not supported in the React app; playback runs on a Spotify Connect device or the browser.
- The optional librespot variant (separate branch) provides on-device playback but is experimental and not merged to main.