package com.spotifydashboard.librespot.playback

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.spotifydashboard.librespot.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps the experimental local playback alive while the app is in the
 * background and exposes play/pause/next/stop through a media notification.
 *
 * The service does not own the player: it drives the process-wide
 * [LocalPlaybackController] and mirrors its state into the notification.
 */
class LocalPlaybackService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var observer: Job? = null
    private lateinit var controller: LocalPlaybackController

    override fun onCreate() {
        super.onCreate()
        controller = LocalPlaybackController.get(this)
        createChannel()
        observer = scope.launch {
            controller.state
                .map {
                    NotificationKey(
                        title = it.title,
                        artist = it.artist,
                        isPlaying = it.isPlaying,
                        connecting = it.connecting,
                    )
                }
                .distinctUntilChanged()
                .collect {
                    val manager = getSystemService(NotificationManager::class.java)
                    manager.notify(NOTIFICATION_ID, buildNotification(controller.state.value))
                }
        }
    }

    private data class NotificationKey(
        val title: String,
        val artist: String,
        val isPlaying: Boolean,
        val connecting: Boolean,
    )

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startForeground(NOTIFICATION_ID, buildNotification(controller.state.value))
            ACTION_PLAY_PAUSE -> controller.toggle()
            ACTION_NEXT -> controller.next()
            ACTION_PREVIOUS -> controller.previous()
            ACTION_STOP -> {
                controller.stop()
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        // The observer also posts the notification as a regular notification
        // (same id as the FGS one), so stopping the service alone leaves it in
        // the shade. Remove both explicitly.
        stopForeground(STOP_FOREGROUND_REMOVE)
        getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Local playback",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Controls experimental on-device Spotify playback"
                setShowBadge(false)
            }
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(state: LocalPlaybackState): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(
                when {
                    state.title.isNotBlank() -> state.title
                    state.connecting -> "Connecting to Spotify…"
                    else -> "Local playback"
                }
            )
            .setContentText(
                when {
                    state.artist.isNotBlank() -> state.artist
                    state.connecting -> "Complete the login in the browser"
                    else -> "Experimental librespot playback"
                }
            )
            .apply { if (contentIntent != null) setContentIntent(contentIntent) }
            .setOngoing(state.isPlaying)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(
                android.R.drawable.ic_media_previous,
                "Previous",
                actionPendingIntent(ACTION_PREVIOUS, 1),
            )
            .addAction(
                if (state.isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (state.isPlaying) "Pause" else "Play",
                actionPendingIntent(ACTION_PLAY_PAUSE, 2),
            )
            .addAction(
                android.R.drawable.ic_media_next,
                "Next",
                actionPendingIntent(ACTION_NEXT, 3),
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Stop",
                actionPendingIntent(ACTION_STOP, 4),
            )
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setShowActionsInCompactView(0, 1, 2)
            )
        return builder.build()
    }

    private fun actionPendingIntent(action: String, requestCode: Int): PendingIntent =
        PendingIntent.getService(
            this,
            requestCode,
            Intent(this, LocalPlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    companion object {
        const val ACTION_START = "com.spotifydashboard.librespot.playback.START"
        const val ACTION_PLAY_PAUSE = "com.spotifydashboard.librespot.playback.PLAY_PAUSE"
        const val ACTION_NEXT = "com.spotifydashboard.librespot.playback.NEXT"
        const val ACTION_PREVIOUS = "com.spotifydashboard.librespot.playback.PREVIOUS"
        const val ACTION_STOP = "com.spotifydashboard.librespot.playback.STOP"
        private const val CHANNEL_ID = "local_playback"
        private const val NOTIFICATION_ID = 4242

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, LocalPlaybackService::class.java).setAction(ACTION_START),
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocalPlaybackService::class.java))
        }
    }
}
