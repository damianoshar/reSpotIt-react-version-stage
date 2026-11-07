//! Android logging: routes the `log` crate (librespot internals + our own
//! diagnostics) and panic messages to logcat under the tag `librespot-rs`.
//!
//! Why this exists: librespot logs through the `log` facade, but with no
//! logger installed every line is silently dropped. And Rust panic output goes
//! to stderr, which is `/dev/null` for Android app processes in release builds
//! (the std stdio->logcat redirect is debug-only). During the experiment we
//! need both visible, so release builds log at Debug level on purpose.

use std::sync::Once;

static INIT: Once = Once::new();

/// Idempotent; call from every JNI entry point (cheap `Once` check).
pub fn init() {
    INIT.call_once(|| {
        android_logger::init_once(
            android_logger::Config::default()
                .with_tag("librespot-rs")
                .with_max_level(log::LevelFilter::Debug),
        );
        // Panics would otherwise vanish (see module docs): log them first.
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            log::error!("PANIC: {info}");
            default_hook(info);
        }));
        log::info!("librespot bridge logging initialized");
    });
}
