//! PCM path: bounded ring buffer + librespot `Sink` + volume getter.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use librespot::playback::audio_backend::{Sink, SinkResult};
use librespot::playback::convert::Converter;
use librespot::playback::decoder::AudioPacket;
use librespot::playback::mixer::VolumeGetter;

// ---------------------------------------------------------------------------
// PCM ring buffer
// ---------------------------------------------------------------------------

struct PcmBufferInner {
    samples: VecDeque<i16>,
    closed: bool,
}

/// Bounded, lock-protected ring buffer of interleaved S16 stereo samples.
///
/// The librespot player thread pushes; the Kotlin pull loop (M3) drains.
///
/// `push` **blocks** while the buffer is full. That is load-bearing: librespot's
/// player spins on the decoder and intentionally relies on the audio backend
/// (`Sink::write`) for real-time backpressure. With a non-blocking sink the whole
/// track is decoded at once and dropped into this buffer — playback "finishes"
/// in seconds and the position resets to 0.
pub struct PcmBuffer {
    inner: Mutex<PcmBufferInner>,
    /// Signalled when space is available / the buffer is closed or reopened.
    space: Condvar,
    capacity: usize,
}

impl PcmBuffer {
    pub fn new(capacity_samples: usize) -> Self {
        Self {
            inner: Mutex::new(PcmBufferInner {
                samples: VecDeque::with_capacity(capacity_samples.min(64 * 1024)),
                closed: false,
            }),
            space: Condvar::new(),
            capacity: capacity_samples,
        }
    }

    /// Number of samples (not frames, not bytes) currently buffered.
    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().samples.len()
    }

    fn push(&self, pcm: &[i16]) {
        let mut inner = self.inner.lock().unwrap();
        let mut written = 0;
        while written < pcm.len() {
            if inner.closed {
                return;
            }
            let room = self.capacity.saturating_sub(inner.samples.len());
            if room > 0 {
                let n = room.min(pcm.len() - written);
                inner
                    .samples
                    .extend(pcm[written..written + n].iter().copied());
                written += n;
                continue;
            }
            // Full: wait for the Kotlin drain loop (bounded, so a missed notify
            // can never wedge the player thread).
            let (guard, _) = self
                .space
                .wait_timeout(inner, Duration::from_millis(100))
                .unwrap();
            inner = guard;
        }
    }

    /// Drain up to `out.len()` samples; returns how many were written.
    pub fn read(&self, out: &mut [i16]) -> usize {
        let mut inner = self.inner.lock().unwrap();
        let n = out.len().min(inner.samples.len());
        for slot in out.iter_mut().take(n) {
            *slot = inner.samples.pop_front().unwrap();
        }
        drop(inner);
        if n > 0 {
            self.space.notify_all();
        }
        n
    }

    /// Drop all buffered samples (used on load/stop/destroy).
    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.samples.clear();
        drop(inner);
        self.space.notify_all();
    }

    /// Mark the buffer closed (sink stopped) and reset for a future start.
    pub fn close(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.closed = true;
        drop(inner);
        self.space.notify_all();
    }

    fn reopen(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.closed = false;
        drop(inner);
        self.space.notify_all();
    }
}

// ---------------------------------------------------------------------------
// librespot sink: decoded samples -> PcmBuffer
// ---------------------------------------------------------------------------

pub struct PcmSink {
    buffer: Arc<PcmBuffer>,
}

impl PcmSink {
    pub fn new(buffer: Arc<PcmBuffer>) -> Self {
        Self { buffer }
    }
}

impl Sink for PcmSink {
    fn start(&mut self) -> SinkResult<()> {
        self.buffer.reopen();
        Ok(())
    }

    fn stop(&mut self) -> SinkResult<()> {
        self.buffer.close();
        Ok(())
    }

    fn write(&mut self, packet: AudioPacket, converter: &mut Converter) -> SinkResult<()> {
        match packet {
            AudioPacket::Samples(samples) => {
                // librespot hands us f64 samples at 44100 Hz interleaved stereo;
                // convert to S16 for AudioTrack (ENCODING_PCM_16BIT).
                let pcm = converter.f64_to_s16(&samples);
                self.buffer.push(&pcm);
            }
            AudioPacket::Raw(_raw) => {
                // Only produced with the passthrough-decoder feature, which we never enable.
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Volume: Kotlin-set attenuation factor (0.0..=1.0) read by the player
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct SharedVolumeGetter {
    factor_bits: Arc<AtomicU64>, // f64 bits
}

impl SharedVolumeGetter {
    pub fn new(initial: f64) -> Self {
        Self {
            factor_bits: Arc::new(AtomicU64::new(initial.to_bits())),
        }
    }

    pub fn set(&self, factor: f64) {
        let clamped = factor.clamp(0.0, 1.0);
        self.factor_bits
            .store(clamped.to_bits(), Ordering::Relaxed);
    }
}

impl VolumeGetter for SharedVolumeGetter {
    fn attenuation_factor(&self) -> f64 {
        f64::from_bits(self.factor_bits.load(Ordering::Relaxed))
    }
}
