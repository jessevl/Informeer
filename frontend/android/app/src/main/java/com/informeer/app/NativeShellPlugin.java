package com.informeer.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.provider.Settings;

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

	@PluginMethod
	public void getNetworkStatus(PluginCall call) {
		call.resolve(buildNetworkStatus());
	}

	@PluginMethod
	public void setOfflineMode(PluginCall call) {
		Boolean enabled = call.getBoolean("enabled");
		if (enabled == null) {
			call.reject("Missing enabled flag.");
			return;
		}

		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
			WifiManager wifiManager = getWifiManager();
			if (wifiManager == null) {
				JSObject unavailable = buildNetworkStatus();
				unavailable.put("requestedOffline", enabled);
				unavailable.put("applied", false);
				unavailable.put("changed", false);
				unavailable.put("requiresUserAction", true);
				call.resolve(unavailable);
				return;
			}

			boolean targetWifiEnabled = !enabled;
			boolean changed = wifiManager.isWifiEnabled() != targetWifiEnabled;
			boolean success = wifiManager.setWifiEnabled(targetWifiEnabled);

			JSObject response = buildNetworkStatus();
			response.put("requestedOffline", enabled);
			response.put("applied", success);
			response.put("changed", changed && success);
			response.put("requiresUserAction", !success);
			call.resolve(response);
			return;
		}

		openConnectivityPanel();
		JSObject response = buildNetworkStatus();
		response.put("requestedOffline", enabled);
		response.put("applied", false);
		response.put("changed", false);
		response.put("requiresUserAction", true);
		response.put("openedSystemPanel", true);
		call.resolve(response);
	}

	private SharedPreferences getPrefs() {
		return getContext().getSharedPreferences(PREFS_NAME, Activity.MODE_PRIVATE);
	}

	@Nullable
	private WifiManager getWifiManager() {
		return (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
	}

	private JSObject buildNetworkStatus() {
		JSObject response = new JSObject();
		response.put("canToggleProgrammatically", Build.VERSION.SDK_INT < Build.VERSION_CODES.Q);

		WifiManager wifiManager = getWifiManager();
		response.put("wifiEnabled", wifiManager != null && wifiManager.isWifiEnabled());

		ConnectivityManager connectivityManager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
		Network activeNetwork = connectivityManager != null ? connectivityManager.getActiveNetwork() : null;
		NetworkCapabilities capabilities = connectivityManager != null && activeNetwork != null
			? connectivityManager.getNetworkCapabilities(activeNetwork)
			: null;

		boolean connected = capabilities != null
			&& capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
		boolean wifiConnected = capabilities != null
			&& capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);

		response.put("connected", connected);
		response.put("wifiConnected", wifiConnected);
		return response;
	}

	private void openConnectivityPanel() {
		Intent intent;
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
			intent = new Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY);
		} else {
			intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
		}
		intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
		getContext().startActivity(intent);
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