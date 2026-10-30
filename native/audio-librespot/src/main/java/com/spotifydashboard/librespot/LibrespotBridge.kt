package com.spotifydashboard.librespot

/**
 * Raw JNI facade for the embedded librespot native library.
 *
 * Prefer [LibrespotEngine]; use this only when you need the raw handle.
 *
 * Contracts:
 * - [nativeDestroy] must be called exactly once per [nativeCreate], only after
 *   every other call for that handle has stopped (no drain loop running).
 * - [nativeReadPcm] requires an array of exactly [PCM_CHUNK_SAMPLES] shorts.
 *
 * Audio format produced by the native side: 44 100 Hz, stereo, 16-bit PCM.
 */
object LibrespotBridge {
    /** Interleaved stereo samples per PCM drain chunk (native reads are capped at this). */
    const val PCM_CHUNK_SAMPLES = 4096

    init {
        System.loadLibrary("spotify_librespot")
    }

    /**
     * Creates the native engine.
     *
     * [tmpDirPath] must be an app-private writable directory (e.g.
     * `context.cacheDir.absolutePath`): librespot spools streamed audio files
     * there, and Android has no usable `/tmp`.
     *
     * [deviceName] is shown in other Spotify clients' Connect device picker.
     */
    external fun nativeCreate(tmpDirPath: String, deviceName: String, bitrateKbps: Int, bufferSeconds: Int, cacheMb: Int): Long

    external fun nativeLogin(handle: Long, accessToken: String): Boolean

    /**
     * Connects using reusable ("stored") credentials obtained from
     * [nativeStoredCredentials] — no OAuth, no access-token expiry.
     */
    external fun nativeLoginStored(handle: Long, username: String, authDataB64: String): Boolean

    /**
     * Returns the session's reusable credentials as `username\n<base64 auth
     * data>`, or null when the session is not authenticated yet.
     */
    external fun nativeStoredCredentials(handle: Long): String?

    external fun nativeLoad(handle: Long, uri: String): Boolean

    external fun nativePlay(handle: Long)

    external fun nativePause(handle: Long)

    external fun nativeStop(handle: Long)

    external fun nativeStopPlayback(handle: Long)

    external fun nativeSeek(handle: Long, positionMs: Int)

    external fun nativeNext(handle: Long)

    external fun nativePrevious(handle: Long)

    external fun nativeCurrentTrack(handle: Long): String?

    external fun nativeSetVolume(handle: Long, factor: Float)

    external fun nativeReadPcm(handle: Long, out: ShortArray): Int

    external fun nativeState(handle: Long): Int

    external fun nativePositionMs(handle: Long): Int

    /** Interleaved samples currently decoded and waiting in the native PCM buffer. */
    external fun nativeBufferedSamples(handle: Long): Int

    external fun nativeLastError(handle: Long): String

    external fun nativeDestroy(handle: Long)
}
