//! JNI entry points for `com.spotifydashboard.librespot.LibrespotBridge`.
//!
//! Handles are raw `Box<Engine>` pointers created in `nativeCreate` and freed
//! exactly once in `nativeDestroy`. Every entry point catches panics so a Rust
//! bug can never abort the Android process (returns a default instead).

use std::panic::{catch_unwind, AssertUnwindSafe};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use jni::objects::{JClass, JShortArray, JString};
use jni::sys::{jboolean, jfloat, jint, jlong, jstring, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;

use crate::engine::Engine;

/// Max samples one `nativeReadPcm` call can return. Kotlin must pass an array
/// of at least this size (`LibrespotBridge.PCM_CHUNK_SAMPLES`).
const PCM_CHUNK_SAMPLES: usize = 4096;

fn with_engine<T>(handle: jlong, default: T, f: impl FnOnce(&Engine) -> T) -> T {
    crate::logging::init();
    if handle == 0 {
        return default;
    }
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: handle comes from nativeCreate and stays valid until
        // nativeDestroy; the Kotlin facade guarantees call ordering.
        let engine = unsafe { &*(handle as *const Engine) };
        f(engine)
    }))
    .unwrap_or(default)
}

fn jni_default<T, F: FnOnce() -> T>(default: T, f: F) -> T {
    crate::logging::init();
    catch_unwind(AssertUnwindSafe(f)).unwrap_or(default)
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeCreate(
    mut env: JNIEnv,
    _class: JClass,
    tmp_dir: JString,
    device_name: JString,
    bitrate_kbps: jint,
    buffer_seconds: jint,
    cache_mb: jint,
) -> jlong {
    jni_default(0, || {
        let tmp_dir = match env.get_string(&tmp_dir) {
            Ok(s) => s.to_string_lossy().into_owned(),
            Err(_) => return 0,
        };
        let device_name = match env.get_string(&device_name) {
            Ok(s) => s.to_string_lossy().into_owned(),
            Err(_) => "Spotify Dashboard".to_string(),
        };
        match Engine::create(tmp_dir, device_name, bitrate_kbps, buffer_seconds, cache_mb) {
            Ok(engine) => Box::into_raw(Box::new(engine)) as jlong,
            Err(_) => 0,
        }
    })
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeLogin(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    access_token: JString,
) -> jboolean {
    jni_default(JNI_FALSE, || {
        let token = match env.get_string(&access_token) {
            Ok(s) => s.to_string_lossy().into_owned(),
            Err(e) => {
                log::error!("nativeLogin: could not read the access token from the JVM: {e}");
                return with_engine(handle, JNI_FALSE, |engine| {
                    engine.set_last_error(Some(format!("login failed: unreadable token ({e})")));
                    JNI_FALSE
                });
            }
        };
        with_engine(handle, JNI_FALSE, |engine| {
            match catch_unwind(AssertUnwindSafe(|| engine.login(token))) {
                Ok(Ok(())) => JNI_TRUE,
                Ok(Err(_)) => JNI_FALSE, // Engine::login recorded last_error
                Err(_) => {
                    engine.set_last_error(Some(
                        "login panicked inside librespot (see logcat tag librespot-rs)".to_string(),
                    ));
                    JNI_FALSE
                }
            }
        })
    })
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeLoginStored(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    username: JString,
    auth_data_b64: JString,
) -> jboolean {
    jni_default(JNI_FALSE, || {
        let username = match env.get_string(&username) {
            Ok(s) => s.to_string_lossy().into_owned(),
            Err(e) => {
                log::error!("nativeLoginStored: could not read username from the JVM: {e}");
                return with_engine(handle, JNI_FALSE, |engine| {
                    engine.set_last_error(Some(format!(
                        "stored login failed: unreadable username ({e})"
                    )));
                    JNI_FALSE
                });
            }
        };
        let encoded = match env.get_string(&auth_data_b64) {
            Ok(s) => s.to_string_lossy().into_owned(),
            Err(e) => {
                log::error!("nativeLoginStored: could not read auth data from the JVM: {e}");
                return with_engine(handle, JNI_FALSE, |engine| {
                    engine.set_last_error(Some(format!(
                        "stored login failed: unreadable auth data ({e})"
                    )));
                    JNI_FALSE
                });
            }
        };
        let auth_data = match STANDARD.decode(encoded.trim()) {
            Ok(bytes) => bytes,
            Err(e) => {
                log::error!("nativeLoginStored: malformed base64 auth data: {e}");
                return with_engine(handle, JNI_FALSE, |engine| {
                    engine.set_last_error(Some(format!(
                        "stored login failed: malformed auth data ({e})"
                    )));
                    JNI_FALSE
                });
            }
        };
        with_engine(handle, JNI_FALSE, |engine| {
            match catch_unwind(AssertUnwindSafe(|| engine.login_stored(username, auth_data))) {
                Ok(Ok(())) => JNI_TRUE,
                Ok(Err(_)) => JNI_FALSE, // Engine::login_stored recorded last_error
                Err(_) => {
                    engine.set_last_error(Some(
                        "stored login panicked inside librespot (see logcat tag librespot-rs)"
                            .to_string(),
                    ));
                    JNI_FALSE
                }
            }
        })
    })
}

/// Returns the session's reusable credentials as `username\n<base64 auth_data>`
/// or `null` when no login has happened yet. See `Engine::stored_credentials`.
#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeStoredCredentials(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    jni_default(std::ptr::null_mut(), || {
        let payload = with_engine(handle, None, |engine| {
            engine
                .stored_credentials()
                .map(|(username, auth_data)| format!("{username}\n{}", STANDARD.encode(auth_data)))
        });
        let Some(payload) = payload else {
            log::warn!("nativeStoredCredentials: session has no stored credentials yet");
            return std::ptr::null_mut();
        };
        match env.new_string(payload) {
            Ok(s) => s.into_raw(),
            Err(e) => {
                log::error!("nativeStoredCredentials: could not allocate the result string: {e}");
                std::ptr::null_mut()
            }
        }
    })
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeLoad(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    uri: JString,
) -> jboolean {
    jni_default(JNI_FALSE, || {
        let uri = match env.get_string(&uri) {
            Ok(s) => s.to_string_lossy().into_owned(),
            Err(_) => return JNI_FALSE,
        };
        with_engine(handle, JNI_FALSE, |engine| {
            if engine.load(&uri).is_ok() {
                JNI_TRUE
            } else {
                JNI_FALSE
            }
        })
    })
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativePlay(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    with_engine(handle, (), |engine| engine.play());
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativePause(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    with_engine(handle, (), |engine| engine.pause());
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeStop(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    with_engine(handle, (), |engine| engine.stop());
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeStopPlayback(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    with_engine(handle, (), |engine| engine.stop_playback());
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeSeek(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    position_ms: jint,
) {
    with_engine(handle, (), |engine| engine.seek(position_ms.max(0) as u32));
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeNext(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    with_engine(handle, (), |engine| engine.next());
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativePrevious(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    with_engine(handle, (), |engine| engine.previous());
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeSetVolume(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    factor: jfloat,
) {
    with_engine(handle, (), |engine| engine.set_volume(factor));
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeReadPcm(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
    out: JShortArray,
) -> jint {
    jni_default(0, || {
        let mut scratch = [0i16; PCM_CHUNK_SAMPLES];
        let read = with_engine(handle, 0, |engine| engine.read_pcm(&mut scratch));
        if read == 0 {
            return 0;
        }
        match env.set_short_array_region(&out, 0, &scratch[..read]) {
            Ok(()) => read as jint,
            Err(_) => 0,
        }
    })
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeState(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jint {
    with_engine(handle, crate::engine::STATE_IDLE, |engine| engine.state())
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativePositionMs(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jint {
    with_engine(handle, 0, |engine| {
        engine.position_ms().min(i32::MAX as u64) as jint
    })
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeBufferedSamples(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jint {
    with_engine(handle, 0, |engine| {
        engine.buffered_samples().min(i32::MAX as usize) as jint
    })
}

/// Returns the current track as unit-separator (0x1f) delimited fields:
/// `uri, title, artist, album, durationMs, artUrl`. Null when nothing is loaded.
#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeCurrentTrack(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    jni_default(std::ptr::null_mut(), || {
        let payload = with_engine(handle, None, |engine| {
            engine.track_info().map(|track| {
                format!(
                    "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
                    track.uri,
                    track.title,
                    track.artist,
                    track.album,
                    track.duration_ms,
                    track.art_url.unwrap_or_default(),
                )
            })
        });
        let Some(payload) = payload else {
            return std::ptr::null_mut();
        };
        match env.new_string(payload) {
            Ok(s) => s.into_raw(),
            Err(e) => {
                log::error!("nativeCurrentTrack: could not allocate the result string: {e}");
                std::ptr::null_mut()
            }
        }
    })
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeLastError(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    jni_default(std::ptr::null_mut(), || {
        let message = with_engine(handle, None, |engine| engine.last_error());
        match env.new_string(message.unwrap_or_default()) {
            Ok(s) => s.into_raw(),
            Err(_) => std::ptr::null_mut(),
        }
    })
}

#[no_mangle]
pub extern "system" fn Java_com_spotifydashboard_librespot_LibrespotBridge_nativeDestroy(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if handle == 0 {
        return;
    }
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: single ownership transfer back from Kotlin; documented contract.
        drop(unsafe { Box::from_raw(handle as *mut Engine) });
    }))
    .ok();
}
