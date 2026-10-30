//! Connect-aware volume mixer.
//!
//! librespot's `Spirc` owns the Connect volume (0..=65535) and expects a
//! `Mixer` it can read/write. At the same time the app needs its own ducking
//! factor (audio-focus loss) that must not be reported back to Spotify as a
//! volume change. [`SharedMixer`] multiplies both:
//!
//! `attenuation = connect_volume / 65535 * duck_factor`
//!
//! so a remote volume change and a local duck can coexist.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use librespot::core::Error;
use librespot::playback::mixer::{Mixer, MixerConfig, VolumeGetter};

struct MixerState {
    /// Connect volume in librespot's 0..=65535 range.
    volume: AtomicU32,
    /// App-local ducking factor stored as f64 bits (0.0..=1.0).
    duck_bits: AtomicU64,
}

/// Cloneable mixer + volume getter sharing the same state. Cloning is cheap;
/// the `Player` and the `Spirc` task both read the same atomics.
#[derive(Clone)]
pub struct SharedMixer {
    state: Arc<MixerState>,
}

impl SharedMixer {
    pub fn new() -> Self {
        Self {
            state: Arc::new(MixerState {
                volume: AtomicU32::new(u16::MAX as u32),
                duck_bits: AtomicU64::new(1.0f64.to_bits()),
            }),
        }
    }

    /// Sets the app-local duck (audio focus). Does not change the Connect volume.
    pub fn set_duck(&self, factor: f64) {
        let clamped = factor.clamp(0.0, 1.0);
        self.state
            .duck_bits
            .store(clamped.to_bits(), Ordering::Relaxed);
    }

    fn duck(&self) -> f64 {
        f64::from_bits(self.state.duck_bits.load(Ordering::Relaxed))
    }
}

impl Default for SharedMixer {
    fn default() -> Self {
        Self::new()
    }
}

impl Mixer for SharedMixer {
    fn open(_config: MixerConfig) -> Result<Self, Error> {
        Ok(Self::new())
    }

    fn volume(&self) -> u16 {
        self.state.volume.load(Ordering::Relaxed) as u16
    }

    fn set_volume(&self, volume: u16) {
        self.state
            .volume
            .store(volume as u32, Ordering::Relaxed);
    }

    fn get_soft_volume(&self) -> Box<dyn VolumeGetter + Send> {
        Box::new(self.clone())
    }
}

impl VolumeGetter for SharedMixer {
    fn attenuation_factor(&self) -> f64 {
        let connect = self.volume() as f64 / u16::MAX as f64;
        connect * self.duck()
    }
}
