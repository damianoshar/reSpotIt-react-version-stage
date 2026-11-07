package com.spotifydashboard.librespot

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom

/** Interactive Spotify authorization failed (cancelled, timed out, refused, ...). */
class LibrespotAuthException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * On-device OAuth 2.0 authorization-code + PKCE for librespot playback.
 *
 * Uses librespot's desktop ("keymaster") client id — the same one the native
 * session pins as `client_id` — with scope `streaming` and a loopback redirect
 * (`http://127.0.0.1:<port>/login`). The resulting access token is only used to
 * establish a session once: the native side turns it into reusable stored
 * credentials (see [LibrespotEngine.storedCredentials]) and the steady state is
 * `loginStored`, so this browser round-trip happens once per account.
 *
 * Android caveat: the callback is delivered to a [ServerSocket] inside this
 * process. If Android kills the app while the browser is in the foreground, the
 * listener dies with it and the flow has to be restarted — keep the app in the
 * foreground for the first login. Later starts never open a browser.
 *
 * [authorize] blocks (browser round-trip + token exchange): call it from a
 * worker thread, never from the main thread.
 */
object LibrespotAuth {
    private const val TAG = "LibrespotAuth"

    /** librespot's desktop/keymaster OAuth client id (public client, no secret). */
    const val CLIENT_ID = "65b708073fc0480ea92a077233ca87bd"

    const val SCOPE = "streaming"
    const val CALLBACK_PATH = "/login"
    const val AUTHORIZE_ENDPOINT = "https://accounts.spotify.com/authorize"

    /** Port the PC helper uses; a busy port falls back to an ephemeral one. */
    const val DEFAULT_PORT = 8898
    const val DEFAULT_TIMEOUT_MS = 5 * 60 * 1000L

    /**
     * Runs the full interactive flow and returns a `streaming` access token.
     *
     * @param context used only to launch the browser (application context is fine).
     * @param port preferred loopback port; an ephemeral port is used if it is busy.
     * @param timeoutMs how long to wait for the browser callback.
     */
    fun authorize(
        context: Context,
        port: Int = DEFAULT_PORT,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    ): String {
        val appContext = context.applicationContext
        return authorize(
            port = port,
            timeoutMs = timeoutMs,
            launchBrowser = { url ->
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    appContext.startActivity(intent)
                } catch (e: Exception) {
                    throw LibrespotAuthException("No browser is available to complete the Spotify login", e)
                }
            },
        )
    }

    /**
     * Testable core of [authorize]: [launchBrowser] receives the authorize URL
     * and is responsible for opening it; [exchange] turns the returned code into
     * an access token (overridable so the loopback flow can be tested offline).
     */
    internal fun authorize(
        port: Int = DEFAULT_PORT,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
        launchBrowser: (String) -> Unit,
        exchange: (code: String, verifier: String, redirectUri: String) -> String = { code, verifier, redirectUri ->
            LibrespotTokenExchange.exchange(code, verifier, redirectUri)
        },
    ): String {
        val verifier = Pkce.newVerifier()
        val state = Pkce.newState()

        LibrespotLoopbackServer.open(port, CALLBACK_PATH).use { server ->
            val redirectUri = server.redirectUri
            val url = buildAuthorizeUrl(redirectUri, state, Pkce.challenge(verifier))
            Log.i(TAG, "starting Spotify authorization (redirect=$redirectUri, port=${server.port})")
            launchBrowser(url)

            val code = server.awaitCode(timeoutMs, state)
            Log.i(TAG, "authorization code received; exchanging it for a token")
            return exchange(code, verifier, redirectUri)
        }
    }

    /** Builds the `accounts.spotify.com/authorize` URL (PKCE, no client secret). */
    fun buildAuthorizeUrl(redirectUri: String, state: String, codeChallenge: String): String {
        fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
        return AUTHORIZE_ENDPOINT +
            "?response_type=code" +
            "&client_id=$CLIENT_ID" +
            "&redirect_uri=${enc(redirectUri)}" +
            "&scope=${enc(SCOPE)}" +
            "&state=${enc(state)}" +
            "&code_challenge=${enc(codeChallenge)}" +
            "&code_challenge_method=S256"
    }
}

/** PKCE (RFC 7636) primitives: S256 challenge + high-entropy verifier/state. */
internal object Pkce {
    private val random = SecureRandom()

    fun newVerifier(): String {
        val bytes = ByteArray(64)
        random.nextBytes(bytes)
        return base64Url(bytes)
    }

    fun challenge(verifier: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(verifier.toByteArray(Charsets.US_ASCII))
        return base64Url(digest)
    }

    fun newState(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }

    private fun base64Url(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}

/**
 * One-shot loopback HTTP listener for the OAuth redirect.
 *
 * Binds to 127.0.0.1 only. Browsers may probe the port (favicon, etc.), so
 * non-callback requests are answered with 404 and the listener keeps waiting
 * until the deadline.
 */
internal class LibrespotLoopbackServer private constructor(
    private val server: ServerSocket,
    private val callbackPath: String,
) : Closeable {

    val port: Int get() = server.localPort
    val redirectUri: String get() = "http://127.0.0.1:$port$callbackPath"

    /**
     * Waits for the redirect, validates `state` (CSRF) and returns `code`.
     * Throws [LibrespotAuthException] on denial, state mismatch or timeout.
     */
    fun awaitCode(timeoutMs: Long, expectedState: String): String {
        server.soTimeout = POLL_MS
        val deadline = System.currentTimeMillis() + timeoutMs

        while (System.currentTimeMillis() < deadline) {
            val client = try {
                server.accept()
            } catch (_: SocketTimeoutException) {
                continue
            }

            var code: String? = null
            var failure: LibrespotAuthException? = null
            client.soTimeout = CLIENT_READ_TIMEOUT_MS
            client.use { socket ->
                // Browsers often pre-connect to the loopback port and leave the
                // socket idle until the user finishes the consent page. A read
                // timeout on such a probe must not abort the whole flow, or the
                // real redirect finds a closed listener (ERR_CONNECTION_REFUSED).
                val requestLine = try {
                    readRequestLine(socket)
                } catch (e: Exception) {
                    Log.i("LibrespotAuth", "ignoring idle loopback probe: ${e.message}")
                    null
                }
                val target = requestLine?.split(' ')?.getOrNull(1).orEmpty()
                val uri = Uri.parse("http://127.0.0.1$target")

                if (uri.path != callbackPath) {
                    respond(socket, 404, "Not Found", "<html><body>Not found.</body></html>")
                } else {
                    val error = uri.getQueryParameter("error")
                    val state = uri.getQueryParameter("state")
                    val authCode = uri.getQueryParameter("code")
                    when {
                        error != null -> {
                            respond(socket, 200, "OK", page("Spotify authorization was cancelled ($error)."))
                            failure = LibrespotAuthException("Spotify authorization failed: $error")
                        }

                        state != expectedState -> {
                            respond(socket, 400, "Bad Request", page("Invalid state."))
                            failure = LibrespotAuthException(
                                "Spotify authorization returned a mismatched state (possible CSRF)"
                            )
                        }

                        authCode.isNullOrEmpty() -> {
                            respond(socket, 400, "Bad Request", page("Missing authorization code."))
                        }

                        else -> {
                            respond(socket, 200, "OK", page("Spotify authorization received. You can close this tab."))
                            code = authCode
                        }
                    }
                }
            }

            failure?.let { throw it }
            code?.let { return it }
        }

        throw LibrespotAuthException(
            "Timed out after ${timeoutMs / 1000}s waiting for the Spotify login callback"
        )
    }

    override fun close() {
        runCatching { server.close() }
    }

    private fun readRequestLine(socket: Socket): String? {
        val input = socket.getInputStream()
        val buffer = ByteArrayOutputStream()
        var byte = input.read()
        while (byte != -1 && byte != '\n'.code && buffer.size() < MAX_REQUEST_LINE_BYTES) {
            if (byte != '\r'.code) buffer.write(byte)
            byte = input.read()
        }
        if (buffer.size() == 0) return null
        return buffer.toString("US-ASCII")
    }

    private fun respond(socket: Socket, status: Int, reason: String, html: String) {
        val body = html.toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $status $reason\r\n" +
            "Content-Type: text/html; charset=utf-8\r\n" +
            "Content-Length: ${body.size}\r\n" +
            "Connection: close\r\n\r\n"
        runCatching {
            val out = socket.getOutputStream()
            out.write(head.toByteArray(Charsets.US_ASCII))
            out.write(body)
            out.flush()
        }
    }

    private fun page(message: String): String =
        "<html><body style=\"font-family:sans-serif\"><h2>$message</h2></body></html>"

    companion object {
        private const val POLL_MS = 250

        /**
         * How long to wait for the request line of an accepted loopback socket.
         * Browsers pre-connect and stay idle for a while; a stalled probe is
         * closed and the listener keeps waiting for the real redirect.
         */
        private const val CLIENT_READ_TIMEOUT_MS = 5_000
        private const val MAX_REQUEST_LINE_BYTES = 8 * 1024

        fun open(port: Int, callbackPath: String): LibrespotLoopbackServer {
            val address = InetAddress.getByName("127.0.0.1")
            val preferred = ServerSocket()
            preferred.reuseAddress = true
            return try {
                preferred.bind(InetSocketAddress(address, port))
                Log.i("LibrespotAuth", "loopback bound on preferred port ${preferred.localPort}")
                LibrespotLoopbackServer(preferred, callbackPath)
            } catch (e: Exception) {
                // Port busy (or blocked by the OEM): Spotify accepts any port for a
                // loopback redirect URI, so fall back to an ephemeral one.
                Log.e("LibrespotAuth", "bind to port $port FAILED: " + (e.message ?: e.toString()))
                runCatching { preferred.close() }
                val serverSocket = ServerSocket(0, 1, address)
                Log.i("LibrespotAuth", "fallback loopback bound on port ${serverSocket.localPort}")
                LibrespotLoopbackServer(serverSocket, callbackPath)
            }
        }
    }
}

/** Exchanges an authorization code for an access token (public client + PKCE). */
internal object LibrespotTokenExchange {
    const val ENDPOINT = "https://accounts.spotify.com/api/token"

    fun exchange(
        code: String,
        verifier: String,
        redirectUri: String,
        endpoint: String = ENDPOINT,
    ): String {
        fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")

        val body = listOf(
            "grant_type" to "authorization_code",
            "code" to code,
            "redirect_uri" to redirectUri,
            "client_id" to LibrespotAuth.CLIENT_ID,
            "code_verifier" to verifier,
        ).joinToString("&") { (key, value) -> "${enc(key)}=${enc(value)}" }

        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 15_000
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            setRequestProperty("Accept", "application/json")
        }

        try {
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(body) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val payload = stream?.bufferedReader()?.use { it.readText() }.orEmpty()

            if (status !in 200..299) {
                val error = runCatching { JSONObject(payload).optString("error") }.getOrNull()
                val description = runCatching { JSONObject(payload).optString("error_description") }.getOrNull()
                throw LibrespotAuthException(
                    "Spotify token exchange failed (HTTP $status" +
                        (if (!error.isNullOrEmpty()) ", $error" else "") +
                        (if (!description.isNullOrEmpty()) ": $description" else "") + ")"
                )
            }

            val token = runCatching { JSONObject(payload).optString("access_token") }.getOrNull()
            if (token.isNullOrEmpty()) {
                throw LibrespotAuthException("Spotify token exchange returned no access token")
            }
            return token
        } catch (e: LibrespotAuthException) {
            throw e
        } catch (e: Exception) {
            throw LibrespotAuthException("Spotify token exchange failed: ${e.javaClass.simpleName}", e)
        } finally {
            connection.disconnect()
        }
    }
}
