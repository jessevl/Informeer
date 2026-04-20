package com.informeer.app;

import android.os.Bundle;
import android.view.KeyEvent;
import android.view.MotionEvent;

import com.getcapacitor.CapConfig;
import com.getcapacitor.BridgeActivity;
import com.informeer.app.eink.EinkPowerManager;
import com.informeer.app.eink.EinkPowerPlugin;

public class MainActivity extends BridgeActivity {
	private final EinkPowerManager einkPowerManager = EinkPowerManager.getInstance();

	@Override
	public void onCreate(Bundle savedInstanceState) {
		config = buildRuntimeConfig();
		registerPlugin(NativeShellPlugin.class);
		registerPlugin(EinkPowerPlugin.class);
		super.onCreate(savedInstanceState);
		einkPowerManager.attachBridge(getBridge());
	}

	@Override
	public void onResume() {
		super.onResume();
		einkPowerManager.attachBridge(getBridge());
	}

	@Override
	public boolean dispatchTouchEvent(MotionEvent ev) {
		if (einkPowerManager.handleTouchEvent(ev)) {
			return true;
		}
		return super.dispatchTouchEvent(ev);
	}

	@Override
	public boolean dispatchKeyEvent(KeyEvent event) {
		if (einkPowerManager.handleKeyEvent(event)) {
			return true;
		}
		return super.dispatchKeyEvent(event);
	}

	private CapConfig buildRuntimeConfig() {
		CapConfig defaultConfig = CapConfig.loadDefault(this);
		if (hasText(defaultConfig.getServerUrl())) {
			return defaultConfig;
		}

		String serverUrl = NativeShellPlugin.getStoredServerUrl(this);
		if (!hasText(serverUrl)) {
			return defaultConfig;
		}

		return new CapConfig.Builder(this)
			.setHTML5mode(defaultConfig.isHTML5Mode())
			.setServerUrl(serverUrl)
			.setErrorPath(defaultConfig.getErrorPath())
			.setHostname(defaultConfig.getHostname())
			.setStartPath(defaultConfig.getStartPath())
			.setAndroidScheme(defaultConfig.getAndroidScheme())
			.setAllowNavigation(defaultConfig.getAllowNavigation())
			.setOverriddenUserAgentString(defaultConfig.getOverriddenUserAgentString())
			.setAppendedUserAgentString(defaultConfig.getAppendedUserAgentString())
			.setBackgroundColor(defaultConfig.getBackgroundColor())
			.setAllowMixedContent(defaultConfig.isMixedContentAllowed())
			.setCaptureInput(defaultConfig.isInputCaptured())
			.setResolveServiceWorkerRequests(defaultConfig.isResolveServiceWorkerRequests())
			.setWebContentsDebuggingEnabled(defaultConfig.isWebContentsDebuggingEnabled())
			.setZoomableWebView(defaultConfig.isZoomableWebView())
			.setLoggingEnabled(defaultConfig.isLoggingEnabled())
			.setInitialFocus(defaultConfig.isInitialFocus())
			.create();
	}

	private boolean hasText(String value) {
		return value != null && !value.trim().isEmpty();
	}
}
