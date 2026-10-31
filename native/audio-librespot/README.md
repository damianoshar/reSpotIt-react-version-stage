# Embedded librespot player for the TypeScript app

This is the Kotlin project's `audio-librespot` player, ported unchanged where
possible, with a Capacitor plugin wrapper (`LibrespotPlayerPlugin`) and the
app-level queue/foreground-service controller.

- Rust crate: `rust/` (librespot 0.8 + vendored identity/tempfile patches)
- JNI bridge: `LibrespotBridge.kt` -> `LibrespotEngine.kt`
- Audio output: `PcmPlayer.kt` (44.1 kHz stereo S16 -> AudioTrack)
- Session/auth: `LibrespotPlayback.kt`, `LibrespotAuth.kt`
- App layer: `playback/LocalPlaybackController.kt`,
  `playback/LocalPlaybackService.kt`
- Web bridge: `LibrespotPlayerPlugin.kt` (`@CapacitorPlugin(name = "LibrespotPlayer")`)

## Build the native libraries

From this directory:

```powershell
$env:PATH = "C:\Users\Damianos\.cargo\bin;$env:PATH"
$env:ANDROID_NDK_HOME = "C:\Users\Damianos\AppData\Local\Android\Sdk\ndk\26.2.11394342"
Set-Location rust
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86 -t x86_64 --platform 24 `
  -o ../src/main/jniLibs build --release
```

The output is `src/main/jniLibs/<abi>/libspotify_librespot.so` (git-ignored).
All four ABIs are needed for the phone/tablet matrix (armeabi-v7a for the
Neffos/Lenovo, arm64-v8a for the TCL/Xiaomi, x86/x86_64 for emulators).

## Android wiring

`android/settings.gradle` includes this directory as `:audio-librespot`, and
`android/app/build.gradle` depends on it. The generated `android/` folder is
git-ignored in this repository, so the `native/` module is the source of truth.

The first play on a device opens Spotify's consent page with librespot's
desktop client id. The resulting reusable credentials are stored in the app's
private SharedPreferences; later starts connect silently. Full tracks require
Spotify Premium.

The player registers as a Spotify Connect device. It is independent from the
dashboard's own Spotify login and does not change it.
