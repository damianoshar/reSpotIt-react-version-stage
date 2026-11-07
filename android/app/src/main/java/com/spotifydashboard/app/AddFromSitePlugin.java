package com.spotifydashboard.app;

import android.app.Dialog;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.util.Log;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.LinkedHashSet;
import java.util.Set;
import org.json.JSONArray;

@CapacitorPlugin(name = "AddFromSite")
public class AddFromSitePlugin extends Plugin {
  private Dialog dialog;
  private WebView webView;
  private PluginCall pendingCall;
  private volatile boolean resolved;
  private final Set<String> detected = new LinkedHashSet<>();
  private TextView status;
  private String currentUrl = "https://open.spotify.com";
  private final Handler main = new Handler(Looper.getMainLooper());

  @PluginMethod
  public void open(PluginCall call) {
    if (pendingCall != null) {
      call.reject("A browser is already open.");
      return;
    }
    pendingCall = call;
    resolved = false;
    detected.clear();
    String initial = call.getString("url", "https://open.spotify.com");
    getActivity().runOnUiThread(() -> showDialog(initial));
  }

  /**
   * Entry point for share-sheet launches: opens the Add from site dialog
   * pre-filled with the shared URL and auto-scans it.
   */
  public void openFromShare(String url) {
    if (url == null || url.trim().isEmpty()) return;
    if (pendingCall != null) return;
    resolved = false;
    detected.clear();
    final String initial = url.trim();
    getActivity().runOnUiThread(() -> showDialog(initial));
  }

  private void navigateFromInput(EditText input) {
    String next = input.getText().toString().trim();
    if (next.isEmpty()) return;
    if (!(next.startsWith("http://") || next.startsWith("https://"))) {
      next = "https://" + next;
    }
    input.setText(next);
    input.clearFocus();
    currentUrl = next;
    Log.d("AddFromSite", "navigate to " + next);
    if (webView != null) {
      final String urlToLoad = next;
      webView.post(() -> {
        try { webView.loadUrl(urlToLoad); }
        catch (Exception e) { Log.e("AddFromSite", "loadUrl failed", e); }
      });
    }
  }

  private void close(final boolean cancelled) {
    if (resolved) return;
    resolved = true;
    final JSObject result = new JSObject();
    JSONArray ids = new JSONArray();
    for (String id : detected) ids.put(id);
    result.put("ids", ids);
    result.put("url", currentUrl);
    result.put("cancelled", cancelled);
    final PluginCall call = pendingCall;
    main.post(() -> {
      if (call != null) call.resolve(result);
      if (webView != null) {
        webView.destroy();
        webView = null;
      }
      if (dialog != null && dialog.isShowing()) dialog.dismiss();
      dialog = null;
      pendingCall = null;
    });
  }

  private void showDialog(String initial) {
    String url = initial == null || initial.trim().isEmpty()
        ? "https://open.spotify.com"
        : initial.trim();
    if (!(url.startsWith("http://") || url.startsWith("https://"))) {
      url = "https://" + url;
    }
    currentUrl = url;
    final android.app.Activity activity = getActivity();
    dialog = new Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
    dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

    LinearLayout root = new LinearLayout(activity);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Color.BLACK);

    LinearLayout bar = new LinearLayout(activity);
    bar.setOrientation(LinearLayout.HORIZONTAL);
    int pad = dp(10);
    bar.setPadding(pad, pad, pad, pad);

    final EditText input = new EditText(activity);
    input.setSingleLine(true);
    input.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_GO |
        android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI);
    input.setOnEditorActionListener((v, actionId, event) -> {
      boolean isGo = actionId == android.view.inputmethod.EditorInfo.IME_ACTION_GO;
      boolean isEnter = event != null && event.getKeyCode() == android.view.KeyEvent.KEYCODE_ENTER
          && event.getAction() == android.view.KeyEvent.ACTION_DOWN;
      if (isGo || isEnter) {
        navigateFromInput(input);
        return true;
      }
      return false;
    });
    input.setTextColor(Color.WHITE);
    input.setBackgroundColor(Color.parseColor("#181818"));
    input.setHint("https://open.spotify.com/...");
    input.setHintTextColor(Color.parseColor("#9A9A9A"));
    input.setInputType(android.text.InputType.TYPE_TEXT_VARIATION_URI);
    input.setText(url);
    LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    inputParams.setMargins(0, 0, dp(6), 0);

    Button go = new Button(activity);
    go.setText("Go");
    go.setOnClickListener(v -> navigateFromInput(input));

    Button scan = new Button(activity);
    scan.setText("Scan");
    scan.setOnClickListener(v -> scanPage());

    Button close = new Button(activity);
    close.setText("Close");
    close.setOnClickListener(v -> close(false));

    bar.addView(input, inputParams);
    bar.addView(go);
    bar.addView(scan);
    bar.addView(close);

    webView = new WebView(activity);
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setLoadsImagesAutomatically(true);
    settings.setUserAgentString("Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
    webView.setWebViewClient(new WebViewClient() {
      @Override
      public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
        Log.d("AddFromSite", "onPageStarted " + url);
        currentUrl = url;
        input.setText(url);
        main.post(() -> {
          detected.clear();
          setStatus("Loading page…");
        });
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        currentUrl = url;
        input.setText(url);
        scanPage();
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (request.isForMainFrame()) {
          Log.e("AddFromSite", "error " + error.getErrorCode() + " " + error.getDescription());
          setStatus("Could not load the page (" + error.getErrorCode() + " " + error.getDescription() + ").");
        }
      }
    });
    webView.addJavascriptInterface(new LinkBridge(), "AndroidAddFromSite");
    webView.loadUrl(url);

    LinearLayout body = new LinearLayout(activity);
    body.setOrientation(LinearLayout.VERTICAL);
    body.setLayoutParams(new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    status = new TextView(activity);
    status.setText("Loading page…");
    status.setTextColor(Color.parseColor("#B3B3B3"));
    status.setPadding(pad, pad, pad, pad);

    final Button done = new Button(activity);
    done.setText("Done (0 detected)");
    done.setOnClickListener(v -> close(true));

    body.addView(webView, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    body.addView(status, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    body.addView(done, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    root.addView(bar, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    root.addView(body, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

    dialog.setContentView(root);
    dialog.setOnDismissListener(d -> {
      if (!resolved) close(false);
    });
    Window window = dialog.getWindow();
    if (window != null) {
      window.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
      window.setBackgroundDrawableResource(android.R.color.black);
    }
    dialog.show();
    Thread thread = new Thread(() -> {
      try {
        while (dialog != null && dialog.isShowing()) {
          main.post(() -> {
            if (done != null) done.setText("Done (" + detected.size() + " detected)");
          });
          Thread.sleep(600);
        }
      } catch (InterruptedException ignored) {
      }
    });
    thread.start();
  }

  private void setStatus(String text) {
    main.post(() -> {
      if (status != null) status.setText(text);
    });
  }

  private void scanPage() {
    if (webView == null) return;
    setStatus("Scanning page…");
    final String js = "(function(){\n"
        + "function add(u){ if(!u) return; var s=String(u); var m=s.match(/open\\.spotify\\.com\\/(?:embed\\/)?album\\/([A-Za-z0-9]{22})/); if(!m) m=s.match(/spotify:album:([A-Za-z0-9]{22})/); if(!m) m=s.match(/[?&]uri=spotify%3Aalbum%3A([A-Za-z0-9]{22})/); if(m && !seen[m[1]]){ seen[m[1]]=true; out.push(m[1]); } }\n"
        + "var out=[], seen={};\n"
        + "if(location.href) add(location.href);\n"
        + "try{ document.querySelectorAll('a[href]').forEach(function(a){ add(a.href); }); }catch(e){}\n"
        + "try{ document.querySelectorAll('[data-uri]').forEach(function(e){ add(e.getAttribute('data-uri')); }); }catch(e){}\n"
        + "try{ document.querySelectorAll('[data-spotify-uri]').forEach(function(e){ add(e.getAttribute('data-spotify-uri')); }); }catch(e){}\n"
        + "try{ document.querySelectorAll('iframe[src]').forEach(function(f){ add(f.src); }); }catch(e){}\n"
        + "try{ var all=document.querySelectorAll('div,main,section,article'); for(var i=0;i<all.length;i++){ try{ all[i].scrollTop += 100000; }catch(e){} } }catch(e){}\n"
        + "try{ var html=document.documentElement.outerHTML||''; var re=/open\\.spotify\\.com\\/(?:embed\\/)?album\\/([A-Za-z0-9]{22})/g; var mm; while((mm=re.exec(html))!==null){ if(!seen[mm[1]]){ seen[mm[1]]=true; out.push(mm[1]); } } }catch(e){}\n"
        + "try{ if(window.AndroidAddFromSite) window.AndroidAddFromSite.onLinks(JSON.stringify(out)); }catch(e){}\n"
        + "return JSON.stringify(out);\n"
        + "})()";
    webView.evaluateJavascript(js, value -> {
      Set<String> parsed = parseIds(value);
      boolean hadChanged = false;
      for (String id : parsed) {
        if (detected.add(id)) hadChanged = true;
      }
      final boolean changed = hadChanged;
      getActivity().runOnUiThread(() -> {
        if (changed) setStatus("Detected " + detected.size() + " Spotify album(s).");
        else setStatus(detected.isEmpty() ? "No Spotify album links found yet." :
            "Detected " + detected.size() + " Spotify album(s). Scroll or tap Scan again.");
      });
    });
  }

  private Set<String> parseIds(String raw) {
    Set<String> out = new LinkedHashSet<>();
    if (raw == null) return out;
    String trimmed = raw.trim();
    if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
      try {
        trimmed = new org.json.JSONArray("[" + trimmed + "]").getString(0);
      } catch (Exception ignored) {
        trimmed = trimmed.substring(1, trimmed.length() - 1).replace("\\\"", "\"");
      }
    }
    try {
      JSONArray arr = new JSONArray(trimmed);
      for (int i = 0; i < arr.length(); i++) out.add(arr.getString(i));
      return out;
    } catch (Exception ignored) {
      java.util.regex.Matcher m = java.util.regex.Pattern.compile("[A-Za-z0-9]{22}").matcher(raw);
      while (m.find()) out.add(m.group());
      return out;
    }
  }

  public class LinkBridge {
    @JavascriptInterface
    public void onLinks(String json) {
      Set<String> parsed = parseIds(json);
      boolean changed = false;
      for (String id : parsed) if (detected.add(id)) changed = true;
      final boolean wasChanged = changed;
      getActivity().runOnUiThread(() -> {
        if (wasChanged) setStatus("Detected " + detected.size() + " Spotify album(s).");
      });
    }
  }

  private int dp(int value) {
    return (int) (value * getActivity().getResources().getDisplayMetrics().density);
  }
}