package com.spotifydashboard.librespot

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.spotifydashboard.librespot.playback.LocalPlaybackController
import com.spotifydashboard.librespot.playback.LocalPlaybackState
import com.spotifydashboard.librespot.playback.LocalPlaybackTrack
import org.json.JSONObject

/**
 * Capacitor bridge for the embedded librespot player.
 *
 * The JS side polls [getState] while the Player tab is visible. Playback itself
 * lives in [LocalPlaybackController] and the foreground service, so it keeps
 * running when the WebView is backgrounded or recreated.
 */
@CapacitorPlugin(name = "LibrespotPlayer")
class LibrespotPlayerPlugin : Plugin() {

    private val controller: LocalPlaybackController
        get() = LocalPlaybackController.get(context)

    @PluginMethod
    fun getState(call: PluginCall) {
        call.resolve(stateJson(controller.state.value).put("available", true))
    }

    @PluginMethod
    fun setEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        if (enabled) ensureNotificationPermission()
        controller.setEnabled(enabled)
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun setKeepConnected(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        controller.setKeepConnected(enabled)
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val raw = call.getArray("tracks")
        if (raw == null) {
            call.reject("tracks is required")
            return
        }
        val tracks = parseTracks(raw)
        if (tracks.isEmpty()) {
            call.reject("No playable tracks.")
            return
        }
        val startIndex = (call.getInt("startIndex", 0) ?: 0).coerceIn(0, tracks.lastIndex)
        controller.play(tracks, startIndex)
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun toggle(call: PluginCall) {
        controller.toggle()
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        controller.pause()
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        controller.resume()
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        controller.stop()
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun next(call: PluginCall) {
        controller.next()
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun previous(call: PluginCall) {
        controller.previous()
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun enqueue(call: PluginCall) {
        val track = parseOneTrack(call) ?: run { call.reject("track is required"); return }
        controller.enqueue(track)
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun insertNext(call: PluginCall) {
        val track = parseOneTrack(call) ?: run { call.reject("track is required"); return }
        controller.insertNext(track)
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun insertAt(call: PluginCall) {
        val index = call.getInt("index", 0) ?: 0
        val track = parseOneTrack(call) ?: run { call.reject("track is required"); return }
        controller.insertAt(index, track)
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val index = call.getInt("index", -1) ?: -1
        controller.removeAt(index)
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun move(call: PluginCall) {
        val from = call.getInt("from", -1) ?: -1
        val to = call.getInt("to", -1) ?: -1
        controller.move(from, to)
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun clearQueue(call: PluginCall) {
        controller.clearQueue()
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun playIndex(call: PluginCall) {
        val index = call.getInt("index", -1) ?: -1
        controller.playIndex(index)
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun seek(call: PluginCall) {
        val positionMs = call.getInt("positionMs", 0) ?: 0
        controller.seekTo(positionMs)
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun forgetAccount(call: PluginCall) {
        controller.forgetAccount()
        call.resolve(stateJson(controller.state.value))
    }

    @PluginMethod
    fun setSettings(call: PluginCall) {
        val bitrate = (call.getString("bitrate") ?: "160").toIntOrNull() ?: 160
        val bufferSeconds = (call.getInt("bufferSeconds", 2) ?: 2)
        val cacheMb = (call.getInt("cacheMb", 0) ?: 0)
        val deviceName = (call.getString("deviceName") ?: "").trim()
        val audioFocusPause = call.getBoolean("audioFocusPauseTransient", false) ?: false
        controller.setPlaybackSettings(bitrate, bufferSeconds, cacheMb, deviceName, audioFocusPause)
        call.resolve(settingsJson())
    }

    @PluginMethod
    fun getSettings(call: PluginCall) {
        call.resolve(settingsJson())
    }

    private fun settingsJson(): JSObject {
        val s = controller.settings()
        return JSObject().apply {
            put("bitrateKbps", s.bitrateKbps)
            put("bufferSeconds", s.bufferSeconds)
            put("cacheMb", s.cacheMb)
            put("deviceName", s.deviceName)
            put("audioFocusPauseTransient", s.audioFocusPauseTransient)
        }
    }

    private fun parseOneTrack(call: PluginCall): LocalPlaybackTrack? {
        val uri = (call.getString("uri") ?: "").trim()
        if (uri.isEmpty()) return null
        val title = call.getString("title") ?: ""
        val artist = call.getString("artist") ?: ""
        val durationMs = call.getInt("durationMs", 0) ?: 0
        val artUrl = call.getString("artUrl")?.takeIf { it.isNotBlank() }
        return LocalPlaybackTrack(uri = uri, title = title, artist = artist, durationMs = durationMs, artUrl = artUrl)
    }

    private fun parseTracks(array: JSArray): List<LocalPlaybackTrack> {
        val tracks = ArrayList<LocalPlaybackTrack>(array.length())
        for (index in 0 until array.length()) {
            val item: JSONObject = array.optJSONObject(index) ?: continue
            val uri = item.optString("uri", "").trim()
            if (uri.isEmpty()) continue
            tracks.add(
                LocalPlaybackTrack(
                    uri = uri,
                    title = item.optString("title", ""),
                    artist = item.optString("artist", ""),
                    durationMs = item.optInt("durationMs", 0),
                    artUrl = item.optString("artUrl", "").takeIf { it.isNotBlank() },
                )
            )
        }
        return tracks
    }

    private fun stateJson(state: LocalPlaybackState): JSObject = JSObject().apply {
        put("enabled", state.enabled)
        put("keepConnected", state.keepConnected)
        put("connected", state.connected)
        put("connecting", state.connecting)
        put("isPlaying", state.isPlaying)
        put("remote", state.remote)
        put("title", state.title)
        put("artist", state.artist)
        put("artUrl", state.artUrl ?: JSONObject.NULL)
        put("durationMs", state.durationMs)
        put("positionMs", state.positionMs)
        put("error", state.error ?: JSONObject.NULL)
        put("needsAuth", state.needsAuth)
        put("queueTotal", state.queue.size)
        put("queuePosition", state.queueIndex)
        // The JS player only renders the upcoming tracks. Serializing the whole
        // queue every poll is wasteful for very large playlists, so send a
        // window starting at the current track and expose the real totals.
        val queueStart = state.queueIndex.coerceAtLeast(0)
        val queueWindow = state.queue.drop(queueStart).take(STATE_QUEUE_LIMIT)
        put("queueIndex", if (queueWindow.isEmpty()) -1 else 0)
        put(
            "queue",
            JSArray().apply {
                queueWindow.forEach { track ->
                    put(
                        JSObject().apply {
                            put("uri", track.uri)
                            put("title", track.title)
                            put("artist", track.artist)
                            put("durationMs", track.durationMs)
                            put("artUrl", track.artUrl ?: JSONObject.NULL)
                        }
                    )
                }
            }
        )
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val activity = activity ?: return
        if (ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            activity.requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST,
            )
        }
    }

    private companion object {
        const val NOTIFICATION_PERMISSION_REQUEST = 4242
        const val STATE_QUEUE_LIMIT = 200
    }
}
