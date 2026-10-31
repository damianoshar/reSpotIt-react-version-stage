package com.spotifydashboard.librespot

import android.content.Context

/** Reusable librespot session credentials (`username` + base64 auth blob). */
data class LibrespotStoredCredentials(val username: String, val authDataB64: String)

/**
 * App-private persistence for [LibrespotStoredCredentials].
 *
 * The auth blob is an account secret: it lives only in the app's private
 * SharedPreferences (device-encrypted at rest), never in the dashboard database,
 * never in logs and is never exported. It is the steady-state playback login —
 * it does not expire, so the browser flow is only needed once per account (or
 * after Spotify revokes it; callers then clear the store and re-authorize).
 */
class LibrespotCredentialsStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Returns the persisted credentials, or null when none are stored/incomplete. */
    fun load(): LibrespotStoredCredentials? {
        val username = prefs.getString(KEY_USERNAME, null) ?: return null
        val authData = prefs.getString(KEY_AUTH_DATA, null) ?: return null
        if (username.isEmpty() || authData.isEmpty()) return null
        return LibrespotStoredCredentials(username, authData)
    }

    fun save(credentials: LibrespotStoredCredentials) {
        prefs.edit()
            .putString(KEY_USERNAME, credentials.username)
            .putString(KEY_AUTH_DATA, credentials.authDataB64)
            .apply()
    }

    fun save(username: String, authDataB64: String) =
        save(LibrespotStoredCredentials(username, authDataB64))

    fun clear() {
        prefs.edit()
            .remove(KEY_USERNAME)
            .remove(KEY_AUTH_DATA)
            .apply()
    }

    private companion object {
        const val PREFS_NAME = "librespot_credentials"
        const val KEY_USERNAME = "username"
        const val KEY_AUTH_DATA = "auth_data"
    }
}
