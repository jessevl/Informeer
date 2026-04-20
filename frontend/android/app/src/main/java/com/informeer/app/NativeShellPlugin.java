package com.informeer.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Thin native bridge for server URL management on Android installs.
 *
 * The APK bundles only a minimal setup page that asks for the Informeer server URL.
 * Once saved, the activity relaunches and the WebView loads the remote PWA directly.
 * The PWA's own service worker handles app-shell caching and offline behaviour.
 */
@CapacitorPlugin(name = "NativeShell")
public class NativeShellPlugin extends Plugin {
	private static final String PREFS_NAME = "InformeerNativeShell";
	private static final String KEY_SERVER_URL = "serverUrl";

	@Nullable
	public static String getStoredServerUrl(Context context) {
		SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE);
		String value = prefs.getString(KEY_SERVER_URL, null);
		if (value == null || value.trim().isEmpty()) {
			return null;
		}
		return value;
	}

	@PluginMethod
	public void getServerUrl(PluginCall call) {
		String url = getStoredServerUrl(getContext());
		JSObject response = new JSObject();
		response.put("url", url);
		call.resolve(response);
	}

	@PluginMethod
	public void setServerUrl(PluginCall call) {
		String url = call.getString("url");
		if (url == null || url.trim().isEmpty()) {
			call.reject("Missing server URL.");
			return;
		}

		getPrefs().edit()
			.putString(KEY_SERVER_URL, url.trim())
			.apply();

		call.resolve();
		relaunchApplication();
	}

	@PluginMethod
	public void clearServerUrl(PluginCall call) {
		getPrefs().edit()
			.remove(KEY_SERVER_URL)
			.apply();

		call.resolve();
		relaunchApplication();
	}

	private SharedPreferences getPrefs() {
		return getContext().getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE);
	}

	private void relaunchApplication() {
		Activity activity = getActivity();
		Context context = activity != null ? activity : getContext();
		Intent restartIntent = new Intent(context, MainActivity.class);
		restartIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
		context.startActivity(restartIntent);
		if (activity != null) {
			activity.finish();
		}
	}
}