package com.spotifydashboard.librespot

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.Closeable
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * High-level, app-facing playback session: owns the native engine and the
 * `AudioTrack` drain, authenticates with stored credentials when possible and
 * keeps them in app-private storage.
 *
 * Login order in [connect]:
 * 1. persisted reusable credentials β†’ `loginStored` (silent, no expiry);
 * 2. otherwise (first run, or Spotify revoked the credentials) an interactive
 *    browser OAuth β†’ `login` β†’ the session's credentials are persisted.
 *
 * Blocking: [connect] waits for the network and, on first run, the browser
 * round-trip. Call it from a worker thread (e.g. `Dispatchers.IO`), never from
 * the main thread. [state]/[positionMs] are cheap and safe from any thread.
 */
class LibrespotPlayback(
    context: Context,
    cacheDir: File = context.cacheDir,
) : Closeable {

    private val appContext = context.applicationContext
    private val cacheDir = cacheDir
    private val prefs = appContext.getSharedPreferences("local_playback", Context.MODE_PRIVATE)
    private val credentialsStore = LibrespotCredentialsStore(appContext)

    private fun configuredDeviceName(): String =
        prefs.getString("local_device_name", "reSpotIt (${Build.MODEL})").orEmpty()
            .ifBlank { "reSpotIt (${Build.MODEL})" }

    private fun configuredBitrateKbps(): Int =
        prefs.getInt("local_bitrate_kbps", 160)

    private fun configuredBufferSeconds(): Int =
        prefs.getInt("local_buffer_seconds", 2)

    private fun configuredCacheMb(): Int =
        prefs.getInt("local_cache_mb", 0)

    private val lock = Any()
    @Volatile
    private var closed = false
    private var connecting = false

    @Volatile
    private var engine: LibrespotEngine? = null

    @Volatile
    private var player: PcmPlayer? = null

    private val monitorRunning = AtomicBoolean(false)
    private var stateMonitor: Thread? = null

    /** Last login/authorization failure (null after a successful [connect]). */
    @Volatile
    var lastConnectError: String? = null
        private set

    val isConnected: Boolean get() = engine != null

    /** One of [LibrespotEngine.STATE_IDLE] ... [LibrespotEngine.STATE_UNAVAILABLE]. */
    val state: Int get() = engine?.state ?: LibrespotEngine.STATE_IDLE

    /** Decoded stream position (can run ahead of audible audio by the buffer depth). */
    val positionMs: Int get() = engine?.positionMs ?: 0

    /**
     * Interleaved samples still queued: decoded in the native PCM buffer plus
     * written-but-unplayed samples in the AudioTrack.
     */
    val bufferedSamples: Long
        get() = (engine?.bufferedSamples ?: 0).toLong() + (player?.bufferedSamples ?: 0L)

    /**
     * Position the user actually hears: the decoded position minus the audio
     * still queued in the native PCM buffer and in the AudioTrack. Use this for
     * progress bars; [positionMs] can lead by several seconds.
     */
    val audiblePositionMs: Int
        get() {
            val bufferedMs = bufferedSamples * 1000L /
                (LibrespotEngine.SAMPLE_RATE_HZ.toLong() * LibrespotEngine.CHANNEL_COUNT)
            return (positionMs - bufferedMs).coerceAtLeast(0L).toInt()
        }

    /** Last native playback error, or null. */
    val lastError: String? get() = engine?.lastError

    /**
     * True when the native channel has been closed. librespot reports this as
     * "Channel closed"; the engine object can still be non-null, so it must not
     * be treated as a usable session.
     */
    val hasClosedChannel: Boolean
        get() = lastError?.contains("channel closed", ignoreCase = true) == true

    /** Track currently decoded by the player (local or remote Connect). */
    val currentTrack: LibrespotTrack? get() = engine?.currentTrack

    /** True when a silent [connect] can reuse credentials (no browser needed). */
    fun hasStoredCredentials(): Boolean = credentialsStore.load() != null

    /**
     * Establishes a playback session.
     *
     * @param allowInteractive when false, only stored credentials are tried
     *   (useful for "silent start" checks before prompting the user).
     * @return true when the session is connected; see [lastConnectError].
     */
    fun connect(
        allowInteractive: Boolean = true,
        port: Int = LibrespotAuth.DEFAULT_PORT,
        timeoutMs: Long = LibrespotAuth.DEFAULT_TIMEOUT_MS,
    ): Boolean {
        synchronized(lock) {
            if (closed) return false
            if (engine != null) return true
            if (connecting) return false
            connecting = true
        }

        var created: LibrespotEngine? = null
        try {
            val candidate = LibrespotEngine.create(
                cacheDir,
                configuredDeviceName(),
                configuredBitrateKbps(),
                configuredBufferSeconds(),
                configuredCacheMb(),
            )
            created = candidate

            val stored = credentialsStore.load()
            if (stored != null) {
                if (candidate.loginStored(stored.username, stored.authDataB64)) {
                    Log.i(TAG, "connected with stored credentials (${stored.username})")
                    lastConnectError = null
                    val attached = attach(candidate)
                    Log.i(TAG, "attach(candidate) returned $attached (engine=${engine != null})")
                    if (attached) created = null
                    return attached
                }
                lastConnectError = candidate.lastError
                Log.w(TAG, "stored credentials rejected (${lastConnectError}); clearing")
                credentialsStore.clear()
            }

            if (!allowInteractive) {
                if (lastConnectError == null) lastConnectError = "no stored credentials"
                return false
            }

            val token = try {
                LibrespotAuth.authorize(appContext, port, timeoutMs)
            } catch (e: Exception) {
                lastConnectError = e.message ?: e.javaClass.simpleName
                Log.w(TAG, "interactive authorization failed: $lastConnectError")
                return false
            }

            if (!candidate.login(token)) {
                lastConnectError = candidate.lastError ?: "token login failed"
                Log.w(TAG, "token login failed: $lastConnectError")
                return false
            }

            candidate.storedCredentials?.let { (username, authData) ->
                credentialsStore.save(username, authData)
                Log.i(TAG, "stored reusable credentials for $username")
            }

            lastConnectError = null
            val attached = attach(candidate)
            if (attached) created = null
            return attached
        } catch (e: Exception) {
            lastConnectError = e.message ?: e.javaClass.simpleName
            Log.w(TAG, "connect failed: $lastConnectError")
            return false
        } finally {
            synchronized(lock) { connecting = false }
            created?.close()
        }
    }

    /** Loads and starts a playable URI (`spotify:track:...` / `spotify:episode:...`). */
    fun load(uri: String): Boolean = engine?.load(uri) ?: false

    fun play() {
        player?.start()
        engine?.play()
    }

    fun pause() {
        engine?.pause()
        player?.pause()
    }

    fun stop(disconnect: Boolean = true) {
        if (disconnect) engine?.stop() else engine?.stopPlayback()
        player?.stop()
    }

    fun next() { engine?.next() }
    fun previous() { engine?.previous() }

    /**
     * Seeks and drops pre-seek audio: the native engine clears its decoded PCM
     * buffer and the AudioTrack queue is flushed, so playback resumes at the
     * requested position instead of replaying several seconds of stale audio.
     */
    fun seekTo(positionMs: Int) {
        engine?.seekTo(positionMs)
        player?.flush()
    }

    /** 0.0..1.0 attenuation factor applied by the player (soft). */
    fun setVolume(factor: Float) {
        engine?.setVolume(factor)
    }

    /** Drops persisted credentials (next [connect] needs the browser again). */
    fun forgetAccount() {
        credentialsStore.clear()
    }

    override fun close() {
        val oldPlayer: PcmPlayer?
        val oldEngine: LibrespotEngine?
        synchronized(lock) {
            if (closed) return
            closed = true
            oldPlayer = player
            oldEngine = engine
            player = null
            engine = null
        }
        // The drain thread calls into the engine: stop it first.
        monitorRunning.set(false)
        stateMonitor?.interrupt()
        try {
            stateMonitor?.join(500)
        } catch (_: InterruptedException) {
            // Expected when the monitor is already shut down.
        }
        stateMonitor = null
        oldPlayer?.close()
        oldEngine?.close()
    }

    private fun attach(candidate: LibrespotEngine): Boolean {
        synchronized(lock) {
            if (closed || engine != null) return false
            engine = candidate
            player = PcmPlayer(source = { out -> candidate.readPcm(out) })
        }
        startStateMonitor(candidate)
        return true
    }

    private fun startStateMonitor(candidate: LibrespotEngine) {
        monitorRunning.set(true)
        stateMonitor = Thread({
            try {
                while (monitorRunning.get() && !closed) {
                    val active = player ?: break
                    when (candidate.state) {
                        LibrespotEngine.STATE_PLAYING -> active.start()
                        LibrespotEngine.STATE_PAUSED -> active.pause()
                        else -> Unit
                    }
                    try {
                        Thread.sleep(100L)
                    } catch (_: InterruptedException) {
                        break
                    }
                }
            } catch (_: Exception) {
                // Ignore: the engine may be closed while we are waking up.
            }
        }, "LibrespotStateMonitor")
        stateMonitor?.isDaemon = true
        stateMonitor?.start()
    }

    private companion object {
        const val TAG = "LibrespotPlayback"
    }
}
