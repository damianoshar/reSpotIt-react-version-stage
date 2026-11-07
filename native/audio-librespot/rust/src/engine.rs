//! Engine: owns the tokio runtime, the librespot session/player and the shared
//! state Kotlin polls (playback state, position, last error).

use std::sync::atomic::{AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use librespot::connect::{ConnectConfig, LoadRequest, LoadRequestOptions, Spirc};
use librespot::core::authentication::Credentials;
use librespot_protocol::authentication::AuthenticationType;
use librespot::core::config::{DeviceType, SessionConfig};
use librespot::core::session::Session;
use librespot::core::spotify_uri::SpotifyUri;
use librespot::metadata::audio::UniqueFields;
use librespot::playback::config::PlayerConfig;
use librespot::playback::mixer::Mixer;
use librespot::playback::player::{Player, PlayerEvent};
use sha1::{Digest, Sha1};

use crate::mixer::SharedMixer;
use crate::pcm::{PcmBuffer, PcmSink};

// Playback state values mirrored in Kotlin (LibrespotEngine.STATE_*).
pub const STATE_IDLE: i32 = 0;
pub const STATE_LOADING: i32 = 1;
pub const STATE_PLAYING: i32 = 2;
pub const STATE_PAUSED: i32 = 3;
pub const STATE_UNAVAILABLE: i32 = 4;

/// librespot's desktop ("keymaster") client id — also its OAuth client id.
///
/// Since Spotify's August 2026 change, the `login5` endpoint rejects playback
/// credentials derived from an access token minted for a *different* client id
/// ("INVALID_CREDENTIALS"); the whole librespot ecosystem moved to obtaining
/// the token with librespot's own client id and presenting the same id on the
/// session. Android builds default to Spotify's Android client id, which has no
/// usable OAuth redirect, so we pin the desktop id instead (as librespot does
/// for macOS/Windows).
pub const PLAYBACK_CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";

/// Metadata of the track currently loaded by the player, exposed to Kotlin so
/// the UI can follow both local queue playback and playback started from
/// another Spotify Connect device.
#[derive(Clone, Debug)]
pub struct TrackInfo {
    pub uri: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u32,
    pub art_url: Option<String>,
}

/// State shared with the event-loop task and read from JNI threads.
pub struct SharedState {
    state: AtomicI32,
    position_ms: AtomicU64,
    last_error: Mutex<Option<String>>,
    track: Mutex<Option<TrackInfo>>,
}

impl SharedState {
    fn new() -> Self {
        Self {
            state: AtomicI32::new(STATE_IDLE),
            position_ms: AtomicU64::new(0),
            last_error: Mutex::new(None),
            track: Mutex::new(None),
        }
    }

    fn apply(&self, event: PlayerEvent) {
        match event {
            PlayerEvent::Loading { .. } => self.set_state(STATE_LOADING),
            PlayerEvent::Playing { position_ms, .. } => {
                self.position_ms
                    .store(position_ms as u64, Ordering::Relaxed);
                self.set_state(STATE_PLAYING);
            }
            PlayerEvent::Paused { position_ms, .. } => {
                self.position_ms
                    .store(position_ms as u64, Ordering::Relaxed);
                self.set_state(STATE_PAUSED);
            }
            PlayerEvent::Stopped { .. } => {
                self.position_ms.store(0, Ordering::Relaxed);
                self.set_state(STATE_IDLE);
            }
            PlayerEvent::EndOfTrack { .. } => {
                // Keep the final position: the sink is still draining the
                // decoded tail, and the app computes the audible position as
                // position - buffer depth. Resetting here would make the
                // progress bar jump to 0 during the last few seconds.
                self.set_state(STATE_IDLE);
            }
            PlayerEvent::TrackChanged { audio_item } => {
                let (artist, album) = match &audio_item.unique_fields {
                    UniqueFields::Track { artists, album, .. } => (
                        artists
                            .iter()
                            .map(|artist| artist.name.clone())
                            .collect::<Vec<_>>()
                            .join(", "),
                        album.clone(),
                    ),
                    UniqueFields::Local { artists, album, .. } => (
                        artists.clone().unwrap_or_default(),
                        album.clone().unwrap_or_default(),
                    ),
                    UniqueFields::Episode { show_name, .. } => {
                        (show_name.clone(), String::new())
                    }
                };
                *self.track.lock().unwrap() = Some(TrackInfo {
                    uri: audio_item.uri.clone(),
                    title: audio_item.name.clone(),
                    artist,
                    album,
                    duration_ms: audio_item.duration_ms,
                    art_url: audio_item.covers.first().map(|cover| cover.url.clone()),
                });
            }
            PlayerEvent::Unavailable { .. } => self.set_state(STATE_UNAVAILABLE),
            PlayerEvent::PositionChanged { position_ms, .. }
            | PlayerEvent::Seeked { position_ms, .. } => {
                self.position_ms
                    .store(position_ms as u64, Ordering::Relaxed);
            }
            _ => {}
        }
    }

    fn set_state(&self, state: i32) {
        self.state.store(state, Ordering::Relaxed);
    }

    fn state(&self) -> i32 {
        self.state.load(Ordering::Relaxed)
    }

    fn position_ms(&self) -> u64 {
        self.position_ms.load(Ordering::Relaxed)
    }

    fn track_info(&self) -> Option<TrackInfo> {
        self.track.lock().unwrap().clone()
    }
}

/// One per `nativeCreate()`. Callers must serialize `destroy` after all other
/// calls have stopped (documented in the Kotlin facade).
///
/// Field order matters: `runtime` is dropped **last**, after the player thread,
/// the Connect task and the session are gone.
pub struct Engine {
    /// Replaced on every login (fresh session per access token).
    session: Mutex<Session>,
    player: Arc<Player>,
    pub buffer: Arc<PcmBuffer>,
    mixer: SharedMixer,
    shared: Arc<SharedState>,
    /// Base config (tmp_dir + stable device_id) reused for every session.
    config: SessionConfig,
    device_name: String,
    /// The running Spotify Connect device (`None` before the first login).
    spirc: Mutex<Option<Spirc>>,
    spirc_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    runtime: tokio::runtime::Runtime,
}

impl Engine {
    /// `tmp_dir` must be an app-private writable directory (e.g. `context.cacheDir`):
    /// librespot spools streamed audio files there (`NamedTempFile`, see
    /// librespot-audio `fetch/mod.rs`). Android has no usable `/tmp`.
    ///
    /// `device_name` is what other Spotify clients show in the Connect device
    /// picker. The Connect device id is derived from it (`sha1(name)`, as in
    /// librespot's own binary) so reconnecting reuses one device instead of
    /// creating a new one per app start.
    pub fn create(tmp_dir: String, device_name: String, bitrate_kbps: i32, buffer_seconds: i32, cache_mb: i32) -> Result<Self, String> {
        let device_name = {
            let trimmed = device_name.trim();
            if trimmed.is_empty() {
                "reSpotIt".to_string()
            } else {
                trimmed.to_string()
            }
        };

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| format!("tokio runtime: {e}"))?;

        let mut config = SessionConfig::default();
        // Playback identity: must match the client id used for the OAuth token
        // (see PLAYBACK_CLIENT_ID) or login5 refuses the exchange.
        config.client_id = PLAYBACK_CLIENT_ID.to_string();
        config.device_id = hex::encode(Sha1::digest(device_name.as_bytes()));
        if !tmp_dir.is_empty() {
            config.tmp_dir = std::path::PathBuf::from(tmp_dir);
        }
        if !config.tmp_dir.is_dir() {
            return Err(format!(
                "tmp dir is not a writable directory: {}",
                config.tmp_dir.display()
            ));
        }

        let cache = if cache_mb > 0 {
            let audio_dir = config.tmp_dir.join("audio_cache");
            std::fs::create_dir_all(&audio_dir).ok();
            librespot::core::cache::Cache::new::<std::path::PathBuf>(
                None,
                None,
                Some(audio_dir),
                Some(cache_mb as u64 * 1024 * 1024),
            )
            .ok()
        } else {
            None
        };

        // Session::new captures tokio::runtime::Handle::current().
        let session = {
            let _guard = runtime.enter();
            Session::new(config.clone(), cache)
        };

        let buffer_seconds = buffer_seconds.clamp(1, 8) as usize;
let buffer = Arc::new(PcmBuffer::new(44_100 * 2 * buffer_seconds));
        let mixer = SharedMixer::new();

        let player_bitrate = match bitrate_kbps {
            96 => librespot::playback::config::Bitrate::Bitrate96,
            320 => librespot::playback::config::Bitrate::Bitrate320,
            _ => librespot::playback::config::Bitrate::Bitrate160,
        };
        let player_config = PlayerConfig {
            bitrate: player_bitrate,
            position_update_interval: Some(Duration::from_millis(500)),
            ..Default::default()
        };
        let sink_buffer = Arc::clone(&buffer);
        let player = Player::new(
            player_config,
            session.clone(),
            Box::new(mixer.clone()),
            move || Box::new(PcmSink::new(sink_buffer)),
        );

        let shared = Arc::new(SharedState::new());

        // Player events -> shared state (state, position, track metadata, errors).
        let mut events = player.get_player_event_channel();
        let event_state = Arc::clone(&shared);
        runtime.spawn(async move {
            while let Some(event) = events.recv().await {
                event_state.apply(event);
            }
        });

        Ok(Self {
            session: Mutex::new(session),
            player,
            buffer,
            mixer,
            shared,
            config,
            device_name,
            spirc: Mutex::new(None),
            spirc_task: Mutex::new(None),
            runtime,
        })
    }

    /// Connect a fresh session with a (refreshed) access token and hand it to
    /// the player. Safe to call again to rotate an expired token.
    pub fn login(&self, access_token: String) -> Result<(), String> {
        log::info!("connecting session (token length {})", access_token.len());
        self.start_connect(Credentials::with_access_token(access_token))
    }

    /// Connect using the reusable ("stored") credentials the AP derived from an
    /// earlier access-token login (see [`Engine::stored_credentials`]).
    ///
    /// Unlike access tokens these do not expire, so this is the steady-state
    /// login path: one interactive OAuth once, then stored credentials forever.
    pub fn login_stored(&self, username: String, auth_data: Vec<u8>) -> Result<(), String> {
        log::info!("connecting session with stored credentials for '{username}'");
        let credentials = Credentials {
            username: Some(username),
            auth_type: AuthenticationType::AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS,
            auth_data,
        };
        self.start_connect(credentials)
    }

    /// Reusable credentials of the current session (`username` + AP auth blob),
    /// available after a successful [`Engine::login`]. Persist these (they are
    /// account secrets: app-private storage only) and reuse via
    /// [`Engine::login_stored`].
    pub fn stored_credentials(&self) -> Option<(String, Vec<u8>)> {
        let session = self.session.lock().unwrap();
        let username = session.username();
        let auth_data = session.auth_data();
        if username.is_empty() || auth_data.is_empty() {
            return None;
        }
        Some((username, auth_data))
    }

    /// Shared connect path: tear down any previous Connect device, create a
    /// fresh session and let `Spirc` connect it and register the device.
    ///
    /// `Spirc::new` performs `session.connect(credentials, ...)` itself; doing
    /// it here as well would open the dealer twice and confuse the connect
    /// state, so this is now the only login path.
    fn start_connect(&self, credentials: Credentials) -> Result<(), String> {
        self.stop_connect();

        let new_session = {
            let _guard = self.runtime.enter();
            Session::new(self.config.clone(), None)
        };
        self.player.set_session(new_session.clone());

        let connect_config = ConnectConfig {
            name: self.device_name.clone(),
            device_type: DeviceType::Smartphone,
            is_group: false,
            // Keep local playback at full volume by default; remote clients can
            // still change it through the Connect volume slider.
            initial_volume: u16::MAX,
            disable_volume: false,
            volume_steps: 64,
        };
        let mixer: Arc<dyn Mixer> = Arc::new(self.mixer.clone());

        log::info!("registering Spotify Connect device '{}'", self.device_name);
        let result = self.runtime.block_on(async {
            Spirc::new(
                connect_config,
                new_session.clone(),
                credentials,
                Arc::clone(&self.player),
                mixer,
            )
            .await
        });

        match result {
            Ok((spirc, task)) => {
                let task = self.runtime.spawn(task);
                *self.session.lock().unwrap() = new_session;
                *self.spirc.lock().unwrap() = Some(spirc);
                *self.spirc_task.lock().unwrap() = Some(task);
                self.set_last_error(None);
                log::info!(
                    "Spotify Connect device '{}' registered; session connected",
                    self.device_name
                );
                Ok(())
            }
            Err(e) => {
                let msg = format!("login failed: {e}");
                log::error!("{msg}");
                self.set_last_error(Some(msg.clone()));
                Err(msg)
            }
        }
    }

    /// Stops the Connect task (and its device registration) before a new
    /// session is created or the engine is destroyed.
    fn stop_connect(&self) {
        if let Some(spirc) = self.spirc.lock().unwrap().take() {
            if let Err(e) = spirc.shutdown() {
                log::warn!("Spirc shutdown request failed: {e}");
            }
        }
        if let Some(mut task) = self.spirc_task.lock().unwrap().take() {
            let finished = self.runtime.block_on(async {
                tokio::time::timeout(Duration::from_secs(2), &mut task)
                    .await
                    .is_ok()
            });
            if !finished {
                log::warn!("Spirc task did not stop within 2 s; aborting");
                task.abort();
            }
        }
    }

    pub fn load(&self, uri: &str) -> Result<(), String> {
        let _parsed = SpotifyUri::from_uri(uri).map_err(|e| {
            let msg = format!("bad uri '{uri}': {e}");
            self.set_last_error(Some(msg.clone()));
            msg
        })?;

        let spirc = self.spirc.lock().unwrap();
        let Some(spirc) = spirc.as_ref() else {
            let msg = "not connected to Spotify".to_string();
            self.set_last_error(Some(msg.clone()));
            return Err(msg);
        };

        self.shared.position_ms.store(0, Ordering::Relaxed);
        self.shared.set_state(STATE_LOADING);
        self.buffer.clear(); // drop any tail of the previous track

        // Activate first (queued before the load in the same channel) so the
        // app becomes the active Connect device when the user starts playback.
        spirc.activate().map_err(|e| {
            let msg = format!("Connect activate failed: {e}");
            self.set_last_error(Some(msg.clone()));
            msg
        })?;
        spirc
            .load(LoadRequest::from_tracks(
                vec![uri.to_string()],
                LoadRequestOptions {
                    start_playing: true,
                    ..Default::default()
                },
            ))
            .map_err(|e| {
                let msg = format!("Connect load failed: {e}");
                self.set_last_error(Some(msg.clone()));
                msg
            })?;
        self.set_last_error(None);
        Ok(())
    }

    pub fn play(&self) {
        if let Some(spirc) = self.spirc.lock().unwrap().as_ref() {
            // A local play tap also takes over from another Connect device.
            let _ = spirc.activate();
            if let Err(e) = spirc.play() {
                log::warn!("Spirc play failed: {e}");
            }
        } else {
            self.player.play();
        }
    }

    pub fn pause(&self) {
        if let Some(spirc) = self.spirc.lock().unwrap().as_ref() {
            if let Err(e) = spirc.pause() {
                log::warn!("Spirc pause failed: {e}");
            }
        } else {
            self.player.pause();
        }
    }

    pub fn stop(&self) {
        // Close first: a blocked sink write (full buffer) must return before the
        // player thread can process the stop command.
        self.buffer.close();
        self.buffer.clear();
        if let Some(spirc) = self.spirc.lock().unwrap().as_ref() {
            if let Err(e) = spirc.disconnect(true) {
                log::warn!("Spirc disconnect failed: {e}");
            }
        }
        self.player.stop();
    }

    /// Stops playback without disconnecting the Spotify Connect device or tearing
    /// the session down, so another client can still start playing into this app
    /// afterwards (idle "connect whenever" mode).
    pub fn stop_playback(&self) {
        self.buffer.close();
        self.buffer.clear();
        self.player.stop();
    }

    pub fn seek(&self, position_ms: u32) {
        // Drop the decoded-but-unplayed tail: without this the drain loop keeps
        // feeding pre-seek audio into the AudioTrack for several seconds.
        self.buffer.clear();
        if let Some(spirc) = self.spirc.lock().unwrap().as_ref() {
            if let Err(e) = spirc.set_position_ms(position_ms) {
                log::warn!("Spirc seek failed: {e}");
            }
        } else {
            self.player.seek(position_ms);
        }
    }

    /// Skips to the next item of the active Connect context.
    pub fn next(&self) {
        if let Some(spirc) = self.spirc.lock().unwrap().as_ref() {
            if let Err(e) = spirc.next() {
                log::warn!("Spirc next failed: {e}");
            }
        }
    }

    /// Seeks to the start of the current item (when >3 s in) or goes back one
    /// item, using the active Connect context.
    pub fn previous(&self) {
        if let Some(spirc) = self.spirc.lock().unwrap().as_ref() {
            if let Err(e) = spirc.prev() {
                log::warn!("Spirc previous failed: {e}");
            }
        }
    }

    /// Samples currently sitting in the decoded PCM buffer (not yet pulled by Kotlin).
    pub fn buffered_samples(&self) -> usize {
        self.buffer.len()
    }

    pub fn set_volume(&self, factor: f32) {
        // App-local duck only: the Connect volume stays whatever the remote
        // slider says, and the two are multiplied by SharedMixer.
        self.mixer.set_duck(factor as f64);
    }

    pub fn read_pcm(&self, out: &mut [i16]) -> usize {
        self.buffer.read(out)
    }

    pub fn state(&self) -> i32 {
        self.shared.state()
    }

    pub fn position_ms(&self) -> u64 {
        self.shared.position_ms()
    }

    pub fn track_info(&self) -> Option<TrackInfo> {
        self.shared.track_info()
    }

    pub fn last_error(&self) -> Option<String> {
        self.shared.last_error.lock().unwrap().clone()
    }

    pub(crate) fn set_last_error(&self, error: Option<String>) {
        *self.shared.last_error.lock().unwrap() = error;
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // Fields drop in declaration order, so `player` (which joins its thread)
        // would otherwise wait forever on a sink write blocked by a full buffer.
        // Closing the buffer first makes any pending `PcmSink::write` return.
        self.buffer.close();
        self.stop_connect();
    }
}
