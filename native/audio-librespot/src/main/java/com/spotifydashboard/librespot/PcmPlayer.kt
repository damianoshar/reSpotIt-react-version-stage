package com.spotifydashboard.librespot

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Process
import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Streams PCM pulled from a [PcmSource] (in production:
 * [LibrespotEngine.readPcm]) into a streaming [AudioTrack].
 *
 * Format: 44 100 Hz, stereo, 16-bit PCM — matches the native engine output.
 *
 * Lifecycle contract:
 * - [close] this **before** closing the underlying [LibrespotEngine] (the drain
 *   thread calls into it).
 * - [start]/[pause] map to the engine's play/pause; [stop] also discards any
 *   audio buffered in the track, so a later [start] begins clean.
 *
 * Audio focus is deliberately NOT handled here (needs a Context); the app layer
 * requests focus around [start]/[pause] (see the pre-O guard pattern used in
 * `kotlin-player`).
 */
class PcmPlayer(
    private val source: PcmSource,
    private val sampleRate: Int = LibrespotEngine.SAMPLE_RATE_HZ,
    private val channelCount: Int = LibrespotEngine.CHANNEL_COUNT,
) : Closeable {

    fun interface PcmSource {
        /** Fills `out` with interleaved samples; returns how many were written (0 = none). */
        fun read(out: ShortArray): Int
    }

    private companion object {
        const val IDLE_POLL_MS = 2L
        const val JOIN_TIMEOUT_MS = 1_500L
        const val CHUNK_SAMPLES = LibrespotBridge.PCM_CHUNK_SAMPLES
    }

    private val lock = Any()
    private val running = AtomicBoolean(false)
    private val writtenSamples = AtomicLong(0)

    private var track: AudioTrack? = null
    private var drainThread: Thread? = null

    /** Total samples (both channels) handed to the AudioTrack so far. */
    val totalSamplesWritten: Long get() = writtenSamples.get()

    /** True while the underlying track is in the playing state. */
    val isPlaying: Boolean
        get() = synchronized(lock) { track?.playState == AudioTrack.PLAYSTATE_PLAYING }

    /**
     * Interleaved samples written to the track but not played yet (the
     * AudioTrack's own queue depth). Used together with the native PCM buffer
     * depth to compute the audible position.
     */
    val bufferedSamples: Long
        get() = synchronized(lock) {
            val current = track ?: return 0L
            // getPlaybackHeadPosition() is an unsigned 32-bit frame counter.
            val playedFrames = current.playbackHeadPosition.toLong() and 0xFFFF_FFFFL
            val playedSamples = playedFrames * channelCount
            (writtenSamples.get() - playedSamples).coerceAtLeast(0L)
        }

    /** Creates the track if needed and starts draining. Idempotent. */
    fun start() {
        synchronized(lock) {
            val current = track ?: createTrack().also { track = it }
            if (running.compareAndSet(false, true)) {
                current.play()
                val worker = Thread({ drainLoop(current) }, "LibrespotPcmDrain")
                worker.isDaemon = true
                drainThread = worker
                worker.start()
            } else {
                current.play()
            }
        }
    }

    /** Pauses playback; buffered audio is kept for a later [start]. */
    fun pause() {
        synchronized(lock) {
            track?.pause()
        }
    }

    /**
     * Stops draining and releases the track (dropping buffered audio).
     * A later [start] creates a fresh track. Idempotent.
     */
    fun stop() {
        val worker: Thread?
        val oldTrack: AudioTrack?
        synchronized(lock) {
            running.set(false)
            worker = drainThread
            drainThread = null
            oldTrack = track
            track = null
        }
        // Unblock a writer parked in AudioTrack.write, then let the thread exit.
        oldTrack?.let {
            runCatching { it.stop() }
            runCatching { it.flush() }
        }
        worker?.join(JOIN_TIMEOUT_MS)
        oldTrack?.let { runCatching { it.release() } }
        writtenSamples.set(0)
    }

    /**
     * Drops audio already queued in the AudioTrack (used before a seek) and
     * restarts the drain on a fresh track, preserving the play/pause state.
     */
    fun flush() {
        val wasRunning = running.get()
        val wasPlaying = isPlaying
        stop()
        if (wasRunning) {
            start()
            if (!wasPlaying) pause()
        }
    }

    override fun close() = stop()

    private fun drainLoop(current: AudioTrack) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        val chunk = ShortArray(CHUNK_SAMPLES)
        try {
            while (running.get()) {
                val read = source.read(chunk)
                if (read > 0) {
                    val written = current.write(chunk, 0, read)
                    if (written > 0) {
                        writtenSamples.addAndGet(written.toLong())
                    } else if (written < 0) {
                        // Track in an error state (e.g. released concurrently): exit.
                        break
                    }
                } else {
                    Thread.sleep(IDLE_POLL_MS)
                }
            }
        } catch (_: InterruptedException) {
            // Normal shutdown.
        } catch (_: IllegalStateException) {
            // Track released concurrently with a write: exit.
        }
    }

    private fun createTrack(): AudioTrack {
        check(channelCount == 2) { "only stereo is supported (got $channelCount channels)" }
        val channelMask = AudioFormat.CHANNEL_OUT_STEREO
        val encoding = AudioFormat.ENCODING_PCM_16BIT
        val minBytes = AudioTrack.getMinBufferSize(sampleRate, channelMask, encoding)
        check(minBytes > 0) { "AudioTrack.getMinBufferSize failed ($minBytes)" }
        val chunkBytes = CHUNK_SAMPLES * 2 /* bytes per sample */ * channelCount
        val bufferBytes = maxOf(minBytes, chunkBytes * 2)

        val built = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(encoding)
                    .setSampleRate(sampleRate)
                    .setChannelMask(channelMask)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(bufferBytes)
            .build()

        if (built.state != AudioTrack.STATE_INITIALIZED) {
            runCatching { built.release() }
            error("AudioTrack failed to initialize")
        }
        return built
    }
}
