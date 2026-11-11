package com.spotifydashboard.librespot

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * In-app Spotify consent page (OAuth 2.0 + PKCE).
 *
 * Why this exists: [LibrespotAuth] normally hands the authorize URL to the
 * system browser and waits for the loopback redirect. Some devices have no
 * usable browser for that round-trip — e.g. an Android 7 phone whose only
 * browser starts its intent trampoline activity but never creates a window, so
 * the consent page never renders and the loopback listener times out after
 * five minutes. Rendering the same authorize URL in a WebView inside the app
 * removes the browser dependency entirely.
 *
 * The redirect (`http://127.0.0.1:<port>/login?code=...`) is intercepted before
 * navigation, so no loopback server has to be listening. The code is exchanged
 * for an access token here and delivered to the thread blocked in
 * [LibrespotAuth.authorizeInApp] through [LibrespotAuthHandoff].
 *
 * PKCE verifier/state live in [LibrespotPendingAuth] (persisted with
 * `commit()` before the page loads), so a process death while the consent page
 * is open does not lose the exchange.
 */
class LibrespotAuthActivity : Activity() {

    private var webView: WebView? = null
    private var status: TextView? = null
    private var progress: ProgressBar? = null

    private var authorizeUrl: String = ""
    private var redirectUri: String = ""
    private var expectedState: String = ""
    private var timeoutMs: Long = LibrespotAuth.DEFAULT_TIMEOUT_MS

    /**
     * Outcome of this page (null while the user is still signing in). Set once,
     * so a later failure/cancel/destroy cannot overwrite a delivered result.
     */
    private var outcome: Result<String>? = null
    private var exchanging = false

    /** True once a page actually rendered; see [onReceivedError]. */
    private var everLoaded = false

    private val handler = Handler(Looper.getMainLooper())
    private val timeoutRunnable = Runnable {
        if (outcome == null) {
            fail(
                LibrespotAuthException(
                    "Timed out after ${timeoutMs / 1000}s waiting for the Spotify login page"
                ),
                closePage = true,
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        authorizeUrl = intent.getStringExtra(EXTRA_AUTHORIZE_URL).orEmpty()
        redirectUri = intent.getStringExtra(EXTRA_REDIRECT_URI).orEmpty()
        expectedState = intent.getStringExtra(EXTRA_STATE).orEmpty()
        timeoutMs = intent.getLongExtra(EXTRA_TIMEOUT_MS, LibrespotAuth.DEFAULT_TIMEOUT_MS)

        if (authorizeUrl.isEmpty() || redirectUri.isEmpty() || expectedState.isEmpty()) {
            fail(LibrespotAuthException("Spotify login request is incomplete"), closePage = true)
            return
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }
        status = TextView(this).apply {
            text = "Opening Spotify..."
            setPadding(dp(16), dp(10), dp(16), dp(10))
            setTextColor(Color.parseColor("#1F1F1F"))
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
        }
        root.addView(status, LinearLayout.LayoutParams(MATCH, WRAP))
        root.addView(progress, LinearLayout.LayoutParams(MATCH, dp(3)))

        val created = try {
            createWebView()
        } catch (e: Throwable) {
            // No WebView provider (rare, but it is exactly the case this
            // fallback exists for): let the caller try the system browser.
            Log.w(TAG, "WebView unavailable: ${e.message}")
            fail(LibrespotAuthUnavailableException("This device has no in-app browser (WebView)", e), closePage = true)
            return
        }
        webView = created
        root.addView(created, LinearLayout.LayoutParams(MATCH, 0, 1f))
        setContentView(root)

        handler.postDelayed(timeoutRunnable, timeoutMs)
        created.loadUrl(authorizeUrl)
    }

    private fun createWebView(): WebView {
        @Suppress("DEPRECATION")
        WebView.setWebContentsDebuggingEnabled(false)
        val view = WebView(this)
        view.setBackgroundColor(Color.WHITE)

        @Suppress("DEPRECATION")
        val settings = view.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        @Suppress("DEPRECATION")
        settings.databaseEnabled = true
        settings.loadsImagesAutomatically = true
        settings.setSupportMultipleWindows(false)
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        // Spotify's consent page is served to mobile browsers; keep the stock
        // UA and only add an app marker so the page renders normally.
        settings.userAgentString = settings.userAgentString + " " + APP_UA_MARKER

        runCatching {
            CookieManager.getInstance().setAcceptCookie(true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                CookieManager.getInstance().setAcceptThirdPartyCookies(view, true)
            }
        }.onFailure { Log.w(TAG, "cookie setup failed: ${it.message}") }

        view.webChromeClient = WebChromeClient()
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                handleUrl(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                handleUrl(Uri.parse(url))

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                url?.let { handleUrl(Uri.parse(it)) }
                if (outcome == null && !exchanging) {
                    status?.text = "Sign in to Spotify, then return to reSpotIt."
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                everLoaded = true
                progress?.visibility = View.GONE
                if (outcome == null && !exchanging) {
                    status?.text = "Sign in to Spotify, then return to reSpotIt."
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (outcome != null || exchanging) return
                if (!request.isForMainFrame) return
                val description = runCatching {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) error.description?.toString() else null
                }.getOrNull().orEmpty()
                Log.w(TAG, "consent page failed to load: $description (${request.url})")

                if (everLoaded) {
                    // A page did render earlier: this is a navigation/network
                    // hiccup. Keep the page (and any typed credentials) and let
                    // the WebView show its own error page / retry.
                    status?.text = "Network problem while loading Spotify. Retry on the page."
                    return
                }

                // The consent page never rendered at all: the system browser is
                // the next best attempt (it works on devices where it renders).
                fail(
                    LibrespotAuthUnavailableException(
                        "The Spotify login page could not be loaded in the app" +
                            (if (description.isNotEmpty()) " ($description)" else "")
                    ),
                    closePage = true,
                )
            }
        }
        return view
    }

    /** Returns true when the navigation was consumed (redirect or app link). */
    private fun handleUrl(uri: Uri): Boolean {
        if (outcome != null) return true
        if (isRedirect(uri)) {
            completeFromRedirect(uri)
            return true
        }
        // Anything that is not https (and not the redirect) is an app link
        // (e.g. spotify:). Opening it would leave the login flow.
        if (uri.scheme != null && !uri.scheme.equals("https", ignoreCase = true) &&
            !uri.scheme.equals("http", ignoreCase = true)
        ) {
            Log.i(TAG, "ignoring non-web navigation during login: ${uri.scheme}")
            return true
        }
        return false
    }

    private fun isRedirect(uri: Uri): Boolean {
        val expected = Uri.parse(redirectUri)
        return uri.scheme.equals(expected.scheme, ignoreCase = true) &&
            uri.host.equals(expected.host, ignoreCase = true) &&
            uri.path == expected.path
    }

    private fun completeFromRedirect(uri: Uri) {
        val error = uri.getQueryParameter("error")
        val state = uri.getQueryParameter("state")
        val code = uri.getQueryParameter("code")

        when {
            !error.isNullOrEmpty() -> {
                fail(LibrespotAuthException("Spotify authorization failed: $error"), closePage = true)
                return
            }

            state != expectedState -> {
                fail(
                    LibrespotAuthException(
                        "Spotify authorization returned a mismatched state (possible CSRF)"
                    ),
                    closePage = true,
                )
                return
            }

            code.isNullOrEmpty() -> {
                fail(LibrespotAuthException("Spotify authorization returned no code"), closePage = true)
                return
            }
        }

        exchanging = true
        status?.text = "Signing in..."
        progress?.isIndeterminate = true
        val pending = LibrespotPendingAuth.load(applicationContext, state)
        if (pending == null) {
            fail(
                LibrespotAuthException("The Spotify login request expired; start the sign-in again"),
                closePage = true,
            )
            return
        }

        Thread {
            try {
                val token = LibrespotTokenExchange.exchange(code!!, pending.verifier, pending.redirectUri)
                LibrespotPendingAuth.clear(applicationContext)
                succeed(token)
            } catch (e: Exception) {
                Log.w(TAG, "token exchange failed: ${e.message}")
                fail(
                    if (e is LibrespotAuthException) e
                    else LibrespotAuthException("Spotify token exchange failed", e),
                    closePage = true,
                )
            }
        }.start()
    }

    private fun succeed(token: String) {
        if (outcome != null) return
        outcome = Result.success(token)
        LibrespotAuthHandoff.deliver(Result.success(token))
        handler.removeCallbacks(timeoutRunnable)
        // Deferred: finishing while onCreate/onResume is still running crashes
        // some Android 7 ROMs with an ActivityThread NPE.
        handler.post { if (!isFinishing) finish() }
    }

    private fun fail(error: Exception, closePage: Boolean) {
        if (outcome != null) return
        outcome = Result.failure(error)
        LibrespotPendingAuth.clear(applicationContext)
        LibrespotAuthHandoff.deliver(Result.failure(error))
        handler.removeCallbacks(timeoutRunnable)
        if (closePage) {
            status?.text = error.message.orEmpty()
            handler.post { if (!isFinishing) finish() }
        }
    }

    override fun onBackPressed() {
        if (webView?.canGoBack() == true && !exchanging) {
            webView?.goBack()
            return
        }
        fail(LibrespotAuthException("Spotify login was cancelled"), closePage = true)
    }

    override fun onDestroy() {
        handler.removeCallbacks(timeoutRunnable)
        // Finishing without a result (system back, task removal, low memory)
        // must not leave the connect thread waiting for the full timeout.
        if (outcome == null) {
            outcome = Result.failure(LibrespotAuthException("Spotify login was cancelled"))
            LibrespotAuthHandoff.deliver(
                Result.failure(LibrespotAuthException("Spotify login was cancelled"))
            )
        }
        webView?.let { view ->
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        }
        webView = null
        super.onDestroy()
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val TAG = "LibrespotAuth"
        private const val APP_UA_MARKER = "reSpotIt/1.0"

        private const val EXTRA_AUTHORIZE_URL = "authorizeUrl"
        private const val EXTRA_REDIRECT_URI = "redirectUri"
        private const val EXTRA_STATE = "state"
        private const val EXTRA_TIMEOUT_MS = "timeoutMs"

        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

        /** Intent that renders the consent page inside the app. */
        fun intent(
            context: Context,
            authorizeUrl: String,
            redirectUri: String,
            state: String,
            timeoutMs: Long,
        ): Intent = Intent(context, LibrespotAuthActivity::class.java)
            .putExtra(EXTRA_AUTHORIZE_URL, authorizeUrl)
            .putExtra(EXTRA_REDIRECT_URI, redirectUri)
            .putExtra(EXTRA_STATE, state)
            .putExtra(EXTRA_TIMEOUT_MS, timeoutMs)
    }
}
