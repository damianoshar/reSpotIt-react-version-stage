//! Librespot Android bridge.
//!
//! Embeds `librespot 0.8` (full-track Spotify playback, Premium accounts) and
//! exposes it to Kotlin over JNI. Desktop audio backends are not used: a custom
//! [`pcm::PcmSink`] converts decoded `f64` samples to interleaved S16 stereo PCM
//! in a bounded ring buffer, which Kotlin drains into an `AudioTrack`.
//!
//! Milestones (see PROGRESS.md):
//!  M0 - toolchain spike (done)
//!  M1 - librespot compiles + links for Android ABIs (done)
//!  M2 - JNI surface: create/login/load/transport/read PCM (this code)
//!  M3 - Kotlin AudioTrack drains the ring buffer
//!  M4 - UI wiring behind an experimental flag

mod engine;
mod jni_api;
mod logging;
mod mixer;
mod pcm;

pub use engine::Engine;
pub use mixer::SharedMixer;
pub use pcm::{PcmBuffer, PcmSink, SharedVolumeGetter};

/// M0 crate marker. Kotlin asserts this after `System.loadLibrary`.
#[no_mangle]
pub extern "C" fn librespot_bridge_spike() -> i32 {
    // 0x4C535054 = "LSPT"
    0x4C53_5054
}
