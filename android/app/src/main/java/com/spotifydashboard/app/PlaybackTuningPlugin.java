package com.spotifydashboard.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Asks the user to switch off battery optimisation and optionally keep the
 * screen on while the Web Playback SDK is playing.
 *
 * Both settings matter on older/low-RAM phones: when Android throttles the
 * WebView the SDK's audio pipeline underruns and the track jumps forward.
 */
@CapacitorPlugin(name = "PlaybackTuning")
public class PlaybackTuningPlugin extends Plugin {

  @PluginMethod
  public void getStatus(PluginCall call) {
    JSObject result = new JSObject();
    result.put("ignoringBatteryOptimizations", isIgnoringBatteryOptimizations());
    result.put("keepScreenOn", isKeepScreenOn());
    result.put("sdkInt", Build.VERSION.SDK_INT);
    call.resolve(result);
  }

  @PluginMethod
  public void requestIgnoreBatteryOptimizations(PluginCall call) {
    if (isIgnoringBatteryOptimizations()) {
      JSObject result = new JSObject();
      result.put("ignoringBatteryOptimizations", true);
      result.put("requested", false);
      call.resolve(result);
      return;
    }

    Context context = getContext();
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      JSObject result = new JSObject();
      result.put("ignoringBatteryOptimizations", true);
      result.put("requested", false);
      call.resolve(result);
      return;
    }

    try {
      Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
      intent.setData(Uri.parse("package:" + context.getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
      resolveRequested(call);
    } catch (Exception directError) {
      try {
        Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(fallback);
        resolveRequested(call);
      } catch (Exception fallbackError) {
        call.reject("Could not open the battery optimisation settings.");
      }
    }
  }

  @PluginMethod
  public void openBatteryOptimizationSettings(PluginCall call) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      call.resolve();
      return;
    }
    try {
      Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception error) {
      call.reject("Could not open the battery optimisation settings.");
    }
  }

  @PluginMethod
  public void setKeepScreenOn(PluginCall call) {
    final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
    final android.app.Activity activity = getActivity();
    if (activity == null) {
      call.reject("The app window is not available.");
      return;
    }
    activity.runOnUiThread(() -> {
      if (on) {
        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      } else {
        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      }
      JSObject result = new JSObject();
      result.put("keepScreenOn", on);
      call.resolve(result);
    });
  }

  private void resolveRequested(PluginCall call) {
    JSObject result = new JSObject();
    result.put("requested", true);
    result.put("ignoringBatteryOptimizations", isIgnoringBatteryOptimizations());
    call.resolve(result);
  }

  private boolean isIgnoringBatteryOptimizations() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
    PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
    if (power == null) return true;
    try {
      return power.isIgnoringBatteryOptimizations(getContext().getPackageName());
    } catch (Exception error) {
      return true;
    }
  }

  private boolean isKeepScreenOn() {
    android.app.Activity activity = getActivity();
    if (activity == null || activity.getWindow() == null) return false;
    int flags = activity.getWindow().getAttributes().flags;
    return (flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0;
  }
}
