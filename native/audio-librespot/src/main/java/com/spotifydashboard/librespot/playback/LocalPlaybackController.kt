package com.spotifydashboard.librespot.playback

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.util.Log
import com.spotifydashboard.librespot.LibrespotEngine
import com.spotifydashboard.librespot.LibrespotPlayback
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One playable item in the local (librespot) queue. */
data class LocalPlaybackTrack(
    val uri: String,
    val title: String,
    val artist: String,
    val durationMs: Int,
    val artUrl: String?,
)

/** UI-facing snapshot of the experimental on-device playback session. */
data class LocalPlaybackState(
    val enabled: Boolean = false,
    val keepConnected: Boolean = false,
    val connected: Boolean = false,
    val connecting: Boolean = false,
    val isPlaying: Boolean = false,
    val remote: Boolean = false,
    val title: String = "",
    val artist: String = "",
    val artUrl: String? = null,
    val durationMs: Int = 0,
    /** Audible position (decoded position minus both audio buffer depths). */
    val positionMs: Int = 0,
    val error: String? = null,
    /** True when no stored credentials exist and the browser login is needed. */
    val needsAuth: Boolean = false,
    /** Snapshot of the local queue, including the current track. */
    val queue: List<LocalPlaybackTrack> = emptyList(),
    /** Index of the current track in [queue], or -1 when there is no queue. */
    val queueIndex: Int = -1,
)

/**
 * App-level controller for the experimental librespot playback: owns the
 * [LibrespotPlayback] session, the album queue, audio focus and the foreground
 * service.
 *
 * The librespot login is independent from the dashboard's Spotify login: the
 * first play opens the Spotify consent page (keymaster client, scope
 * `streaming`) and the resulting reusable credentials are stored app-privately,
 * so later starts are silent.
 *
 * All blocking native/network work runs on [Dispatchers.IO]; state is published
 * on [Dispatchers.Main]. Never call it from the main thread directly.
 */
class LocalPlaybackController private constructor(context: Context) {

    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    @Volatile
    private var playback = LibrespotPlayback(appContext)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _state = MutableStateFlow(
        LocalPlaybackState(
            enabled = prefs.getBoolean(KEY_ENABLED, false),
            keepConnected = prefs.getBoolean(KEY_KEEP_CONNECTED, false),
        )
    )
    val state: StateFlow<LocalPlaybackState> = _state.asStateFlow()

    private var queue: List<LocalPlaybackTrack> = emptyList()
    private var index = 0
    private var playJob: Job? = null
    private var connectJob: Job? = null
    private var recoveryJob: Job? = null
    private var ticker: Job? = null
    private var lastEngineState = LibrespotEngine.STATE_IDLE
    private var userStopped = true
    private var resumeOnFocusGain = false
    private var recoveryAttempts = 0
    private var recoveryPlayWhenReady = false

    @Volatile
    private var focusRequest: AudioFocusRequest? = null

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                resumeOnFocusGain = false
                pause()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                resumeOnFocusGain = _state.value.isPlaying
                pause()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                if (audioFocusPauseTransient()) {
                    resumeOnFocusGain = _state.value.isPlaying
                    pause()
                } else {
                    playback.setVolume(0.2f)
                }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                playback.setVolume(1f)
                if (resumeOnFocusGain) {
                    resumeOnFocusGain = false
                    resume()
                }
            }
        }
    }

    /** Persists the opt-in flag; disabling stops playback and tears the service down. */
    fun setEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply()
        _state.update { it.copy(enabled = enabled, error = if (enabled) it.error else null) }
        if (!enabled) {
            _state.update { it.copy(keepConnected = false) }
            prefs.edit().putBoolean(KEY_KEEP_CONNECTED, false).apply()
            recoveryJob?.cancel()
            recoveryJob = null
            recoveryAttempts = 0
            recoveryPlayWhenReady = false
            ticker?.cancel()
            ticker = null
            stop()
        } else {
            recoveryAttempts = 0
            recoveryPlayWhenReady = false
            if (prefs.getBoolean(KEY_KEEP_CONNECTED, false)) {
                // Keep the idle Connect service ready once the feature is on again.
                connectIdle()
            }
        }
    }

    fun setKeepConnected(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_KEEP_CONNECTED, enabled).apply()
        _state.update { it.copy(keepConnected = enabled) }
        if (enabled) {
            recoveryAttempts = 0
            recoveryPlayWhenReady = false
            if (!_state.value.enabled) setEnabled(true)
            connectIdle()
        } else {
            // If idle now, drop the persistent connection; a playing session
            // keeps going and closes when it stops.
            if (!_state.value.isPlaying && playback.isConnected) {
                scope.launch(Dispatchers.IO) { runCatching { playback.stop(disconnect = true) } }
                LocalPlaybackService.stop(appContext)
                _state.update { it.copy(connected = false) }
            }
        }
    }

    val defaultDeviceName: String
        get() = "reSpotIt (${Build.MODEL})"

    fun audioFocusPauseTransient(): Boolean =
        prefs.getBoolean(KEY_LOCAL_AUDIO_FOCUS, false)

    data class LocalPlaybackSettings(
        val bitrateKbps: Int = 160,
        val bufferSeconds: Int = 2,
        val cacheMb: Int = 0,
        val deviceName: String = "reSpotIt",
        val audioFocusPauseTransient: Boolean = false,
    )

    fun settings(): LocalPlaybackSettings = LocalPlaybackSettings(
        bitrateKbps = prefs.getInt(KEY_LOCAL_BITRATE_KBPS, 160).coerceIn(96, 320),
        bufferSeconds = prefs.getInt(KEY_LOCAL_BUFFER_SECONDS, 2).coerceIn(1, 8),
        cacheMb = prefs.getInt(KEY_LOCAL_CACHE_MB, 0).coerceAtLeast(0),
        deviceName = prefs.getString(KEY_LOCAL_DEVICE_NAME, defaultDeviceName).orEmpty().ifBlank { defaultDeviceName },
        audioFocusPauseTransient = prefs.getBoolean(KEY_LOCAL_AUDIO_FOCUS, false),
    )

    fun setPlaybackSettings(
        bitrateKbps: Int,
        bufferSeconds: Int,
        cacheMb: Int,
        deviceName: String,
        audioFocusPauseTransient: Boolean,
    ) {
        prefs.edit()
            .putInt(KEY_LOCAL_BITRATE_KBPS, bitrateKbps.coerceIn(96, 320))
            .putInt(KEY_LOCAL_BUFFER_SECONDS, bufferSeconds.coerceIn(1, 8))
            .putInt(KEY_LOCAL_CACHE_MB, cacheMb.coerceAtLeast(0))
            .putString(KEY_LOCAL_DEVICE_NAME, deviceName.ifBlank { defaultDeviceName })
            .putBoolean(KEY_LOCAL_AUDIO_FOCUS, audioFocusPauseTransient)
            .apply()
        applySettingsChanges()
    }

    fun applySettingsChanges() {
        scope.launch {
            withContext(Dispatchers.IO) { resetPlaybackSession() }
            if (_state.value.enabled) {
                if (_state.value.isPlaying && queue.isNotEmpty()) connectAndStart() else connectIdle()
            }
        }
    }

    private fun connectIdle() {
        if (!_state.value.enabled) return
        if (playback.isConnected && !playback.hasClosedChannel) {
            LocalPlaybackService.start(appContext)
            startTicker()
            return
        }
        if (playback.isConnected && playback.hasClosedChannel) {
            if (recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
                recoveryAttempts++
                scheduleRecovery(playWhenReady = false)
            } else {
                _state.update { it.copy(error = playback.lastError ?: "Could not connect to Spotify.") }
            }
            return
        }
        if (connectJob?.isActive == true) return
        _state.update { it.copy(connecting = true, error = null, needsAuth = false) }
        connectJob = scope.launch {
            val connected = withContext(Dispatchers.IO) {
                runCatching { playback.connect(allowInteractive = true) }.getOrDefault(false)
            }
            val error = if (connected) null else {
                playback.lastConnectError ?: "Could not connect to Spotify."
            }
            _state.update {
                it.copy(
                    connecting = false,
                    connected = connected,
                    needsAuth = !connected && !playback.hasStoredCredentials(),
                    error = error,
                )
            }
            if (connected) {
                connectJob = null
                recoveryAttempts = 0
                LocalPlaybackService.start(appContext)
                startTicker()
            } else {
                connectJob = null
                if (canRetryConnect()) {
                    recoveryAttempts++
                    scheduleRecovery(playWhenReady = false)
                } else {
                    LocalPlaybackService.stop(appContext)
                }
            }
        }
    }

    /**
     * Plays [tracks] starting at [startIndex]. Connects (and, on first use,
     * opens the Spotify consent page) before the first track starts.
     */
    fun play(tracks: List<LocalPlaybackTrack>, startIndex: Int = 0) {
        if (!_state.value.enabled) {
            _state.update { it.copy(error = "Enable experimental local playback first.") }
            return
        }
        val playable = tracks.filter { it.uri.isNotBlank() }
        if (playable.isEmpty()) {
            _state.update { it.copy(error = "No playable tracks here.") }
            return
        }
        // If a recovery reset is already in flight, let it start this new queue
        // instead of racing it with a second connect.
        val recovering = recoveryJob?.isActive == true
        if (recovering) {
            recoveryPlayWhenReady = true
        } else {
            recoveryJob?.cancel()
            recoveryJob = null
            recoveryPlayWhenReady = false
        }
        recoveryAttempts = 0
        queue = playable
        index = startIndex.coerceIn(0, playable.lastIndex)
        userStopped = false
        publishQueue()
        // Start the foreground service while the app is still in the foreground:
        // the first play continues after the browser OAuth, when the app is
        // backgrounded, and Android 12+ rejects a background FGS start.
        LocalPlaybackService.start(appContext)
        if (!recovering) connectAndStart()
    }

    /** Play/pause toggle for the mini player and notification. */
    fun toggle() {
        when (playback.state) {
            LibrespotEngine.STATE_PLAYING -> pause()
            LibrespotEngine.STATE_PAUSED -> resume()
            else -> {
                if (queue.isNotEmpty()) {
                    userStopped = false
                    if (playback.isConnected && !playback.hasClosedChannel) {
                        startCurrent()
                    } else {
                        connectAndStart()
                    }
                }
            }
        }
    }

    fun pause() {
        if (playback.state != LibrespotEngine.STATE_PLAYING) return
        scope.launch(Dispatchers.IO) { runCatching { playback.pause() } }
        abandonFocus()
        _state.update { it.copy(isPlaying = false) }
    }

    fun resume() {
        if (!playback.isConnected || playback.hasClosedChannel) {
            if (queue.isEmpty()) return
            userStopped = false
            connectAndStart()
            return
        }
        when (playback.state) {
            LibrespotEngine.STATE_PAUSED -> scope.launch {
                if (requestFocus()) {
                    withContext(Dispatchers.IO) { runCatching { playback.play() } }
                    LocalPlaybackService.start(appContext)
                    _state.update { it.copy(isPlaying = true) }
                    startTicker()
                }
            }
            LibrespotEngine.STATE_IDLE, LibrespotEngine.STATE_UNAVAILABLE -> {
                if (isRemotePlayback()) {
                    scope.launch {
                        if (requestFocus()) {
                            withContext(Dispatchers.IO) { runCatching { playback.play() } }
                            LocalPlaybackService.start(appContext)
                            _state.update { it.copy(isPlaying = true) }
                            startTicker()
                        }
                    }
                } else if (queue.isNotEmpty()) {
                    userStopped = false
                    startCurrent()
                }
            }
            else -> Unit
        }
    }

    fun stop() {
        userStopped = true
        recoveryJob?.cancel()
        recoveryJob = null
        connectJob?.cancel()
        connectJob = null
        recoveryAttempts = 0
        recoveryPlayWhenReady = false
        playJob?.cancel()
        playJob = null
        scope.launch(Dispatchers.IO) {
            runCatching { playback.stop(disconnect = !_state.value.keepConnected) }
        }
        abandonFocus()
        if (!_state.value.keepConnected) {
            LocalPlaybackService.stop(appContext)
        }
        _state.update {
            it.copy(
                connecting = false,
                remote = playback.currentTrack != null,
                isPlaying = false,
                positionMs = 0,
            )
        }
    }

    fun next() {
        if (isRemotePlayback()) {
            scope.launch(Dispatchers.IO) { runCatching { playback.next() } }
            return
        }
        if (queue.isEmpty()) return
        if (index + 1 < queue.size) {
            index++
            userStopped = false
            publishQueue()
            startCurrent()
        }
    }

    fun previous() {
        if (isRemotePlayback()) {
            scope.launch(Dispatchers.IO) { runCatching { playback.previous() } }
            return
        }
        if (queue.isEmpty()) return
        if (playback.positionMs > RESTART_THRESHOLD_MS && playback.isConnected) {
            seekTo(0)
            return
        }
        if (index > 0) index--
        userStopped = false
        publishQueue()
        startCurrent()
    }

    /** Append a track to the end of the currently active local queue. */
    fun enqueue(track: LocalPlaybackTrack) {
        queue += track
        publishQueue()
    }

    /** Insert a track immediately after the track that is currently playing. */
    fun insertNext(track: LocalPlaybackTrack) {
        val insertion = if (queue.isEmpty()) 0 else (index + 1).coerceIn(0, queue.size)
        queue = queue.toMutableList().apply { add(insertion, track) }
        publishQueue()
    }

    /** Insert a track at an exact queue position, clamped to the current queue size. */
    fun insertAt(index: Int, track: LocalPlaybackTrack) {
        val target = index.coerceIn(0, queue.size)
        queue = queue.toMutableList().apply { add(target, track) }
        if (target <= this.index) this.index++
        publishQueue()
    }

    /** Remove the track at [index]. Playing continues when the current index survives. */
    fun removeAt(index: Int) {
        if (index !in queue.indices) return
        val removingCurrent = index == this.index
        queue = queue.toMutableList().apply { removeAt(index) }
        if (queue.isEmpty()) {
            this.index = 0
        } else if (removingCurrent) {
            this.index = this.index.coerceIn(0, queue.lastIndex)
        } else if (index < this.index) {
            this.index--
        }
        publishQueue()
        if (removingCurrent && queue.isNotEmpty()) startCurrent()
    }

    /** Move a queued track from one position to another. */
    fun move(fromIndex: Int, toIndex: Int) {
        if (fromIndex !in queue.indices || toIndex !in queue.indices) return
        val movingCurrent = fromIndex == index
        val list = queue.toMutableList()
        val item = list.removeAt(fromIndex)
        list.add(toIndex, item)
        queue = list
        index = when {
            movingCurrent -> toIndex
            fromIndex < index && toIndex >= index -> index - 1
            fromIndex > index && toIndex <= index -> index + 1
            else -> index
        }
        publishQueue()
    }

    /** Clear the entire queue and stop further playback. */
    fun clearQueue() {
        queue = emptyList()
        index = 0
        publishQueue()
        stop()
    }

    /** Jump to a specific index in the current local queue. */
    fun playIndex(targetIndex: Int) {
        if (targetIndex !in queue.indices) return
        index = targetIndex
        userStopped = false
        publishQueue()
        startCurrent()
    }

    fun seekTo(positionMs: Int) {
        if (!playback.isConnected) return
        val target = positionMs.coerceAtLeast(0)
        _state.update { it.copy(positionMs = target) }
        scope.launch(Dispatchers.IO) {
            runCatching { playback.seekTo(target) }
        }
    }

    /**
     * Deletes the stored librespot credentials. The live session keeps its
     * token until the process restarts; the next connect will need the browser.
     */
    fun forgetAccount() {
        userStopped = true
        recoveryJob?.cancel()
        recoveryJob = null
        connectJob?.cancel()
        connectJob = null
        recoveryAttempts = 0
        recoveryPlayWhenReady = false
        playJob?.cancel()
        playJob = null
        ticker?.cancel()
        ticker = null
        prefs.edit().putBoolean(KEY_KEEP_CONNECTED, false).apply()
        abandonFocus()
        LocalPlaybackService.stop(appContext)
        queue = emptyList()
        index = 0
        _state.update {
            it.copy(
                isPlaying = false,
                connected = false,
                connecting = false,
                needsAuth = true,
                title = "",
                artist = "",
                artUrl = null,
                durationMs = 0,
                positionMs = 0,
                error = null,
                keepConnected = false,
                queue = emptyList(),
                queueIndex = -1,
            )
        }
        scope.launch(Dispatchers.IO) {
            val old = playback
            runCatching { old.stop() }
            runCatching { old.close() }
            playback = LibrespotPlayback(appContext)
            playback.forgetAccount()
        }
    }

    private fun connectAndStart() {
        if (playback.isConnected && !playback.hasClosedChannel) {
            startCurrent()
            return
        }
        if (playback.isConnected && playback.hasClosedChannel) {
            if (recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
                recoveryAttempts++
                scheduleRecovery(playWhenReady = true)
            } else {
                _state.update { it.copy(error = playback.lastError ?: "Could not connect to Spotify.") }
            }
            return
        }
        if (connectJob?.isActive == true) return
        _state.update { it.copy(connecting = true, error = null, needsAuth = false) }
        connectJob = scope.launch {
            val connected = withContext(Dispatchers.IO) {
                runCatching { playback.connect(allowInteractive = true) }.getOrDefault(false)
            }
            val error = if (connected) null else {
                playback.lastConnectError ?: "Could not connect to Spotify."
            }
            _state.update {
                it.copy(
                    connecting = false,
                    connected = connected,
                    needsAuth = !connected && !playback.hasStoredCredentials(),
                    error = error,
                )
            }
            if (connected) {
                connectJob = null
                if (queue.isNotEmpty()) {
                    startCurrent()
                } else {
                    recoveryAttempts = 0
                    _state.update { it.copy(connected = true, error = null) }
                    startTicker()
                }
            } else {
                connectJob = null
                if (canRetryConnect()) {
                    recoveryAttempts++
                    scheduleRecovery(playWhenReady = true)
                } else {
                    LocalPlaybackService.stop(appContext)
                }
            }
        }
    }

    private fun isRemotePlayback(): Boolean {
        val native = playback.currentTrack ?: return false
        if (native.uri.isBlank()) return false
        val local = queue.getOrNull(index)?.uri
        return local.isNullOrBlank() || local != native.uri
    }

    private fun startCurrent() {
        val track = queue.getOrNull(index) ?: return
        playJob?.cancel()
        _state.update {
            it.copy(
                title = track.title,
                artist = track.artist,
                artUrl = track.artUrl,
                durationMs = track.durationMs,
                positionMs = 0,
                isPlaying = false,
                error = null,
                connected = true,
                queue = queue,
                queueIndex = index,
            )
        }
        playJob = scope.launch {
            val ok = withContext(Dispatchers.IO) {
                if (!playback.load(track.uri)) {
                    false
                } else {
                    runCatching { playback.play() }.isSuccess
                }
            }
            if (!ok) {
                val message = playback.lastError ?: "Could not play this track."
                _state.update { it.copy(isPlaying = false, error = message) }
                if (recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
                    recoveryAttempts++
                    playJob = null
                    scheduleRecovery(playWhenReady = true)
                }
                return@launch
            }
            recoveryAttempts = 0
            if (!requestFocus()) {
                _state.update { it.copy(error = "Another app is using the audio output.") }
            }
            LocalPlaybackService.start(appContext)
            _state.update { it.copy(isPlaying = true) }
            startTicker()
        }
    }

    private fun publishQueue() {
        _state.update {
            it.copy(
                queue = queue,
                queueIndex = if (queue.isEmpty()) -1 else index,
            )
        }
    }

    private fun canRetryConnect(): Boolean =
        recoveryAttempts < MAX_RECOVERY_ATTEMPTS && playback.hasStoredCredentials()

    /**
     * Drops the dead librespot session and retries once/twice. Toggling local
     * playback off/on used to be the manual workaround for the native
     * "Channel closed" error; this does the same reset automatically.
     */
    private fun scheduleRecovery(playWhenReady: Boolean) {
        if (!_state.value.enabled) return
        if (playWhenReady) recoveryPlayWhenReady = true
        if (recoveryJob?.isActive == true) return
        recoveryJob = scope.launch {
            delay(RECOVERY_DELAY_MS)
            withContext(Dispatchers.IO) { resetPlaybackSession() }
            recoveryJob = null
            val shouldPlay = recoveryPlayWhenReady
            recoveryPlayWhenReady = false
            if (!_state.value.enabled) return@launch
            if (shouldPlay) {
                if (userStopped) return@launch
                connectAndStart()
            } else if (_state.value.keepConnected) {
                connectIdle()
            }
        }
    }

    private suspend fun resetPlaybackSession() {
        playJob?.cancel()
        playJob = null
        ticker?.cancel()
        ticker = null
        lastEngineState = LibrespotEngine.STATE_IDLE
        val old = playback
        playback = LibrespotPlayback(appContext)
        _state.update {
            it.copy(
                connected = false,
                connecting = false,
                isPlaying = false,
                remote = false,
                positionMs = 0,
            )
        }
        runCatching { old.stop(disconnect = true) }
        runCatching { old.close() }
    }

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                val engineState = playback.state
                val playing = engineState == LibrespotEngine.STATE_PLAYING
                val bufferedSamples = playback.bufferedSamples
                val native = playback.currentTrack
                val remote = native != null && native.uri.isNotBlank() &&
                    (queue.getOrNull(index)?.uri.isNullOrBlank() || queue.getOrNull(index)?.uri != native.uri)
                val connected = playback.isConnected && !playback.hasClosedChannel
                _state.update {
                    it.copy(
                        connected = connected,
                        isPlaying = playing,
                        remote = remote && connected,
                        positionMs = playback.audiblePositionMs,
                        title = if (native != null && native.title.isNotBlank()) native.title else it.title,
                        artist = if (native != null && native.artist.isNotBlank()) native.artist else it.artist,
                        artUrl = if (native != null && !native.artUrl.isNullOrBlank()) native.artUrl else it.artUrl,
                        durationMs = if (native != null && native.durationMs > 0) native.durationMs else it.durationMs,
                    )
                }
                if (playing) {
                    lastEngineState = engineState
                } else if (!remote && lastEngineState == LibrespotEngine.STATE_PLAYING &&
                    engineState == LibrespotEngine.STATE_IDLE &&
                    bufferedSamples == 0L &&
                    !userStopped
                ) {
                    // EndOfTrack fires when the decoder finishes, but the sink
                    // may still hold up to ~8 s of audio. Only advance once the
                    // native and AudioTrack buffers are fully drained.
                    lastEngineState = engineState
                    if (index + 1 < queue.size) {
                        index++
                        publishQueue()
                        startCurrent()
                    } else {
                        finishQueue()
                    }
                }
                delay(TICK_MS)
            }
        }
    }

    private fun finishQueue() {
        userStopped = true
        abandonFocus()
        LocalPlaybackService.stop(appContext)
        _state.update { it.copy(isPlaying = false, positionMs = 0) }
    }

    private fun requestFocus(): Boolean {
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setOnAudioFocusChangeListener(focusListener)
                .build()
                .also { focusRequest = it }
            audioManager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                focusListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN,
            )
        }
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun abandonFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(focusListener)
        }
    }

    init {
        // Auto-register as a Spotify Connect device on app start so another
        // client can find this device without having to start a local track.
        // Only when the user explicitly opted into keep-connected.
        if (_state.value.enabled && _state.value.keepConnected) {
            Log.i(TAG, "controller created with keep-connected on; starting idle Connect")
            connectIdle()
        }
    }

    companion object {
    private const val TAG = "LocalPlayback"
        private const val PREFS = "local_playback"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_KEEP_CONNECTED = "keep_connected"
    private const val KEY_LOCAL_BITRATE_KBPS = "local_bitrate_kbps"
    private const val KEY_LOCAL_BUFFER_SECONDS = "local_buffer_seconds"
    private const val KEY_LOCAL_CACHE_MB = "local_cache_mb"
    private const val KEY_LOCAL_DEVICE_NAME = "local_device_name"
    private const val KEY_LOCAL_AUDIO_FOCUS = "local_audio_focus_pause"
        private const val TICK_MS = 500L
        private const val RESTART_THRESHOLD_MS = 3_000
        private const val MAX_RECOVERY_ATTEMPTS = 2
        private const val RECOVERY_DELAY_MS = 350L

        @Volatile
        private var instance: LocalPlaybackController? = null

        fun get(context: Context): LocalPlaybackController =
            instance ?: synchronized(this) {
                instance ?: LocalPlaybackController(context.applicationContext).also {
                    instance = it
                    Log.i(TAG, "controller created (enabled=${it._state.value.enabled})")
                }
            }
    }
}
