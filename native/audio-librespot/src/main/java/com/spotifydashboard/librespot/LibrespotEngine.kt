package com.spotifydashboard.librespot

import java.io.Closeable

/**
 * Snapshot of a track as reported by the native engine (including playback started
 * from another Spotify Connect device).
 */
data class LibrespotTrack(
    val uri: String,
    val title: String,
    val artist: String,
    val album: String,
    val durationMs: Int,
    val artUrl: String?,
)


/**
 * Thin lifecycle wrapper around the native librespot engine.
 *
 * Feed [readPcm] output into an `AudioTrack` configured with
 * `ENCODING_PCM_16BIT`, `CHANNEL_OUT_STEREO`, sample rate 44 100 Hz.
 *
 * Thread-safety: all calls are safe from any single thread at a time; [close]
 * must happen after readers/controllers have stopped (see [LibrespotBridge]).
 */
class LibrespotEngine private constructor(private var handle: Long) : Closeable {

    val isOpen: Boolean get() = handle != 0L

    /** One of [STATE_IDLE], [STATE_LOADING], [STATE_PLAYING], [STATE_PAUSED], [STATE_UNAVAILABLE]. */
    val state: Int
        get() = handle.takeIf { it != 0L }?.let { LibrespotBridge.nativeState(it) } ?: STATE_IDLE

    /** Last known playback position in milliseconds. */
    val positionMs: Int
        get() = handle.takeIf { it != 0L }?.let { LibrespotBridge.nativePositionMs(it) } ?: 0

    /**
     * Interleaved samples decoded by the player but not yet pulled by the
     * `AudioTrack` drain. The decoded [positionMs] runs ahead of audible audio
     * by this depth; subtract it when showing a progress bar.
     */
    val bufferedSamples: Int
        get() = handle.takeIf { it != 0L }?.let { LibrespotBridge.nativeBufferedSamples(it) } ?: 0

    /** Last native error message (login/load failures), or null. */
    val lastError: String?
        get() = handle.takeIf { it != 0L }
            ?.let { LibrespotBridge.nativeLastError(it) }
            ?.takeIf { it.isNotEmpty() }

    /**
     * Connects a fresh librespot session with the given Spotify access token
     * (Premium account required).
     *
     * The token must be minted for librespot's playback client id (see the
     * module docs / `PLAYBACK_CLIENT_ID` on the Rust side): tokens issued to
     * the dashboard's own OAuth app are refused by Spotify's `login5`
     * endpoint. Returns false on failure — see [lastError].
     */
    fun login(accessToken: String): Boolean =
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativeLogin(it, accessToken) } ?: false

    /**
     * Reusable ("stored") credentials of the current session — available after
     * a successful [login] as `(username, base64 auth blob)`. Persist them
     * (app-private: they are account secrets) and reuse with [loginStored] to
     * skip the browser flow on later starts.
     */
    val storedCredentials: Pair<String, String>?
        get() = handle.takeIf { it != 0L }
            ?.let { LibrespotBridge.nativeStoredCredentials(it) }
            ?.let { payload ->
                val separator = payload.indexOf('\n')
                if (separator <= 0) null else payload.substring(0, separator) to payload.substring(separator + 1)
            }

    /**
     * Connects using credentials previously obtained from [storedCredentials]:
     * no OAuth and no token refresh. Returns false on failure — see
     * [lastError]; callers should then fall back to a fresh interactive login.
     */
    fun loginStored(username: String, authDataB64: String): Boolean =
        handle.takeIf { it != 0L }
            ?.let { LibrespotBridge.nativeLoginStored(it, username, authDataB64) }
            ?: false

    /**
     * Loads and starts a playable URI (`spotify:track:...` or `spotify:episode:...`).
     * Returns false if the URI is malformed — see [lastError].
     */
    fun load(uri: String): Boolean =
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativeLoad(it, uri) } ?: false

    fun play() {
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativePlay(it) }
    }

    fun pause() {
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativePause(it) }
    }

    /** Stops playback and drops the connection (clears buffers). */
    fun stop() {
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativeStop(it) }
    }

    /** Stops playback without dropping the Spotify Connect device. */
    fun stopPlayback() {
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativeStopPlayback(it) }
    }

    fun seekTo(positionMs: Int) {
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativeSeek(it, positionMs) }
    }

    fun next() {
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativeNext(it) }
    }

    fun previous() {
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativePrevious(it) }
    }

    /** Track currently decoded by the player. Updates on both local and remote (Connect) playback. */
    val currentTrack: LibrespotTrack?
        get() = handle.takeIf { it != 0L }
            ?.let { LibrespotBridge.nativeCurrentTrack(it) }
            ?.split("\u001F")
            ?.takeIf { it.size >= 6 }
            ?.let {
                LibrespotTrack(
                    uri = it[0],
                    title = it[1],
                    artist = it[2],
                    album = it[3],
                    durationMs = it[4].toIntOrNull() ?: 0,
                    artUrl = it[5].takeIf { url -> url.isNotBlank() },
                )
            }
    /** 0.0..1.0 attenuation factor applied by the player (soft). */
    fun setVolume(factor: Float) {
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativeSetVolume(it, factor.coerceIn(0f, 1f)) }
    }

    /**
     * Drains up to [LibrespotBridge.PCM_CHUNK_SAMPLES] interleaved stereo samples.
     * Returns the number of samples written; 0 means the buffer is currently empty.
     */
    fun readPcm(out: ShortArray): Int =
        handle.takeIf { it != 0L }?.let { LibrespotBridge.nativeReadPcm(it, out) } ?: 0

    override fun close() {
        val current = handle
        handle = 0L
        if (current != 0L) {
            LibrespotBridge.nativeDestroy(current)
        }
    }

    companion object {
        const val STATE_IDLE = 0
        const val STATE_LOADING = 1
        const val STATE_PLAYING = 2
        const val STATE_PAUSED = 3
        const val STATE_UNAVAILABLE = 4

        /** Rust-side PCM literals; kept in sync with `pcm.rs`/`librespot` constants. */
        const val SAMPLE_RATE_HZ = 44_100
        const val CHANNEL_COUNT = 2

        /**
         * Creates the engine (tokio runtime + librespot player + event loop).
         *
         * [tmpDir] must be an app-private writable directory (e.g.
         * `context.cacheDir`); librespot spools streamed audio there.
         * Throws [IllegalStateException] if the native handle could not be created.
         */
        fun create(tmpDir: java.io.File, deviceName: String = "Spotify Dashboard", bitrateKbps: Int = 160, bufferSeconds: Int = 2, cacheMb: Int = 0): LibrespotEngine {
            val created = LibrespotBridge.nativeCreate(tmpDir.absolutePath, deviceName, bitrateKbps, bufferSeconds, cacheMb)
            check(created != 0L) {
                "LibrespotEngine.create failed (nativeCreate returned 0; tmpDir=${tmpDir.absolutePath})"
            }
            return LibrespotEngine(created)
        }
    }
}
